import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createService } from './service.mjs';
const root = ['out', 'dist/client']
  .map((p) => resolve(p))
  .find((p) => existsSync(resolve(p, 'index.html')));
if (!root) {
  console.error('Build the app first: npm run build');
  process.exit(1);
}
const service = createService();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
};
const server = createServer((req, res) => {
  const slackAuthRoute = [
    '/api/auth/slack',
    '/api/auth/slack/callback',
  ].includes(new URL(req.url, 'http://127.0.0.1:3000').pathname);
  if (
    req.headers.host !== '127.0.0.1:3000' &&
    !(req.headers.host === 'localhost:3000' && slackAuthRoute)
  ) {
    res.writeHead(403);
    res.end('Open http://127.0.0.1:3000');
    return;
  }
  void service.handle(req, res, async () => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      const pathname = decodeURIComponent(
        new URL(req.url, 'http://127.0.0.1:3000').pathname,
      );
      const path = resolve(
        root,
        `.${pathname === '/' ? '/index.html' : pathname}`,
      );
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const content = await readFile(path);
      res.writeHead(200, {
        'Content-Type': mime[extname(path)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'Cache-Control':
          extname(path) === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'Port 3000 is in use. Stop the other app and try again.'
      : error.message,
  );
  service.close();
  process.exit(1);
});
server.listen(3000, '127.0.0.1', () =>
  console.log(
    'SpotMyStatus is running at http://127.0.0.1:3000\nKeep this terminal open to keep syncing.',
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    service.close();
    server.close(() => process.exit(0));
  });
