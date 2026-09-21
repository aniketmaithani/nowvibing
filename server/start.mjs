import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequestHandler } from './http.mjs';
import { createService } from './service.mjs';
const root = ['out', 'dist/client']
  .map((p) => resolve(p))
  .find((p) => existsSync(resolve(p, 'index.html')));
if (!root) {
  console.error('Build the app first: npm run build');
  process.exit(1);
}
const service = createService();
const server = createServer(createRequestHandler({ service, root }));
server.headersTimeout = 15000;
server.requestTimeout = 15000;
server.keepAliveTimeout = 5000;
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
    'NowVibing is running at http://127.0.0.1:3000\nKeep this terminal open to keep syncing.',
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    service.close();
    server.close(() => process.exit(0));
  });
