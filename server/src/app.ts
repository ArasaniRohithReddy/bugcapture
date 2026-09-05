import express from 'express';
import { loadConfig } from './config.js';
import { corsMiddleware } from './middleware/cors.js';
import { healthRouter } from './routes/health.js';
import { reportsRouter } from './routes/reports.js';
import { aiRouter } from './routes/ai.js';

export function createApp(configOverrides?: Partial<ReturnType<typeof loadConfig>>) {
  const config = { ...loadConfig(), ...configOverrides };

  const app = express();

  // Trust proxy for accurate req.ip behind reverse proxies
  app.set('trust proxy', true);

  // CORS
  app.use(corsMiddleware(config));

  // JSON body parser with size limit for AI endpoint
  app.use('/api/ai', express.json({ limit: '256kb' }));

  // Routes
  app.use(healthRouter(config));
  app.use(reportsRouter(config));
  app.use(aiRouter(config));

  return { app, config };
}
