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
export const membersOfFoyer = (db, foyerId) => db.prepare('SELECT id, login, nom, role, created_at FROM users WHERE foyer_id = ? ORDER BY created_at').all(foyerId);
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

export const publicUser = (u) => ({ id: u.id, login: u.login, nom: u.nom, role: u.role });

/* ---------- Clés VAPID (globales au serveur) ---------- */
export const pushConfig = (db) => db.prepare('SELECT * FROM push_config WHERE id = 1').get();
export const savePushConfig = (db, pub, priv, subject) => db.prepare('UPDATE push_config SET public_key = ?, private_key = ?, subject = ? WHERE id = 1').run(pub, priv, subject);
