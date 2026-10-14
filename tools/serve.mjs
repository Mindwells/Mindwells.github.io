/**
 * Minimal static file server for the built site.
 *
 * Deliberately dependency-free and framework-free: it exists so the audit
 * tooling can load `dist/` over HTTP (which the browser requires for module
 * scripts and the Clipboard API) without pulling in a preview dependency.
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.env.PORT ?? 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  let pathname = decodeURIComponent(url.pathname);

  // Resolve inside `root` only — no traversal out of the build directory.
  let target = normalize(join(root, pathname));
  if (!target.startsWith(root + sep) && target !== root) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stats = statSync(target);
    if (stats.isDirectory()) target = join(target, 'index.html');
  } catch {
    // Fall through to the 404 page below.
    target = join(root, '404.html');
    try {
      const body = createReadStream(target);
      res.writeHead(404, { 'content-type': MIME['.html'] });
      body.pipe(res);
    } catch {
      res.writeHead(404).end('Not found');
    }
    return;
  }

  const ext = extname(target).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';

  try {
    const stats = statSync(target);
    res.writeHead(200, {
      'content-type': type,
      'content-length': stats.size,
      'cache-control': 'no-store',
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}`);
});
