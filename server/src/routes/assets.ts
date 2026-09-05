import { Router } from 'express';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PLAYER_SCRIPT_PATH, PLAYER_STYLE_PATH } from '../services/viewer.js';

const require = createRequire(import.meta.url);

/**
 * Resolve `rrweb-player`'s dist directory. Its `exports` map only exposes the
 * package root and `./dist/style.css`, so the directory is derived from one of
 * those rather than requested directly.
 */
function playerDistDir(): string {
  return dirname(require.resolve('rrweb-player/dist/style.css'));
}

/**
 * Serves the bundled rrweb-player assets used by the report viewer, so the
 * viewer works offline and pulls nothing from a CDN.
 */
export function assetsRouter(): Router {
  const router = Router();
  const dist = playerDistDir();

  const send = (file: string, contentType: string) => {
    return (_req: unknown, res: import('express').Response): void => {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(join(dist, file));
    };
  };

  router.get(
    PLAYER_SCRIPT_PATH,
    send('rrweb-player.umd.min.cjs', 'text/javascript; charset=utf-8'),
  );
  router.get(PLAYER_STYLE_PATH, send('style.min.css', 'text/css; charset=utf-8'));

  return router;
}
