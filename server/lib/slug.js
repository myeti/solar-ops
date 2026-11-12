/**
 * Project identifiers ("uid") are derived from the project name.
 * They are used as folder name, pm2 process name, database name, role name
 * and certificate name, so the format is deliberately strict.
 */

export const UID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const UID_MAX_LENGTH = 40;

/**
 * Names that would clash with pm2 keywords, SolarOps itself, PostgreSQL
 * system databases, or routes: /api/projects/<name> (suggest-uid,
 * next-port, folder-check) and the /projects/new page.
 */
export const RESERVED_UIDS = [
  'all',
  'solarops',
  'postgres',
  'template0',
  'template1',
  'root',
  'admin',
  'new',
  'suggest-uid',
  'next-port',
  'folder-check',
];

/**
 * Turn any project name into a slug: "My Café API!" => "my-cafe-api".
 *
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  const slug = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.slice(0, UID_MAX_LENGTH).replace(/-+$/g, '');
}

/**
 * Convert a uid to a PostgreSQL friendly identifier: "my-app" => "my_app".
 *
 * @param {string} uid
 * @returns {string}
 */
export function uidToSqlIdentifier(uid) {
  return uid.replace(/-/g, '_');
}
