import { Router } from 'express';
import multer from 'multer';
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import type { Config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { BugReportSchema } from '../schemas.js';
import {
  sanitizeFilename,
  isAllowedMediaType,
  generateId,
  escapeHtml,
} from '../utils/helpers.js';
import { renderViewer } from '../services/viewer.js';

export function reportsRouter(config: Config): Router {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.maxFileBytes,
      files: 50,
    },
  });

  const writeAuth = authMiddleware(config, true);
  const readAuth = authMiddleware(config, config.requireAuthForRead);

  // POST /api/reports
  router.post(
    '/api/reports',
    writeAuth,
    upload.any(),
    async (req, res): Promise<void> => {
      try {
        const files = (req.files ?? []) as Express.Multer.File[];

        // Extract report JSON
        const reportFile = files.find((f) => f.fieldname === 'report');
        if (!reportFile) {
          res.status(400).json({ error: 'Missing "report" field.' });
          return;
        }

        let reportData: unknown;
        try {
          reportData = JSON.parse(reportFile.buffer.toString('utf-8'));
        } catch {
          res.status(400).json({ error: 'Invalid JSON in "report" field.' });
          return;
        }

        const parsed = BugReportSchema.safeParse(reportData);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid report data.',
            details: parsed.error.issues.map((i) => i.message),
          });
          return;
        }

        const report = parsed.data;
        const id = generateId();
        const dir = join(config.dataDir, id);
        await mkdir(dir, { recursive: true });

        // Write report JSON
        await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));

        // Write replay JSON if present
        const replayFile = files.find((f) => f.fieldname === 'replay');
        if (replayFile) {
          await writeFile(join(dir, 'replay.json'), replayFile.buffer);
        }

        // Write media files
        const mediaFiles = files.filter((f) => f.fieldname === 'media');
        for (const media of mediaFiles) {
          if (!isAllowedMediaType(media.mimetype)) {
            res.status(400).json({
              error: `Disallowed media type: ${media.mimetype}. Allowed: video/webm, image/png, image/jpeg`,
            });
            return;
          }
          const safeName = sanitizeFilename(media.originalname);
          await writeFile(join(dir, safeName), media.buffer);
        }

        const baseUrl = config.publicUrl
          ? config.publicUrl.replace(/\/$/, '')
          : '';
        const url = `${baseUrl}/api/reports/${id}`;

        res.status(201).json({ id, url });
      } catch (err) {
        console.error('Report upload error:', err);
        res.status(500).json({ error: 'Internal server error.' });
      }
    },
  );

  // GET /api/reports/:id — HTML viewer
  router.get('/api/reports/:id', readAuth, async (req, res): Promise<void> => {
    try {
      const id = sanitizeFilename(String(req.params.id));
      const dir = join(config.dataDir, id);

      if (!existsSync(join(dir, 'report.json'))) {
        res.status(404).json({ error: 'Report not found.' });
        return;
      }

      const report = JSON.parse(
        await readFile(join(dir, 'report.json'), 'utf-8'),
      ) as Record<string, unknown>;

      let replay: unknown[] = [];
      const replayPath = join(dir, 'replay.json');
      if (existsSync(replayPath)) {
        try {
          replay = JSON.parse(await readFile(replayPath, 'utf-8')) as unknown[];
        } catch {
          // Ignore malformed replay
        }
      }

      // List media files
      const allFiles = await readdir(dir);
      const mediaFiles = allFiles.filter(
        (f) => f !== 'report.json' && f !== 'replay.json',
      );

      const html = renderViewer(id, report, replay, mediaFiles);

      res
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .setHeader(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'none'; frame-src 'none';",
        )
        .send(html);
    } catch (err) {
      console.error('Viewer error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // GET /api/reports/:id/report.json — raw report JSON
  router.get(
    '/api/reports/:id/report.json',
    readAuth,
    async (req, res): Promise<void> => {
      try {
        const id = sanitizeFilename(String(req.params.id));
        const filePath = join(config.dataDir, id, 'report.json');
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'Report not found.' });
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        createReadStream(filePath).pipe(res);
      } catch {
        res.status(500).json({ error: 'Internal server error.' });
      }
    },
  );

  // GET /api/reports/:id/media/:file — stream media
  router.get(
    '/api/reports/:id/media/:file',
    readAuth,
    async (req, res): Promise<void> => {
      try {
        const id = sanitizeFilename(String(req.params.id));
        const file = sanitizeFilename(String(req.params.file));
        const filePath = join(config.dataDir, id, file);

        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found.' });
          return;
        }

        const ext = extname(file).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.webm': 'video/webm',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
        };

        const contentType = mimeMap[ext] ?? 'application/octet-stream';
        const fileStat = await stat(filePath);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileStat.size);
        createReadStream(filePath).pipe(res);
      } catch {
        res.status(500).json({ error: 'Internal server error.' });
      }
    },
  );

  return router;
}
