// Serveur Foyer : API JSON (SQLite) + fichiers statiques de l'app.
// Zéro dépendance : node:http + node:sqlite (Node ≥ 22.13).
//
//   FOYER_TOKEN=secret FOYER_DB=/var/lib/foyer/foyer.db PORT=3311 node server/index.js
//
// Sans FOYER_TOKEN, l'API est ouverte : réservé au développement local.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, readState, writeCollections, resetAll } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3311;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.FOYER_DB || path.join(ROOT, 'data', 'foyer.db');
const TOKEN = (process.env.FOYER_TOKEN || '').trim();
const SERVE_STATIC = process.env.FOYER_STATIC !== '0';
const MAX_BODY = 8 * 1024 * 1024;

if (process.argv.includes('--make-token')) {
  console.log(crypto.randomBytes(24).toString('hex'));
  process.exit(0);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const NO_CACHE = new Set(['/index.html', '/sw.js', '/manifest.json']);
const PRIVATE = ['/server/', '/data/', '/node_modules/', '/.'];

function send(res, status, body, headers = {}) {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : headers['Content-Type'] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(buf);
}

function authorized(req) {
  if (!TOKEN) return true;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!got || got.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Corps trop volumineux')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/health') return send(res, 200, { ok: true, db: path.basename(DB_PATH), auth: !!TOKEN });
  if (!authorized(req)) return send(res, 401, { error: 'Code d’accès requis' });

  if (route === 'GET /api/state') return send(res, 200, readState(db));
  if (route === 'PUT /api/state' || route === 'PATCH /api/state') {
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); }
    catch (err) { return send(res, 400, { error: `JSON illisible : ${err.message}` }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Le corps doit être un objet' });
    try {
      const written = writeCollections(db, body);
      return send(res, 200, { ok: true, written, at: Date.now() });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }
  if (route === 'POST /api/reset') { resetAll(db); return send(res, 200, { ok: true }); }
  return send(res, 404, { error: 'Route inconnue' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (PRIVATE.some((x) => p.startsWith(x)) || p.includes('/../')) return send(res, 404, 'Introuvable');
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) return send(res, 404, 'Introuvable');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Application à page unique : les routes inconnues renvoient l'app.
      if (!path.extname(p)) return serveStatic(req, res, new URL('/index.html', 'http://x'));
      return send(res, 404, 'Introuvable');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': NO_CACHE.has(p) ? 'no-cache, must-revalidate' : 'public, max-age=86400',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!SERVE_STATIC) return send(res, 404, 'Introuvable');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'Erreur interne' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Foyer : http://${HOST}:${PORT}  · base ${DB_PATH} · ${TOKEN ? 'API protégée par FOYER_TOKEN' : 'API OUVERTE (définis FOYER_TOKEN en production)'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); try { db.close(); } catch {} process.exit(0); });
