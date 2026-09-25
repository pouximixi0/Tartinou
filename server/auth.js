// Comptes, foyers et sessions. Base séparée (accounts.db) ; chaque foyer a sa
// propre base de données (voir index.js). Mots de passe hachés avec scrypt.
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS foyers (id TEXT PRIMARY KEY, nom TEXT NOT NULL, code_invitation TEXT NOT NULL UNIQUE, created_at INTEGER);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, nom TEXT NOT NULL, pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
  foyer_id TEXT NOT NULL REFERENCES foyers(id), role TEXT NOT NULL DEFAULT 'membre', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT, created_at INTEGER, last_seen INTEGER);
CREATE TABLE IF NOT EXISTS push_config (id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT, private_key TEXT, subject TEXT);
`;

export const newId = () => crypto.randomBytes(9).toString('base64url');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
const newCode = () => crypto.randomBytes(4).toString('hex').toUpperCase().replace(/^(.{4})(.{4})$/, '$1-$2');

export function openAccounts(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec('INSERT OR IGNORE INTO push_config (id) VALUES (1)');
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  return db;
}

function hash(password, salt) {
  return crypto.scryptSync(String(password).normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64');
}
export function checkPassword(user, password) {
  const h = hash(password, user.pass_salt);
  const a = Buffer.from(h), b = Buffer.from(user.pass_hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const normalizeLogin = (s) => String(s || '').trim().toLowerCase();
export function validateLogin(login) {
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) return 'L’identifiant fait 3 à 32 caractères : lettres, chiffres, point, tiret.';
  return null;
}
export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Le mot de passe fait au moins 8 caractères.';
  if (p.length > 200) return 'Mot de passe trop long.';
  return null;
}

export const countUsers = (db) => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
export const userByLogin = (db, login) => db.prepare('SELECT * FROM users WHERE login = ?').get(login) || null;
export const userById = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
export const foyerById = (db, id) => db.prepare('SELECT * FROM foyers WHERE id = ?').get(id) || null;
export const foyerByCode = (db, code) => db.prepare('SELECT * FROM foyers WHERE code_invitation = ?').get(String(code || '').trim().toUpperCase()) || null;
export const listFoyers = (db) => db.prepare('SELECT * FROM foyers ORDER BY rowid').all();

export function createFoyer(db, nom) {
  const f = { id: newId(), nom: String(nom || 'Mon foyer').trim().slice(0, 60) || 'Mon foyer', code_invitation: newCode(), created_at: Date.now() };
  db.prepare('INSERT INTO foyers (id, nom, code_invitation, created_at) VALUES (?, ?, ?, ?)').run(f.id, f.nom, f.code_invitation, f.created_at);
  return f;
}
export function regenerateCode(db, foyerId) {
  const code = newCode();
  db.prepare('UPDATE foyers SET code_invitation = ? WHERE id = ?').run(code, foyerId);
  return code;
}
export function renameFoyer(db, foyerId, nom) {
  db.prepare('UPDATE foyers SET nom = ? WHERE id = ?').run(String(nom || '').trim().slice(0, 60) || 'Mon foyer', foyerId);
}

export function createUser(db, { login, nom, password, foyerId, role = 'membre' }) {
  const salt = crypto.randomBytes(16).toString('base64');
  const u = { id: newId(), login, nom: String(nom || login).trim().slice(0, 40) || login, pass_hash: hash(password, salt), pass_salt: salt, foyer_id: foyerId, role, created_at: Date.now() };
  db.prepare('INSERT INTO users (id, login, nom, pass_hash, pass_salt, foyer_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u.id, u.login, u.nom, u.pass_hash, u.pass_salt, u.foyer_id, u.role, u.created_at);
  return u;
}
export function setPassword(db, userId, password) {
  const salt = crypto.randomBytes(16).toString('base64');
  db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').run(hash(password, salt), salt, userId);
}
export const membersOfFoyer = (db, foyerId) => db.prepare('SELECT id, login, nom, role, avatar, created_at FROM users WHERE foyer_id = ? ORDER BY created_at').all(foyerId);
export const setAvatar = (db, userId, dataUrl) => db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(dataUrl || null, userId);
export function removeUser(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function createSession(db, userId, label) {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, label, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(token, userId, String(label || '').slice(0, 120), Date.now(), Date.now());
  return token;
}
export function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare('SELECT s.token, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!row) return null;
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(Date.now(), token);
  return row;
}
export const deleteSession = (db, token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
export const deleteUserSessions = (db, userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

/** Tous les utilisateurs du serveur avec le nom de leur foyer (pour l'annuaire de la communauté). */
export const listAllUsers = (db) => db.prepare('SELECT u.id, u.nom, u.login, u.role, u.avatar, u.created_at, u.foyer_id, f.nom AS foyer FROM users u JOIN foyers f ON f.id = u.foyer_id ORDER BY f.rowid, u.created_at').all();
export const publicUser = (u) => ({ id: u.id, login: u.login, nom: u.nom, role: u.role, avatar: u.avatar || null });

/* ---------- Clés VAPID (globales au serveur) ---------- */
export const pushConfig = (db) => db.prepare('SELECT * FROM push_config WHERE id = 1').get();
export const savePushConfig = (db, pub, priv, subject) => db.prepare('UPDATE push_config SET public_key = ?, private_key = ?, subject = ? WHERE id = 1').run(pub, priv, subject);

/* ---------- Communauté : flux commun à tous les utilisateurs du serveur ---------- */
export function ensureCommunity(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS community_posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, foyer_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'message', texte TEXT NOT NULL DEFAULT '',
    payload TEXT, at INTEGER NOT NULL, reactions TEXT NOT NULL DEFAULT '{}', commentaires TEXT NOT NULL DEFAULT '[]'
  )`);
}
const jparse = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };

/** Les 120 dernières publications, avec auteur (nom, avatar, foyer) et réactions en prénoms. */
export function listCommunity(db, limit = 120) {
  const rows = db.prepare(`SELECT p.*, u.nom AS auteur, u.login, u.avatar, f.nom AS foyer_nom FROM community_posts p
    JOIN users u ON u.id = p.user_id JOIN foyers f ON f.id = p.foyer_id ORDER BY p.at DESC LIMIT ?`).all(limit);
  const names = new Map(db.prepare('SELECT id, nom FROM users').all().map((u) => [u.id, u.nom]));
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, auteur: r.auteur, login: r.login, avatar: r.avatar || null, foyer: r.foyer_nom, type: r.type, texte: r.texte, payload: jparse(r.payload, null), at: r.at,
    reactions: Object.fromEntries(Object.entries(jparse(r.reactions, {})).map(([emo, ids]) => [emo, ids.map((id) => names.get(id) || '?')])),
    reactionsIds: jparse(r.reactions, {}),
    commentaires: jparse(r.commentaires, []).map((c) => ({ ...c, auteur: names.get(c.userId) || c.auteur || '?' })),
  }));
}
export const communityPost = (db, id) => db.prepare('SELECT * FROM community_posts WHERE id = ?').get(id) || null;
export function createCommunityPost(db, user, { type = 'message', texte = '', payload = null }) {
  const p = { id: newId(), user_id: user.id, foyer_id: user.foyer_id, type: ['message', 'recette', 'menu', 'liste', 'produit'].includes(type) ? type : 'message', texte: String(texte || '').trim().slice(0, 1000), payload: payload ? JSON.stringify(payload) : null, at: Date.now() };
  if (!p.texte && !p.payload) return null;
  db.prepare('INSERT INTO community_posts (id, user_id, foyer_id, type, texte, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.id, p.user_id, p.foyer_id, p.type, p.texte, p.payload, p.at);
  db.exec('DELETE FROM community_posts WHERE id NOT IN (SELECT id FROM community_posts ORDER BY at DESC LIMIT 1000)');
  return p;
}
export function toggleCommunityReaction(db, id, emoji, userId) {
  const p = communityPost(db, id);
  if (!p) return null;
  const r = jparse(p.reactions, {});
  const list = r[emoji] || [];
  r[emoji] = list.includes(userId) ? list.filter((x) => x !== userId) : [...list, userId];
  if (!r[emoji].length) delete r[emoji];
  db.prepare('UPDATE community_posts SET reactions = ? WHERE id = ?').run(JSON.stringify(r), id);
  return { added: !list.includes(userId), post: p };
}
export function addCommunityComment(db, id, user, texte) {
  const p = communityPost(db, id);
  const t = String(texte || '').trim().slice(0, 600);
  if (!p || !t) return null;
  const list = jparse(p.commentaires, []);
  const c = { id: newId(), userId: user.id, texte: t, at: Date.now() };
  list.push(c);
  db.prepare('UPDATE community_posts SET commentaires = ? WHERE id = ?').run(JSON.stringify(list.slice(-200)), id);
  return { comment: c, post: p, participants: [...new Set(list.map((x) => x.userId))] };
}
export function deleteCommunityComment(db, id, commentId, user) {
  const p = communityPost(db, id);
  if (!p) return false;
  const list = jparse(p.commentaires, []);
  const c = list.find((x) => x.id === commentId);
  if (!c || (c.userId !== user.id && p.user_id !== user.id)) return false;
  db.prepare('UPDATE community_posts SET commentaires = ? WHERE id = ?').run(JSON.stringify(list.filter((x) => x.id !== commentId)), id);
  return true;
}
export function deleteCommunityPost(db, id, user) {
  const p = communityPost(db, id);
  if (!p || p.user_id !== user.id) return false;
  db.prepare('DELETE FROM community_posts WHERE id = ?').run(id);
  return true;
}
const escapeRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const usersMentioned = (db, texte) => db.prepare('SELECT id, nom, login, foyer_id FROM users').all().filter((u) => new RegExp(`@(${escapeRe(u.nom)}|${escapeRe(u.login)})(?![\\p{L}\\p{N}_])`, 'iu').test(texte || ''));
