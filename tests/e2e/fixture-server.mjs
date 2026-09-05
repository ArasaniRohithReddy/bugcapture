/**
 * Minimal static file server for the Playwright fixture page.
 * Kept dependency-free so `npm run test:e2e` needs no extra packages.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
const port = Number(process.env.FIXTURE_PORT ?? 5599);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/api/ok') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  if (url.pathname === '/api/fail') {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end('{"error":"boom"}');
    return;
  }

  const relative = normalize(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if (relative.startsWith('..')) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const file = await readFile(join(root, relative));
    response.writeHead(200, {
      'content-type': TYPES[extname(relative)] ?? 'application/octet-stream',
    });
    response.end(file);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fixture server on http://127.0.0.1:${port}\n`);
});
