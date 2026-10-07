// Runs Quick Vote on one machine, with no Cloudflare: the site and the API on one port, and SQLite in a file.
// It uses the same API code as the Cloudflare Worker (worker/src/index.js).
//
// Environment:
//   PORT           port to listen on (default 8080)
//   DATA_DIR       folder for the database file (default ./data)
//   SITE_DIR       folder with the site files (default ../ , the repository root)
//   CREATE_CODE    organiser code that is required to make a poll (strongly recommended)
//   ALLOW_INDEXING set to 1 to let search engines index this server (default: they are told not to)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/src/index.js';
import { openDatabase, asD1 } from './d1-sqlite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(here, '..', 'data'));
const siteDir = path.resolve(process.env.SITE_DIR || path.join(here, '..'));
const indexing = process.env.ALLOW_INDEXING === '1';

fs.mkdirSync(dataDir, { recursive: true });
const db = openDatabase(path.join(dataDir, 'quick-vote.db'));
db.exec(fs.readFileSync(path.join(here, '..', 'worker', 'schema.sql'), 'utf8'));
const env = { DB: asD1(db), CREATE_CODE: process.env.CREATE_CODE || '', ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '*' };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};
// Only these files are public. The server never serves anything else from the folder.
const PUBLIC_FILES = new Set([
  'index.html', 'ranked-choice-voting.html', 'styles.css', 'sw.js', 'favicon.svg', 'robots.txt', 'sitemap.xml',
]);
const PUBLIC_DIRS = ['js/', 'assets/'];

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  ...(indexing ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders, ...headers });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  // The site finds this server by its own address, so no default address needs to be set.
  if (pathname === '/config.js') {
    return send(res, 200, 'window.QUICK_VOTE_API = location.origin;\n', { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' });
  }
  if (pathname === '/robots.txt' && !indexing) {
    return send(res, 200, 'User-agent: *\nDisallow: /\n', { 'content-type': TYPES['.txt'] });
  }
  if (pathname === '/sitemap.xml' && !indexing) return send(res, 404, 'Not found');
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const allowed = PUBLIC_FILES.has(relative) || PUBLIC_DIRS.some((dir) => relative.startsWith(dir));
  const file = path.join(siteDir, relative);
  if (!allowed || relative.includes('..') || !file.startsWith(siteDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Not found');
  }
  return send(res, 200, req.method === 'HEAD' ? undefined : fs.readFileSync(file), {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
}

async function handleApi(req, res, url) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((n, c) => n + c.length, 0) > 4_000_000) return send(res, 413, 'Too large');
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const request = new Request(url, { method: req.method, headers: req.headers, body: hasBody ? Buffer.concat(chunks) : undefined });
  const response = await worker.fetch(request, env);
  const headers = Object.fromEntries(response.headers);
  return send(res, response.status, Buffer.from(await response.arrayBuffer()), headers);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    return send(res, 500, 'Server error');
  }
});

server.listen(port, () => {
  console.log(`Quick Vote is running on port ${port}. Data folder: ${dataDir}`);
  if (!env.CREATE_CODE) console.warn('Warning: CREATE_CODE is not set. Anyone who can reach this server can make polls.');
});

function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
