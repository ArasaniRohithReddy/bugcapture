import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

/**
 * Per-IP fixed-window rate limiting.
 *
 * `express-rate-limit` keeps counters in memory, which is fine for a
 * single-instance self-hosted deployment. Behind a load balancer, put the
 * limiting in the proxy or swap in a shared store.
 */
export function createRateLimitMiddleware(
  windowMs = 60_000,
  maxRequests = 20,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit: maxRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  });
}
