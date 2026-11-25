/**
 * Infrastructure › Redis: the Redis program of the server and every
 * project's instance (services/redis.js).
 */
import express from 'express';
import { Project } from '../models/index.js';
import { findRedisProgram, redisStatus } from '../services/redis.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const projects = await Project.findAll({ where: { system: false }, order: [['name', 'ASC']] });
  const instances = [];

  for (const project of projects) {
    const redis = project.redis;

    // Off, but with data kept in redis/: listed too.
    if (redis.enabled || redis.password) {
      instances.push({
        project: { uid: project.uid, name: project.name, active: project.active },
        ...(await redisStatus(project)),
      });
    }
  }

  res.json({ program: await findRedisProgram(), instances });
});

export default router;
