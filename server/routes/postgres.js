/**
 * PostgreSQL server (global component) configuration.
 */
import express from 'express';
import { Project } from '../models/index.js';
import { Validator } from '../lib/validation.js';
import { recordAudit } from '../services/audit.js';
import { listDatabases, testPostgresConnection } from '../services/postgres.js';
import { getPostgresSettings, updatePostgresSettings } from '../services/settings.js';

const router = express.Router();

/**
 * Validate a connection form. `password` stays undefined when left empty,
 * meaning "keep the saved password".
 */
function readConnection(body) {
  const input = new Validator(body);
  const connection = {
    host: input.string('host', { required: true, max: 253 }),
    port: input.integer('port', { required: true, min: 1, max: 65535 }),
    user: input.string('user', { required: true, max: 63 }),
    database: input.string('database', { required: true, max: 63 }),
    ssl: input.boolean('ssl', { defaultValue: false }),
    password: input.string('password', { max: 256, trim: false }),
  };
  input.assertValid();

  return connection;
}

router.get('/', async (req, res) => {
  res.json({ postgres: await getPostgresSettings() });
});

router.put('/', async (req, res) => {
  const connection = readConnection(req.body);
  const postgres = await updatePostgresSettings(connection);

  await recordAudit({ req, action: 'postgres.update', details: { host: connection.host, user: connection.user } });

  res.json({ postgres });
});

/**
 * Test the connection typed in the form (falls back to the saved password).
 */
router.post('/test', async (req, res) => {
  const connection = readConnection(req.body);

  if (connection.password === undefined) {
    const saved = await getPostgresSettings({ withPassword: true });
    connection.password = saved.password;
  }

  try {
    const result = await testPostgresConnection(connection);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

/**
 * Databases on the server, flagged with the project that owns them.
 */
router.get('/databases', async (req, res) => {
  const projects = await Project.findAll();
  const owners = new Map();

  for (const project of projects) {
    const database = project.database;

    if (database.name) {
      owners.set(database.name, { uid: project.uid, name: project.name, enabled: database.enabled });
    }
  }

  try {
    const databases = await listDatabases();
    const result = databases.map((database) => {
      return { ...database, project: owners.get(database.name) || null };
    });

    res.json({ databases: result, error: null });
  } catch (error) {
    res.json({ databases: [], error: error.message });
  }
});

export default router;
