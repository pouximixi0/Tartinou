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
import { openDb, readState, writeCollections, resetAll, upsertSubscription, removeSubscription, listSubscriptions, postsSnapshot, publicRecipe, stockCodes, recallsCheckedAt, recallsCheckedCodes, setRecallsChecked, saveRecalls, listRecalls, markRecallsNotified } from './db.js';
import { fetchRecalls } from './recalls.js';
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
A.ensureCommunity(accounts);

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
/** Événement pour tous les foyers connectés (flux communauté). */
function emitAll(payload) { for (const id of streams.keys()) emitChange(id, payload); }
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
  return { id: foyer.id, nom: foyer.nom, codeInvitation: user.role === 'admin' ? foyer.code_invitation : null, membres: A.membersOfFoyer(accounts, foyer.id).map((m) => ({ id: m.id, nom: m.nom, login: m.login, role: m.role, avatar: m.avatar || null })) };
}

/* ---------- API authentifiée ---------- */
async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/health') return send(res, 200, { ok: true, foyers: A.listFoyers(accounts).length, inscription: OPEN_SIGNUP ? 'ouverte' : 'invitation', premierCompte: A.countUsers(accounts) === 0 });
  if (req.method === 'GET' && url.pathname.startsWith('/api/public/recette/')) {
    const found = findPublicRecipe(url.pathname.slice('/api/public/recette/'.length));
    return found ? send(res, 200, found) : fail(res, 404, 'Recette introuvable ou partage retiré.');
  }
  if (url.pathname.startsWith('/api/auth/')) {
    if (route === 'POST /api/auth/logout') { A.deleteSession(accounts, bearer(req, url)); return send(res, 200, { ok: true }); }
    if (route !== 'POST /api/auth/password' && route !== 'POST /api/auth/avatar' && route !== 'DELETE /api/auth/avatar') return handleAuth(req, res, url, route);
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
  if (route === 'POST /api/auth/avatar') {
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    const img = String(b.image || '');
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) return fail(res, 400, 'Image attendue en JPEG, PNG ou WebP.');
    if (img.length > 80000) return fail(res, 400, 'Image trop lourde (60 Ko maximum après réduction).');
    A.setAvatar(accounts, user.id, img);
    emitChange(foyer.id, { written: ['membres'], at: Date.now(), by: user.nom, client: '' });
    return send(res, 200, { ok: true });
  }
  if (route === 'DELETE /api/auth/avatar') {
    A.setAvatar(accounts, user.id, null);
    emitChange(foyer.id, { written: ['membres'], at: Date.now(), by: user.nom, client: '' });
    return send(res, 200, { ok: true });
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
      const before = Array.isArray(body.posts) ? postsSnapshot(db) : null;
      const written = writeCollections(db, body);
      const at = Date.now();
      emitChange(foyer.id, { written, at, by: user.nom, client: String(req.headers['x-client-id'] || '') });
      if (before) feedNotifications(db, foyer, user, body.posts, before);
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
    res.userId = user.id;
    set.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ping); set.delete(res); });
    return;
  }

  /* ---- Communauté : flux commun à tous les utilisateurs ---- */
  if (route === 'GET /api/community/membres') {
    const online = new Set();
    for (const set of streams.values()) for (const r of set) if (r.userId) online.add(r.userId);
    return send(res, 200, { membres: A.listAllUsers(accounts).map((u) => ({ id: u.id, nom: u.nom, login: u.login, role: u.role, avatar: u.avatar || null, foyer: u.foyer, foyerId: u.foyer_id, monFoyer: u.foyer_id === foyer.id, moi: u.id === user.id, enLigne: online.has(u.id), depuis: u.created_at })) });
  }
  if (route === 'GET /api/community') {
    return send(res, 200, { posts: A.listCommunity(accounts).map((p) => ({ ...p, mine: p.userId === user.id, reactionsIds: undefined, commentaires: p.commentaires.map((c) => ({ id: c.id, auteur: c.auteur, texte: c.texte, at: c.at, mine: c.userId === user.id })) })) });
  }
  if (route === 'POST /api/community') {
    let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
    const p = A.createCommunityPost(accounts, user, b);
    if (!p) return fail(res, 400, 'Publication vide.');
    emitAll({ written: ['community'], at: Date.now(), by: user.nom, client: String(req.headers['x-client-id'] || '') });
    for (const m of A.usersMentioned(accounts, p.texte)) if (m.id !== user.id) notifyUser(m, { title: `${user.nom} t’a mentionné`, body: p.texte.slice(0, 140), url: '#communaute', tag: `cm-${p.id}` });
    return send(res, 201, { ok: true, id: p.id });
  }
  const cm = url.pathname.match(/^\/api\/community\/([A-Za-z0-9_-]+)(?:\/(react|comment)(?:\/([A-Za-z0-9_-]+))?)?$/);
  if (cm) {
    const [, id, action, sub] = cm;
    const bump = () => emitAll({ written: ['community'], at: Date.now(), by: user.nom, client: String(req.headers['x-client-id'] || '') });
    if (req.method === 'DELETE' && !action) { if (!A.deleteCommunityPost(accounts, id, user)) return fail(res, 403, 'Seul l’auteur peut supprimer.'); bump(); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && action === 'react') {
      let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
      const emo = String(b.emoji || '').slice(0, 8);
      if (!emo) return fail(res, 400, 'Réaction vide.');
      const r = A.toggleCommunityReaction(accounts, id, emo, user.id);
      if (!r) return fail(res, 404, 'Publication introuvable.');
      bump();
      if (r.added && r.post.user_id !== user.id) { const owner = A.userById(accounts, r.post.user_id); if (owner) notifyUser(owner, { title: `${user.nom} a réagi ${emo}`, body: r.post.texte.slice(0, 100), url: '#communaute', tag: `cr-${id}` }); }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && action === 'comment') {
      let b; try { b = await readJson(req); } catch (err) { return fail(res, 400, err.message); }
      const r = A.addCommunityComment(accounts, id, user, b.texte);
      if (!r) return fail(res, 400, 'Commentaire vide ou publication introuvable.');
      bump();
      const targets = new Set([r.post.user_id, ...r.participants, ...A.usersMentioned(accounts, r.comment.texte).map((m) => m.id)]);
      targets.delete(user.id);
      for (const uid of targets) { const u = A.userById(accounts, uid); if (u) notifyUser(u, { title: `${user.nom} a commenté`, body: r.comment.texte.slice(0, 140), url: '#communaute', tag: `cc-${id}` }); }
      return send(res, 201, { ok: true, id: r.comment.id });
    }
    if (req.method === 'DELETE' && action === 'comment' && sub) { if (!A.deleteCommunityComment(accounts, id, sub, user)) return fail(res, 403, 'Commentaire introuvable ou pas à toi.'); bump(); return send(res, 200, { ok: true }); }
    return fail(res, 404, 'Route inconnue');
  }

  /* ---- Rappels de produits : codes du stock confrontés à RappelConso ---- */
  if (route === 'GET /api/rappels') {
    let list;
    try { list = await refreshRecalls(foyer.id); }
    catch (err) { console.warn('rappels', err.message); list = listRecalls(db); }
    const codes = new Set(stockCodes(db).map((c) => Number(String(c).replace(/\D/g, ''))));
    return send(res, 200, { rappels: list.filter((r) => codes.has(Number(r.gtin))), verifieLe: recallsCheckedAt(db) });
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

/* ---------- Recettes publiques (lien partagé) ---------- */
function findPublicRecipe(shareId) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(shareId)) return null;
  for (const f of A.listFoyers(accounts)) {
    const r = publicRecipe(dbFor(f.id), shareId);
    if (r) return { ...r, foyer: f.nom, partage: shareId };
  }
  return null;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function recipePage(r, shareId) {
  const steps = String(r.recette || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.nom)} · Tartinou</title>
<meta property="og:title" content="${esc(r.nom)}"><meta property="og:description" content="Recette partagée depuis Tartinou · ${r.temps || '?'} min · ${r.personnes || 2} pers."><link rel="icon" href="/icons/icon-192.png">
<style>body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:#F4F3EF;color:#17160F;margin:0;padding:24px 16px 48px;line-height:1.45}main{max-width:560px;margin:0 auto}h1{font-size:1.6rem;letter-spacing:-.02em;margin:0 0 4px}.muted{color:#74726A}.card{background:#fff;border:1px solid #E2E0D9;border-radius:16px;padding:16px 18px;margin:14px 0}ul,ol{padding-left:20px;margin:6px 0}li{margin:4px 0}.btn{display:inline-block;background:#17160F;color:#F7F6F2;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;margin-top:8px}.brand{display:flex;align-items:center;gap:8px;font-weight:800;margin-bottom:18px}.brand img{width:28px;height:28px;border-radius:7px}
@media(prefers-color-scheme:dark){body{background:#121211;color:#EEECE6}.card{background:#1C1B19;border-color:#2C2B28}.muted{color:#948F85}.btn{background:#EEECE6;color:#121211}}</style></head><body><main>
<div class="brand"><img src="/icons/icon-192.png" alt="">Tartinou</div>
<h1>${esc(r.nom)}</h1><p class="muted">${r.temps || '?'} min · ${r.personnes || 2} personne${(r.personnes || 2) > 1 ? 's' : ''}${r.tags?.length ? ' · ' + esc(r.tags.join(', ')) : ''} · partagée par ${esc(r.foyer)}</p>
${r.ingredients?.length ? `<section class="card"><strong>Ingrédients</strong><ul>${r.ingredients.map((i) => `<li>${esc(i.article)}${i.quantite ? ' · ' + esc(i.quantite) : ''}</li>`).join('')}</ul></section>` : ''}
<section class="card"><strong>Recette</strong>${steps.length > 1 ? `<ol>${steps.map((s) => `<li>${esc(s.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol>` : `<p>${esc(r.recette)}</p>`}</section>
<p><a href="${esc(r.lien || `https://www.marmiton.org/recettes/recherche.aspx?aqt=${encodeURIComponent(r.nom).replace(/%20/g, '+')}`)}" target="_blank" rel="noopener noreferrer">${r.lien ? 'Voir la recette d\'origine' : 'Chercher la recette sur Marmiton'}</a></p>
<a class="btn" href="/#recette=${esc(shareId)}">Ajouter à mes recettes Tartinou</a>
<p class="muted" style="font-size:.9rem">Tartinou : dépenses, menus et stock alimentaire, sur ton propre serveur.</p></main></body></html>`;
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
    if (req.method === 'GET' && url.pathname.startsWith('/p/r/')) {
      const found = findPublicRecipe(url.pathname.slice('/p/r/'.length));
      if (!found) return send(res, 404, 'Recette introuvable ou partage retiré.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(recipePage(found, found.partage));
    }
    if (!SERVE_STATIC) return send(res, 404, 'Introuvable');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Erreur interne');
  }
});

/* ---------- Notifications du flux : publications, commentaires, réactions, mentions ---------- */
const TYPE_LABEL = { message: 'a écrit', recette: 'a partagé une recette', menu: 'a partagé le menu', liste: 'a partagé la liste de courses' };
function feedNotifications(db, foyer, user, posts, before) {
  const members = A.membersOfFoyer(accounts, foyer.id);
  const subs = listSubscriptions(db);
  const to = (names) => subs.filter((s) => s.member !== user.nom && (!names || names.includes(s.member)));
  const mentioned = (texte) => members.filter((m) => m.nom !== user.nom && new RegExp(`@${m.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(texte || '')).map((m) => m.nom);
  let sent = 0;
  for (const p of posts) {
    if (!p || !p.id || sent > 6) continue;
    const old = before.get(p.id);
    if (!old) {
      if (p.auteur !== user.nom) continue;
      const body = p.type === 'message' ? String(p.texte).slice(0, 140) : String(p.texte).replace(/^a partagé une recette : /, '').slice(0, 140);
      const men = mentioned(p.texte);
      for (const s of to(null)) {
        const isMention = men.includes(s.member);
        notifyMembers([s], { title: isMention ? `${user.nom} t’a mentionné` : `${user.nom} ${TYPE_LABEL[p.type] || 'a publié'}`, body, url: '#communaute', tag: `post-${p.id}` });
      }
      sent++;
      continue;
    }
    // Nouveaux commentaires de cette personne.
    for (const c of p.commentaires || []) {
      if (!c || old.commentaires.has(c.id) || c.auteur !== user.nom) continue;
      const others = new Set([old.auteur, ...(p.commentaires || []).map((x) => x.auteur), ...mentioned(c.texte)].filter((n) => n && n !== user.nom));
      notifyMembers(to([...others]), { title: `${user.nom} a commenté`, body: String(c.texte).slice(0, 140), url: '#communaute', tag: `comm-${p.id}` });
      sent++;
    }
    // Nouvelle réaction de cette personne : on prévient l'auteur de la publication.
    for (const [emo, names] of Object.entries(p.reactions || {})) {
      const was = old.reactions[emo] || new Set();
      if (names.includes(user.nom) && !was.has(user.nom) && old.auteur && old.auteur !== user.nom) {
        notifyMembers(to([old.auteur]), { title: `${user.nom} a réagi ${emo}`, body: String(p.texte).slice(0, 100), url: '#communaute', tag: `react-${p.id}` });
        sent++;
      }
    }
  }
}

/** Notifie tous les appareils d'un utilisateur (ses abonnements vivent dans la base de son foyer). */
function notifyUser(u, payload) {
  try {
    const subs = listSubscriptions(dbFor(u.foyer_id)).filter((s) => s.member === u.nom);
    if (subs.length) notifyMembers(subs, payload);
  } catch (err) { console.warn('notifyUser', err.message); }
}

/* ---------- Notification directe à des abonnés ---------- */
async function notifyMembers(subs, payload) {
  for (const s of subs) {
    try {
      const { sendPush } = await import('./webpush.js');
      const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, VAPID);
      if (r.status === 404 || r.status === 410) removeSubscription(dbForSub(s), s.endpoint);
    } catch (err) { console.warn('push message', err.message); }
  }
}
function dbForSub(sub) { for (const [id, db] of foyerDbs) if (listSubscriptions(db).some((x) => x.endpoint === sub.endpoint)) return db; return null; }

/* ---------- Rappels de produits : au plus une vérification par foyer toutes les 12 h ---------- */
const RECALL_INTERVAL = 12 * 3600000;
async function refreshRecalls(foyerId, { force = false } = {}) {
  const db = dbFor(foyerId);
  const codes = stockCodes(db);
  const hash = [...codes].sort().join(',');
  if (!force && hash === recallsCheckedCodes(db) && Date.now() - recallsCheckedAt(db) < RECALL_INTERVAL) return listRecalls(db);
  if (codes.length) {
    const found = await fetchRecalls(codes);
    const fresh = saveRecalls(db, found);
    if (fresh.length) {
      const subs = listSubscriptions(db);
      if (subs.length) notifyMembers(subs, { title: fresh.length > 1 ? `${fresh.length} produits de ton stock sont rappelés` : 'Un produit de ton stock est rappelé', body: fresh.map((r) => r.libelle).join(', ').slice(0, 140), url: '#stock', tag: 'rappel' });
      markRecallsNotified(db);
    }
  }
  setRecallsChecked(db, hash);
  return listRecalls(db);
}

/* ---------- Notifications planifiées ---------- */
async function tick() {
  for (const f of A.listFoyers(accounts)) {
    try { await notifyFoyer(dbFor(f.id), VAPID); }
    catch (err) { console.warn('notifications', f.id, err.message); }
    try { await refreshRecalls(f.id); }
    catch (err) { console.warn('rappels', f.id, err.message); }
  }
}
const timer = setInterval(tick, 5 * 60000);
setTimeout(tick, 15000);

server.listen(PORT, HOST, () => {
  console.log(`Tartinou : http://${HOST}:${PORT} · données dans ${DATA_DIR} · inscription ${OPEN_SIGNUP ? 'ouverte' : `sur invitation${SERVER_CODE ? ' (code serveur défini)' : ' (premier compte libre)'}`}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearInterval(timer); server.close(); try { accounts.close(); for (const db of foyerDbs.values()) db.close(); } catch {} process.exit(0); });
