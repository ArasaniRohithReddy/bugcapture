import type { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../utils/rate-limiter.js';

export function createRateLimitMiddleware(
  windowMs = 60_000,
  maxRequests = 20,
): (req: Request, res: Response, next: NextFunction) => void {
  const limiter = new RateLimiter({ windowMs, maxRequests });

  // Cleanup stale entries periodically
  const timer = setInterval(() => limiter.cleanup(), 5 * 60_000);
  timer.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (!limiter.check(key)) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }
    next();
  };
}
