import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';

const { app, config } = createApp();

// Ensure data directory exists
await mkdir(config.dataDir, { recursive: true });

if (!config.authToken) {
  console.warn(
    '\n⚠️  WARNING: AUTH_TOKEN is not set. All endpoints are unprotected.\n' +
      '   Set AUTH_TOKEN in .env or as an environment variable for production use.\n',
  );
}

app.listen(config.port, () => {
  console.log(`BugCapture server v${config.version} listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});
