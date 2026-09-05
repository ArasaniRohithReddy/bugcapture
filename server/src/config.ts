import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
  version: string;
};

export interface Config {
  port: number;
  dataDir: string;
  publicUrl: string;
  authToken: string;
  requireAuthForRead: boolean;
  allowedOrigins: string;
  maxUploadBytes: number;
  maxFileBytes: number;
  aiProvider: 'openai' | 'anthropic' | 'auto';
  openaiApiKey: string;
  anthropicApiKey: string;
  version: string;
}

export function loadConfig(): Config {
  const env = process.env;
  return {
    port: Number(env['PORT'] ?? 3000),
    dataDir: env['DATA_DIR'] ?? './data',
    publicUrl: env['PUBLIC_URL'] ?? '',
    authToken: env['AUTH_TOKEN'] ?? '',
    requireAuthForRead: env['REQUIRE_AUTH_FOR_READ'] === 'true',
    allowedOrigins: env['ALLOWED_ORIGINS'] ?? '*',
    maxUploadBytes: Number(env['MAX_UPLOAD_BYTES'] ?? 200 * 1024 * 1024),
    maxFileBytes: Number(env['MAX_FILE_BYTES'] ?? 50 * 1024 * 1024),
    aiProvider: (env['AI_PROVIDER'] ?? 'auto') as Config['aiProvider'],
    openaiApiKey: env['OPENAI_API_KEY'] ?? '',
    anthropicApiKey: env['ANTHROPIC_API_KEY'] ?? '',
    version: pkg.version,
  };
}
