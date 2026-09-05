import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config.js';

export function corsMiddleware(config: Config) {
  const allowedOrigins = config.allowedOrigins;

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin ?? '';

    if (allowedOrigins === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      const allowed = allowedOrigins.split(',').map((o) => o.trim());
      if (allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
