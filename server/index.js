// Serveur Tartinou : comptes et foyers (accounts.db), une base SQLite par foyer,
// API JSON, temps réel (SSE), notifications push, fichiers statiques de l'app.
// Zéro dépendance : node:http + node:sqlite (Node ≥ 22.13).
//
//   FOYER_DB=/var/lib/foyer/foyer.db PORT=3311 node server/index.js
//
// Variables : FOYER_DB (chemin de base ; accounts.db et foyers/ vivent à côté), FOYER_TOKEN (code serveur
// demandé pour créer un nouveau foyer quand FOYER_INSCRIPTION=invitation, valeur par défaut),
// FOYER_INSCRIPTION=ouverte pour laisser n'importe qui créer un foyer, FOYER_STATIC=0 pour ne servir que l'API,
// FOYER_PUSH_SUBJECT (mailto: ou https: pour VAPID), TZ_APP (Europe/Paris).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, readState, writeCollections, resetAll, upsertSubscription, removeSubscription, listSubscriptions } from './db.js';
import * as A from './auth.js';
import { generateVapidKeys } from './webpush.js';
import { notifyFoyer, broadcast } from './notify.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3311;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.FOYER_DB || path.join(ROOT, 'data', 'foyer.db');
const DATA_DIR = path.dirname(DB_PATH);
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.db');
const FOYERS_DIR = path.join(DATA_DIR, 'foyers');
const SERVER_CODE = (process.env.FOYER_TOKEN || '').trim();
const OPEN_SIGNUP = process.env.FOYER_INSCRIPTION === 'ouverte';
const SERVE_STATIC = process.env.FOYER_STATIC !== '0';
const PUSH_SUBJECT = process.env.FOYER_PUSH_SUBJECT || 'mailto:tartinou@example.com';
const MAX_BODY = 8 * 1024 * 1024;

if (process.argv.includes('--make-token')) {
  console.log(crypto.randomBytes(24).toString('hex'));
  process.exit(0);
}

fs.mkdirSync(FOYERS_DIR, { recursive: true });
const accounts = A.openAccounts(ACCOUNTS_PATH);

/* ---------- Clés VAPID ---------- */
let vapid = A.pushConfig(accounts);
if (!vapid.public_key) {
  const k = generateVapidKeys();
  A.savePushConfig(accounts, k.publicKey, k.privateKey, PUSH_SUBJECT);
  vapid = A.pushConfig(accounts);
}
const VAPID = { publicKey: vapid.public_key, privateKey: vapid.private_key, subject: vapid.subject || PUSH_SUBJECT };

/* ---------- Bases par foyer ---------- */
const foyerDbs = new Map();
const foyerPath = (id) => path.join(FOYERS_DIR, `${id}.db`);
function dbFor(foyerId) {
  let db = foyerDbs.get(foyerId);
  if (!db) { db = openDb(foyerPath(foyerId)); foyerDbs.set(foyerId, db); }
  return db;
}
/** Premier foyer créé : il reprend l'ancienne base unique (v2.0) si elle existe. */
function adoptLegacy(foyerId) {
  if (!fs.existsSync(DB_PATH) || fs.existsSync(foyerPath(foyerId))) return false;
  fs.copyFileSync(DB_PATH, foyerPath(foyerId));
  for (const suffix of ['-wal', '-shm']) if (fs.existsSync(DB_PATH + suffix)) fs.copyFileSync(DB_PATH + suffix, foyerPath(foyerId) + suffix);
  fs.renameSync(DB_PATH, `${DB_PATH}.migre-${Date.now()}`);
  console.log(`Ancienne base ${path.basename(DB_PATH)} reprise par le foyer ${foyerId}`);
  return true;
}

/* ---------- Utilitaires HTTP ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const NO_CACHE = new Set(['/index.html', '/sw.js', '/manifest.json']);
const PRIVATE = ['/server/', '/data/', '/node_modules/', '/.'];

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
const fail = (res, status, error) => send(res, status, { error });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Corps trop volumineux')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Le corps doit être un objet');
  return obj;
}

const bearer = (req, url) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || url.searchParams.get('token') || '';
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

// Limitation simple des tentatives de connexion : 20 par quart d'heure et par adresse.
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 20;
}

/* ---------- Temps réel (SSE) ---------- */
const streams = new Map(); // foyerId → Set<res>
function emitChange(foyerId, payload) {
  const set = streams.get(foyerId);
  if (!set) return;
  const line = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) { try { res.write(line); } catch {} }
}

/* ---------- Auth : inscription, connexion ---------- */
async function handleAuth(req, res, url, route) {
  if (route === 'POST /api/auth/register') {
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    const login = A.normalizeLogin(b.login);
    const err = A.validateLogin(login) || A.validatePassword(b.password);
    if (err) return fail(res, 400, err);
    if (A.userByLogin(accounts, login)) return fail(res, 409, 'Cet identifiant est déjà pris.');
    const nom = String(b.nom || '').trim() || login;
    let foyer = null;
    let role = 'membre';
    if (String(b.codeInvitation || '').trim()) {
      foyer = A.foyerByCode(accounts, b.codeInvitation);
      if (!foyer) return fail(res, 400, 'Code d’invitation inconnu. Vérifie-le auprès de la personne qui t’invite.');
    } else {
      const first = A.countUsers(accounts) === 0;
      const allowed = first || OPEN_SIGNUP || (SERVER_CODE && String(b.codeServeur || '').trim() === SERVER_CODE);
      if (!allowed) return fail(res, 403, 'Pour créer un nouveau foyer, il faut le code serveur (FOYER_TOKEN). Pour rejoindre un foyer existant, saisis son code d’invitation.');
      foyer = A.createFoyer(accounts, b.nomFoyer || `Foyer de ${nom}`);
      role = 'admin';
      if (first) adoptLegacy(foyer.id);
    }
    const user = A.createUser(accounts, { login, nom, password: b.password, foyerId: foyer.id, role });
    const token = A.createSession(accounts, user.id, req.headers['user-agent']);
    return send(res, 201, { token, user: A.publicUser(user), foyer: foyerView(foyer, user) });
  }
  if (route === 'POST /api/auth/login') {
    if (tooMany(clientIp(req))) return fail(res, 429, 'Trop de tentatives, réessaie dans quelques minutes.');
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    const user = A.userByLogin(accounts, A.normalizeLogin(b.login));
    if (!user || !A.checkPassword(user, String(b.password || ''))) return fail(res, 401, 'Identifiant ou mot de passe incorrect.');
    const token = A.createSession(accounts, user.id, req.headers['user-agent']);
    return send(res, 200, { token, user: A.publicUser(user), foyer: foyerView(A.foyerById(accounts, user.foyer_id), user) });
  }
  return fail(res, 404, 'Route inconnue');
}

function foyerView(foyer, user) {
  return { id: foyer.id, nom: foyer.nom, codeInvitation: user.role === 'admin' ? foyer.code_invitation : null, membres: A.membersOfFoyer(accounts, foyer.id).map((m) => ({ id: m.id, nom: m.nom, login: m.login, role: m.role })) };
}

/* ---------- API authentifiée ---------- */
async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/health') return send(res, 200, { ok: true, foyers: A.listFoyers(accounts).length, inscription: OPEN_SIGNUP ? 'ouverte' : 'invitation', premierCompte: A.countUsers(accounts) === 0 });
  if (url.pathname.startsWith('/api/auth/')) {
    if (route === 'POST /api/auth/logout') { A.deleteSession(accounts, bearer(req, url)); return send(res, 200, { ok: true }); }
    if (route !== 'POST /api/auth/password') return handleAuth(req, res, url, route);
  }

  const token = bearer(req, url);
  const user = A.sessionUser(accounts, token);
  if (!user) return fail(res, 401, 'Connecte-toi pour continuer.');
  const foyer = A.foyerById(accounts, user.foyer_id);
  const db = dbFor(foyer.id);
  const isAdmin = user.role === 'admin';

  if (route === 'GET /api/me') return send(res, 200, { user: A.publicUser(user), foyer: foyerView(foyer, user), push: { publicKey: VAPID.publicKey, appareils: listSubscriptions(db).map((s) => ({ id: s.id, label: s.label, member: s.member })) } });

  if (route === 'POST /api/auth/password') {
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    if (!A.checkPassword(user, String(b.ancien || ''))) return fail(res, 400, 'Ancien mot de passe incorrect.');
    const err = A.validatePassword(b.nouveau);
    if (err) return fail(res, 400, err);
    A.setPassword(accounts, user.id, b.nouveau);
    A.deleteUserSessions(accounts, user.id);
    const fresh = A.createSession(accounts, user.id, req.headers['user-agent']);
    return send(res, 200, { ok: true, token: fresh });
  }
  if (route === 'POST /api/foyer') {
    if (!isAdmin) return fail(res, 403, 'Réservé à l’administrateur du foyer.');
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    if (b.nom !== undefined) A.renameFoyer(accounts, foyer.id, b.nom);
    if (b.nouveauCode) A.regenerateCode(accounts, foyer.id);
    return send(res, 200, { foyer: foyerView(A.foyerById(accounts, foyer.id), user) });
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/members/')) {
    if (!isAdmin) return fail(res, 403, 'Réservé à l’administrateur du foyer.');
    const id = url.pathname.slice('/api/members/'.length);
    if (id === user.id) return fail(res, 400, 'Tu ne peux pas te retirer toi-même.');
    const target = A.userById(accounts, id);
    if (!target || target.foyer_id !== foyer.id) return fail(res, 404, 'Membre introuvable.');
    A.removeUser(accounts, id);
    return send(res, 200, { foyer: foyerView(foyer, user) });
  }

  if (route === 'GET /api/state') return send(res, 200, readState(db));
  if (route === 'PUT /api/state' || route === 'PATCH /api/state') {
    let body; try { body = await readJson(req); } catch (err) { return fail(res, 400, `JSON illisible : ${err.message}`); }
    try {
      const written = writeCollections(db, body);
      const at = Date.now();
      emitChange(foyer.id, { written, at, by: user.nom, client: String(req.headers['x-client-id'] || '') });
      return send(res, 200, { ok: true, written, at });
    } catch (err) { return fail(res, 400, err.message); }
  }
  if (route === 'POST /api/reset') {
    if (!isAdmin) return fail(res, 403, 'Réservé à l’administrateur du foyer.');
    resetAll(db);
    emitChange(foyer.id, { written: ['settings', 'categories', 'expenses', 'menus', 'promptForm', 'recettes', 'stock'], at: Date.now(), by: user.nom, client: String(req.headers['x-client-id'] || '') });
    return send(res, 200, { ok: true });
  }

  if (route === 'GET /api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n');
    const set = streams.get(foyer.id) || streams.set(foyer.id, new Set()).get(foyer.id);
    set.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ping); set.delete(res); });
    return;
  }

  if (route === 'GET /api/push/key') return send(res, 200, { publicKey: VAPID.publicKey });
  if (route === 'POST /api/push/subscribe') {
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    const s = b.subscription;
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return fail(res, 400, 'Abonnement incomplet.');
    upsertSubscription(db, { id: A.newId(), endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, label: String(b.label || '').slice(0, 80), member: user.nom });
    return send(res, 200, { ok: true });
  }
  if (route === 'DELETE /api/push/subscribe') {
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    if (b.endpoint) removeSubscription(db, b.endpoint);
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/push/test') {
    const n = await broadcast(db, VAPID, { title: 'Tartinou', body: `Les notifications fonctionnent sur ce foyer (${user.nom}).`, url: '#reglages', tag: 'test' });
    return send(res, 200, { ok: true, envoyees: n });
  }
  return fail(res, 404, 'Route inconnue');
}

/* ---------- Fichiers statiques ---------- */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (PRIVATE.some((x) => p.startsWith(x)) || p.includes('/../')) return send(res, 404, 'Introuvable');
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) return send(res, 404, 'Introuvable');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
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
    return fail(res, 500, 'Erreur interne');
  }
});

/* ---------- Notifications planifiées ---------- */
async function tick() {
  for (const f of A.listFoyers(accounts)) {
    try { await notifyFoyer(dbFor(f.id), VAPID); }
    catch (err) { console.warn('notifications', f.id, err.message); }
  }
}
const timer = setInterval(tick, 5 * 60000);
setTimeout(tick, 15000);

server.listen(PORT, HOST, () => {
  console.log(`Tartinou : http://${HOST}:${PORT} · données dans ${DATA_DIR} · inscription ${OPEN_SIGNUP ? 'ouverte' : `sur invitation${SERVER_CODE ? ' (code serveur défini)' : ' (premier compte libre)'}`}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearInterval(timer); server.close(); try { accounts.close(); for (const db of foyerDbs.values()) db.close(); } catch {} process.exit(0); });
