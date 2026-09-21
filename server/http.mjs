import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

export const MAX_BODY_BYTES = 16_000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.rsc': 'text/x-component',
};

export function requestError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export function requestUrl(target, origin) {
  if (
    typeof target !== 'string' ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.length > 8192
  ) {
    throw requestError('Invalid request target.');
  }
  try {
    return new URL(target, origin);
  } catch {
    throw requestError('Invalid request target.');
  }
}
export function readJsonBody(req) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')
  ) {
    req.resume();
    return Promise.reject(requestError('Use application/json.', 415));
  }
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0,
      rejected = false;
    // Drain excess bytes without retaining them or destroying the response socket.
    req.on('data', (chunk) => {
      if (rejected) return;
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(requestError('Request too large.', 413));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.once('end', () => {
      if (rejected) return;
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(requestError('Invalid JSON.'));
      }
    });
    req.once('error', () => reject(requestError('Request interrupted.')));
    req.once('aborted', () => reject(requestError('Request interrupted.')));
  });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  res.setHeader('Cache-Control', 'no-store');
}
function contentPolicy(html) {
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[1].trim())
    .map(
      (match) =>
        `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`,
    );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Production boundary. It never serves source files or the private data directory. */
export function createRequestHandler({
  service,
  root,
  origin = 'http://127.0.0.1:3000',
}) {
  const rootPath = realpath(root);
  const canonicalHost = new URL(origin).host;
  const slackHost = `localhost:${new URL(origin).port || '3000'}`;
  return async (req, res) => {
    securityHeaders(res);
    try {
      const url = requestUrl(req.url, origin);
      const isSlackAuth = [
        '/api/auth/slack',
        '/api/auth/slack/callback',
      ].includes(url.pathname);
      if (
        req.headers.host !== canonicalHost &&
        !(req.headers.host === slackHost && isSlackAuth)
      ) {
        res.writeHead(403);
        res.end(`Open ${origin}`);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await service.handle(req, res);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        throw requestError('Invalid path.');
      }
      if (
        pathname.includes('\0') ||
        pathname.split('/').some((part) => part.startsWith('.'))
      ) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const directory = await rootPath;
      const candidate = resolve(
        directory,
        `.${pathname === '/' ? '/index.html' : pathname}`,
      );
      if (!candidate.startsWith(directory + sep)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      let path;
      try {
        path = await realpath(candidate);
        if (!path.startsWith(directory + sep) || !(await stat(path)).isFile())
          throw new Error('Not public');
      } catch {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const content = await readFile(path);
      if (extname(path) === '.html')
        res.setHeader(
          'Content-Security-Policy',
          contentPolicy(content.toString('utf8')),
        );
      res.writeHead(200, {
        'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
        'Cache-Control': /\.(?:html|rsc|json)$/.test(path)
          ? 'no-store'
          : 'public, max-age=3600',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(error.status || 500);
        res.end(error.status ? error.message : 'Local server error.');
      } else res.end();
    }
  };
}
