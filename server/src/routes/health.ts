import { Router } from 'express';
import type { Config } from '../config.js';

export function healthRouter(config: Config): Router {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: config.version });
  });

  return router;
}
