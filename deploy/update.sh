#!/usr/bin/env bash
#
# SolarOps updates, run by npm:
#   npm run update               pull the current branch, rebuild, restart
#   npm run update -- --check    show what an update would bring, change nothing
#   npm run update -- --force    rebuild and restart even when up to date
#   npm run rollback             back to the version before the last update
#
# An update never changes the setup (deploy/install.sh --update keeps it):
#   1. checks: SolarOps set up, a git clone on a branch with an upstream,
#      no local change, no operation running (deployments, backups...),
#   2. git pull --ff-only of the current branch (as the owner of the folder),
#   3. deploy/install.sh --update: dependencies, UI build, server setup and
#      restart; when it starts, SolarOps backs up its database and applies
#      the pending migrations (server/database/migrations.js),
#   4. checks that SolarOps answers, otherwise goes back to the previous
#      version, and to the database backup when migrations ran.
# The projects keep running all along: nginx and pm2 serve them.

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=deploy/common.sh
source "$APP_DIR/deploy/common.sh"

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

# git as the owner of the folder (its "safe directory" check refuses other users).
git_() {
  local owner

  owner="$(stat -c %U "$APP_DIR")"

  if [[ "$owner" == root ]]; then
    git -C "$APP_DIR" "$@"
  else
    sudo -u "$owner" -H git -C "$APP_DIR" "$@"
  fi
}

short() {
  git_ rev-parse --short "$1"
}

# Move the branch back to a commit (local changes refused, never lost). The
# index is refreshed first: the setup's chmod makes files look modified.
reset_to() {
  git_ update-index -q --refresh > /dev/null || true
  git_ reset --quiet --keep "$1"
}

# Where the database lives, and where updates are recorded.
load_paths() {
  DATA_DIR="$(env_value SOLAROPS_DATA_DIR)"
  DATA_DIR="${DATA_DIR:-/var/lib/solarops}"
  DB_URL="$(env_value SOLAROPS_DB_URL)"
  DB_FILE="$(env_value SOLAROPS_DB_FILE)"
  DB_FILE="${DB_FILE:-$DATA_DIR/solarops.sqlite}"
  BACKUPS_DIR="$DATA_DIR/backups"
  LAST_UPDATE="$BACKUPS_DIR/last-update.json"
  LAST_MIGRATION="$BACKUPS_DIR/last-migration.json"
}

# A field of a JSON file (empty when absent).
json_field() {
  node -e '
    let value;
    try {
      value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    } catch {}
    if (Array.isArray(value)) {
      value = value.join(", ");
    }
    if (value !== undefined && value !== null) {
      process.stdout.write(String(value));
    }
  ' "$1" "$2"
}

# SolarOps set up, a clean git clone on a branch tracking an upstream.
check_ready() {
  if ! service_installed || [[ ! -f "$APP_DIR/.env" ]]; then
    fail "SolarOps is not set up on this server: run npm run setup first."
  fi

  if ! git_ rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    fail "${APP_DIR} is not a git clone: updates pull the branch it is on."
  fi

  BRANCH="$(git_ symbolic-ref --quiet --short HEAD || true)"

  if [[ -z "$BRANCH" ]]; then
    fail "No branch is checked out in ${APP_DIR} (detached HEAD): check one out, e.g. git checkout main."
  fi

  UPSTREAM="$(git_ rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2> /dev/null || true)"

  if [[ -z "$UPSTREAM" ]]; then
    fail "The branch ${BRANCH} tracks no remote branch: git branch --set-upstream-to origin/${BRANCH}"
  fi

  local changes

  changes="$(git_ status --porcelain --untracked-files=no)"

  if [[ -n "$changes" ]]; then
    printf '%s\n' "$changes" >&2
    fail "Local changes in ${APP_DIR}: commit, stash or discard them first (an update would mix them up)."
  fi
}

# Refuse while deployments, backups or certificate requests run.
check_idle() {
  local count

  count="$(/usr/local/bin/solarops tasks:active --count 2> /dev/null || true)"

  if [[ -z "$count" ]]; then
    warn "Could not check the running operations (older SolarOps?): make sure no deployment is running."
    return 0
  fi

  if [[ "$count" != 0 ]]; then
    /usr/local/bin/solarops tasks:active || true
    fail "${count} operation(s) running: run the update again once they are done (restarting would cut them off)."
  fi
}

# Put the database backup taken before the migrations back in place.
restore_database() {
  local backup="$1"

  systemctl stop "$SERVICE" || true
  install -m 0600 -o "$(stat -c %U "$DATA_DIR")" -g "$(stat -c %G "$DATA_DIR")" "$backup" "$DB_FILE"
  # The write-ahead log belongs to the replaced database.
  rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
  # Those migrations are undone: the next ones start a new record.
  if [[ -f "$LAST_MIGRATION" ]]; then
    mv "$LAST_MIGRATION" "${LAST_MIGRATION%.json}.restored.json"
  fi
  success "Database restored from ${backup}"
}

# Migrations applied since a date (epoch ms): their backup, or nothing.
migration_backup_since() {
  local since="$1"
  local at

  if [[ ! -f "$LAST_MIGRATION" ]]; then
    return 0
  fi

  at="$(json_field "$LAST_MIGRATION" at)"

  if [[ -n "$at" ]] && node -e 'process.exit(Date.parse(process.argv[1]) >= Number(process.argv[2]) ? 0 : 1)' "$at" "$since"; then
    json_field "$LAST_MIGRATION" backup
  fi
}

show_plan() {
  local behind="$1"

  info "Branch ${BRANCH} at $(short HEAD), ${UPSTREAM} at $(short '@{u}'): ${behind} new commit(s)."

  if [[ "$behind" == 0 ]]; then
    return 0
  fi

  git_ log --oneline --no-decorate -n 20 'HEAD..@{u}' | sed 's/^/    /'

  local changed

  changed="$(git_ diff --name-only 'HEAD' '@{u}')"

  if grep -q '^server/database/migrations/.*\.js$' <<< "$changed"; then
    info "Database migrations (the database is backed up first):"
    grep '^server/database/migrations/.*\.js$' <<< "$changed" | sed 's|^server/database/migrations/|    |'
  fi

  if grep -q '^package-lock.json$' <<< "$changed"; then
    info "Dependencies change (npm ci)."
  fi

  if grep -q '^deploy/' <<< "$changed"; then
    info "The server setup scripts change (re-applied with your setup)."
  fi
}

# ─────────────────────────────── Update ─────────────────────────────────

update() {
  local mode="$1"

  step "Checking"
  check_ready
  git_ fetch --quiet

  local behind
  local ahead

  behind="$(git_ rev-list --count 'HEAD..@{u}')"
  ahead="$(git_ rev-list --count '@{u}..HEAD')"

  if [[ "$ahead" != 0 ]]; then
    fail "${BRANCH} has ${ahead} local commit(s) that ${UPSTREAM} does not have: push or drop them first."
  fi

  show_plan "$behind"

  if [[ "$mode" == check ]]; then
    check_idle
    success "Nothing was changed (--check)."
    return 0
  fi

  if [[ "$behind" == 0 ]] && [[ "$mode" != force ]]; then
    success "Already up to date (npm run update -- --force rebuilds anyway)."
    return 0
  fi

  check_idle

  local from

  from="$(git_ rev-parse HEAD)"

  if [[ "$behind" != 0 ]]; then
    step "Pulling ${UPSTREAM}"
    git_ pull --ff-only --quiet
    success "$(short "$from") → $(short HEAD)"
  fi

  # The new version of this script applies the new version.
  exec bash "$APP_DIR/deploy/update.sh" --apply "$from"
}

# Rebuild and restart the checked out version; back to $from if it fails.
apply() {
  local from="$1"
  local started

  check_ready
  started="$(date +%s%3N)"

  step "Applying $(short HEAD) (your setup is kept)"

  if ! bash "$APP_DIR/deploy/install.sh" --update; then
    roll_back_failed_update "$from" "$started" "the setup step failed"
  fi

  step "Checking that SolarOps answers"

  if ! wait_until_up; then
    roll_back_failed_update "$from" "$started" "SolarOps did not start"
  fi

  local backup
  local migrations=""

  backup="$(migration_backup_since "$started")"

  if [[ -n "$backup" ]]; then
    migrations="$(json_field "$LAST_MIGRATION" applied)"
  fi

  # Owned like the data folder: SolarOps writes its backups there.
  install -d -m 0700 -o "$(stat -c %U "$DATA_DIR")" -g "$(stat -c %G "$DATA_DIR")" "$BACKUPS_DIR"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ at: new Date().toISOString(), branch: process.argv[2], from: process.argv[3], to: process.argv[4], backup: process.argv[5] || null }, null, 2) + "\n", { mode: 0o600 })' \
    "$LAST_UPDATE" "$BRANCH" "$from" "$(git_ rev-parse HEAD)" "$backup"

  step "Updated"
  success "${BRANCH}: $(short "$from") → $(short HEAD)"

  if [[ -n "$migrations" ]]; then
    success "Migrations applied: ${migrations}"
    info "Database backup taken before them: ${backup}"
  fi

  info "Something wrong? npm run rollback goes back to $(short "$from")."
}

roll_back_failed_update() {
  local from="$1"
  local started="$2"
  local reason="$3"
  local backup

  step "Update failed (${reason}): back to $(short "$from")"
  backup="$(migration_backup_since "$started")"
  reset_to "$from"

  if [[ -n "$backup" ]]; then
    restore_database "$backup"
  fi

  if bash "$APP_DIR/deploy/install.sh" --update && wait_until_up; then
    fail "The update failed (${reason}): SolarOps is back to $(short "$from"). See the messages above."
  fi

  fail "The update failed (${reason}), and so did going back to $(short "$from"). See the messages above, and journalctl -u solarops."
}

# ─────────────────────────────── Rollback ───────────────────────────────

rollback() {
  local assume_yes="$1"

  step "Checking"
  check_ready

  if [[ ! -f "$LAST_UPDATE" ]]; then
    fail "No update to roll back (the last one is recorded in ${LAST_UPDATE})."
  fi

  local from
  local to
  local backup

  from="$(json_field "$LAST_UPDATE" from)"
  to="$(json_field "$LAST_UPDATE" to)"
  backup="$(json_field "$LAST_UPDATE" backup)"

  if [[ "$(git_ rev-parse HEAD)" != "$to" ]]; then
    fail "${APP_DIR} is no longer at the version of the last update ($(short "$to")): roll back by hand (git reset --keep $(short "$from"))."
  fi

  info "Back to $(short "$from"), the version before the update of $(json_field "$LAST_UPDATE" at)."

  if [[ -n "$backup" ]]; then
    warn "That update migrated the database: it is restored from ${backup}."
    warn "Changes made in SolarOps since then (projects, settings, admins...) are lost."
  fi

  if [[ "$assume_yes" != true ]]; then
    local answer=""

    printf "  Continue? [y/N] "
    read -r answer || true

    if [[ ! "$answer" =~ ^[yY] ]]; then
      fail "Nothing was changed."
    fi
  fi

  check_idle

  step "Going back to $(short "$from")"
  reset_to "$from"

  if [[ -n "$backup" ]]; then
    restore_database "$backup"
  fi

  bash "$APP_DIR/deploy/install.sh" --update || fail "The setup step failed: see the messages above."
  wait_until_up || fail "SolarOps does not start: see journalctl -u solarops."

  mv "$LAST_UPDATE" "${LAST_UPDATE%.json}.rolled-back.json"

  step "Rolled back"
  success "${BRANCH}: $(short "$to") → $(short "$from")"
  info "The branch is now behind ${UPSTREAM}: npm run update would pull the same version again."
}

# ─────────────────────────────── Main ───────────────────────────────────

# Everything runs from main: bash has read the whole script before a pull
# replaces it.
main() {
  local action="update"
  local mode="normal"
  local from=""
  local assume_yes=false

  if ! command -v systemctl > /dev/null; then
    fail "systemctl not found: updates are for a SolarOps server. Here, use git pull and npm run dev."
  fi

  become_root "$@"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check) mode=check ;;
      --force) mode=force ;;
      --rollback) action=rollback ;;
      --yes) assume_yes=true ;;
      --apply)
        action=apply
        from="${2:?--apply needs a commit}"
        shift
        ;;
      -h | --help) usage ;;
      *) fail "Unknown option: $1 (see npm run update -- --help)" ;;
    esac
    shift
  done

  load_paths

  case "$action" in
    update) update "$mode" ;;
    apply) apply "$from" ;;
    rollback) rollback "$assume_yes" ;;
  esac
}

main "$@"
exit
