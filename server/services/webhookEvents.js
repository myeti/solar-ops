/**
 * What an incoming deployment webhook asks for, from its event header and
 * payload: deploy the project's branch, or acknowledge and ignore the call.
 *
 * Only pushes on the deployed branch deploy:
 *   - GitHub, Gitea, Forgejo: `X-GitHub-Event: push` (or `X-Gitea-Event`,
 *     `X-Forgejo-Event`); GitHub's `ping` is answered,
 *   - GitLab: `X-Gitlab-Event: Push Hook`,
 *   - Bitbucket Cloud: `X-Event-Key: repo:push`.
 * Every other event (releases, pull requests, issues...) is ignored, and so
 * are tags (they are not deployed) and deleted branches.
 *
 * Without an event header (CI, curl), the call deploys, unless its JSON
 * payload names another branch, or a tag, in `ref`.
 */

/** "after" of a push deleting a branch (GitHub, GitLab, Gitea). */
const EMPTY_COMMIT = /^0+$/;

/** Bitbucket Cloud ref types of a branch ("named_branch": Mercurial). */
const BITBUCKET_BRANCH_TYPES = ['branch', 'named_branch'];

/** Longest event name echoed back. */
const MAX_EVENT_LENGTH = 80;

/**
 * @typedef {{action: 'deploy'}|{action: 'ignore', reason: string}|{action: 'pong'}} WebhookDecision
 */

function deploy() {
  return { action: 'deploy' };
}

function ignore(reason) {
  return { action: 'ignore', reason };
}

function quoteList(names) {
  return names.map((name) => `"${name}"`).join(', ');
}

function eventIgnored(event) {
  return ignore(`"${String(event).slice(0, MAX_EVENT_LENGTH)}" event ignored: only pushes deploy.`);
}

function tagsIgnored(names, branch) {
  let noun = 'Tag';

  if (names.length > 1) {
    noun = 'Tags';
  }

  return ignore(`${noun} ${quoteList(names)} ignored: tags are not deployed, only pushes on "${branch}".`);
}

function branchesIgnored(names, branch) {
  return ignore(`Push on ${quoteList(names)} ignored: only pushes on "${branch}" deploy.`);
}

function branchDeleted(branch) {
  return ignore(`Branch "${branch}" was deleted: nothing to deploy.`);
}

function parsePayload(body) {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * A push named by a git ref ("refs/heads/main", "refs/tags/v1.2.0"):
 * GitHub, Gitea, Forgejo and GitLab payloads.
 *
 * @param {object|null} payload
 * @param {string} branch the deployed branch
 * @param {{lenient: boolean}} options lenient (calls without event header):
 *   no ref at all, or a bare branch name ("main"), is accepted
 * @returns {WebhookDecision}
 */
function refPushDecision(payload, branch, { lenient }) {
  const ref = payload?.ref;

  if (typeof ref !== 'string' || ref === '') {
    if (lenient) {
      return deploy();
    }

    return ignore('The push names no branch.');
  }

  if (ref.startsWith('refs/tags/')) {
    return tagsIgnored([ref.slice('refs/tags/'.length)], branch);
  }

  let pushed = null;

  if (ref.startsWith('refs/heads/')) {
    pushed = ref.slice('refs/heads/'.length);
  } else if (lenient && !ref.startsWith('refs/')) {
    pushed = ref;
  }

  if (pushed === null) {
    return ignore(`Ref "${ref}" ignored: only pushes on "${branch}" deploy.`);
  }

  if (pushed !== branch) {
    return branchesIgnored([pushed], branch);
  }

  if (payload.deleted === true || (typeof payload.after === 'string' && EMPTY_COMMIT.test(payload.after))) {
    return branchDeleted(branch);
  }

  return deploy();
}

function isBitbucketBranch(ref) {
  return Boolean(ref) && BITBUCKET_BRANCH_TYPES.includes(ref.type);
}

/**
 * A Bitbucket Cloud push: one change per updated branch or tag, `new` is
 * null when it was deleted.
 *
 * @param {object|null} payload
 * @param {string} branch the deployed branch
 * @returns {WebhookDecision}
 */
function bitbucketPushDecision(payload, branch) {
  const changes = payload?.push?.changes;

  if (!Array.isArray(changes) || changes.length === 0) {
    return ignore('The push names no branch.');
  }

  if (changes.some((change) => isBitbucketBranch(change?.new) && change.new.name === branch)) {
    return deploy();
  }

  if (changes.some((change) => !change?.new && isBitbucketBranch(change?.old) && change.old.name === branch)) {
    return branchDeleted(branch);
  }

  const refs = changes.map((change) => change?.new || change?.old).filter(Boolean);
  const branches = refs.filter(isBitbucketBranch).map((ref) => ref.name);

  if (branches.length > 0) {
    return branchesIgnored(branches, branch);
  }

  const tags = refs.map((ref) => ref.name).filter(Boolean);

  if (tags.length > 0) {
    return tagsIgnored(tags, branch);
  }

  return ignore('The push names no branch.');
}

/**
 * What an authenticated webhook call asks for.
 *
 * @param {(name: string) => (string|undefined)} header request header getter
 * @param {Buffer} body raw payload
 * @param {string} branch the deployed branch
 * @returns {WebhookDecision}
 */
export function decideWebhook(header, body, branch) {
  const payload = parsePayload(body);
  const hubEvent = header('x-github-event') || header('x-gitea-event') || header('x-forgejo-event');

  if (hubEvent) {
    if (hubEvent === 'ping') {
      return { action: 'pong' };
    }

    if (hubEvent !== 'push') {
      return eventIgnored(hubEvent);
    }

    return refPushDecision(payload, branch, { lenient: false });
  }

  const gitlabEvent = header('x-gitlab-event');

  if (gitlabEvent) {
    // Tag pushes have their own event, whose ref is reported as a tag.
    if (gitlabEvent !== 'Push Hook' && gitlabEvent !== 'Tag Push Hook') {
      return eventIgnored(gitlabEvent);
    }

    return refPushDecision(payload, branch, { lenient: false });
  }

  const bitbucketEvent = header('x-event-key');

  if (bitbucketEvent) {
    if (bitbucketEvent !== 'repo:push') {
      return eventIgnored(bitbucketEvent);
    }

    return bitbucketPushDecision(payload, branch);
  }

  return refPushDecision(payload, branch, { lenient: true });
}
