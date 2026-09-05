import express from 'express';
import { loadConfig } from './config.js';
import { corsMiddleware } from './middleware/cors.js';
import { healthRouter } from './routes/health.js';
import { reportsRouter } from './routes/reports.js';
import { aiRouter } from './routes/ai.js';
import { assetsRouter } from './routes/assets.js';

export function createApp(configOverrides?: Partial<ReturnType<typeof loadConfig>>) {
  const config = { ...loadConfig(), ...configOverrides };

  const app = express();

  // Only trust the number of proxy hops that are actually in front of this
  // server. Trusting every proxy would let a client spoof X-Forwarded-For and
  // walk straight past the per-IP rate limiter.
  app.set('trust proxy', config.trustProxyHops);

  // CORS
  app.use(corsMiddleware(config));

  // JSON body parser with size limit for AI endpoint
  app.use('/api/ai', express.json({ limit: '256kb' }));

  // Routes
  app.use(healthRouter(config));
  app.use(assetsRouter());
  app.use(reportsRouter(config));
  app.use(aiRouter(config));

  return { app, config };
}
