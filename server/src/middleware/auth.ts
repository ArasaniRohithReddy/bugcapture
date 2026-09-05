import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config.js';
import { timingSafeEqual } from '../utils/helpers.js';

/**
 * Bearer-token auth middleware.
 * If AUTH_TOKEN is unset, requests pass through (for local dev).
 */
export function authMiddleware(config: Config, requireAuth = true) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.authToken) {
      // No token configured — allow all (warning logged at startup)
      next();
      return;
    }

    if (!requireAuth) {
      next();
      return;
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header.' });
      return;
    }

    const token = header.slice(7);
    if (!timingSafeEqual(token, config.authToken)) {
      res.status(403).json({ error: 'Invalid token.' });
      return;
    }

    next();
  };
}
