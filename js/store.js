// État global de l'app. La source de vérité est la base SQLite du foyer sur le
// serveur ; localStorage ne sert que de cache (démarrage instantané, hors ligne)
// et de file d'attente : chaque collection modifiée est renvoyée au serveur.
// Les autres appareils du foyer sont prévenus en temps réel (SSE) et se mettent à jour.
import { todayISO } from './utils.js';
import { api, getToken, setToken, getClientId } from './api.js';
import { setActor } from './stock.js';

export const STORAGE_KEY = 'foyer:v2';
const LEGACY_KEY = 'foyer:v1';
export const SCHEMA_VERSION = 2;
export const COLLECTIONS = ['settings', 'categories', 'expenses', 'menus', 'promptForm', 'recettes', 'stock', 'messages'];

export const DEFAULT_CATEGORIES = [
  { id: 'courses', nom: 'Courses', couleur: '#3A7D44' },
  { id: 'restaurant', nom: 'Restaurant', couleur: '#D97706' },
  { id: 'transport', nom: 'Transport', couleur: '#2563EB' },
  { id: 'loisirs', nom: 'Loisirs', couleur: '#7C3AED' },
  { id: 'sante', nom: 'Santé', couleur: '#0D9488' },
  { id: 'maison', nom: 'Maison', couleur: '#8B5E3C' },
  { id: 'autre', nom: 'Autre', couleur: '#64748B' },
];

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      revenuMensuel: 0,
      chargesFixes: [],
      epargneVisee: 0,
      debutMois: 1,
      partCourses: 40,
      budgetStrict: false,
      theme: 'system',
      onboarded: false,
      createdAt: todayISO(),
      stock: { alertDays: 3, scanContinu: true, vibration: true, son: true },
      allergenes: [],
      objectifs: {},
      notifs: { actives: true, heure: 18, dlc: true, hebdo: true, mensuel: true, objectifs: true },
    },
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    expenses: [],
    menus: { weeks: [], currentId: null },
    promptForm: { personnes: 2, budget: '', regime: '', allergies: '', tempsMax: 30, placards: '', repas: 'midi-soir-7', restesDabord: false },
    recettes: [],
    stock: { items: [], products: {}, journal: [], aRacheter: [], prixHistorique: [] },
    messages: [],
  };
}

/**
 * Amène n'importe quelle version sauvegardée vers SCHEMA_VERSION.
 * Chaque palier ajoute son bloc `if (v < N)`.
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultState();
  let v = Number(raw.version) || 0;
  const s = { ...raw };
  if (v < 1) v = 1;
  if (v < 2) {
    // v1 → v2 : arrivée du stock alimentaire et de ses réglages.
    s.stock = s.stock || {};
    v = 2;
  }

  // Complète les clés manquantes avec les valeurs par défaut.
  const base = defaultState();
  const out = { ...base, ...s, version: SCHEMA_VERSION };
  out.settings = { ...base.settings, ...(s.settings || {}) };
  out.settings.stock = { ...base.settings.stock, ...((s.settings && s.settings.stock) || {}) };
  out.settings.notifs = { ...base.settings.notifs, ...((s.settings && s.settings.notifs) || {}) };
  if (!Array.isArray(out.settings.allergenes)) out.settings.allergenes = [];
  if (!out.settings.objectifs || typeof out.settings.objectifs !== 'object') out.settings.objectifs = {};
  out.menus = { ...base.menus, ...(s.menus || {}) };
  out.promptForm = { ...base.promptForm, ...(s.promptForm || {}) };
  out.stock = { ...base.stock, ...(s.stock || {}) };
  if (!Array.isArray(out.settings.chargesFixes)) out.settings.chargesFixes = [];
  if (!out.settings.createdAt) out.settings.createdAt = base.settings.createdAt;
  if (!Array.isArray(out.categories) || !out.categories.length) out.categories = base.categories;
  if (!Array.isArray(out.expenses)) out.expenses = [];
  if (!Array.isArray(out.menus.weeks)) out.menus.weeks = [];
  for (const w of out.menus.weeks) { w.checked = w.checked || {}; w.unavailable = w.unavailable || {}; w.manualItems = w.manualItems || []; w.cooked = w.cooked || {}; }
  if (!Array.isArray(out.recettes)) out.recettes = [];
  if (!Array.isArray(out.messages)) out.messages = [];
  if (!Array.isArray(out.stock.items)) out.stock.items = [];
  if (!out.stock.products || typeof out.stock.products !== 'object') out.stock.products = {};
  if (!Array.isArray(out.stock.journal)) out.stock.journal = [];
  if (!Array.isArray(out.stock.aRacheter)) out.stock.aRacheter = [];
  if (!Array.isArray(out.stock.prixHistorique)) out.stock.prixHistorique = [];
  return out;
}

/* ---------- Cache local ---------- */
function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      return { state: migrate(c.state), pending: Array.isArray(c.pending) ? c.pending : [], legacy: !!c.legacy, foyerId: c.foyerId || null };
    }
    // Ancienne version 100 % locale : on reprend ses données, elles seront envoyées au serveur s'il est vide.
    const old = localStorage.getItem(LEGACY_KEY);
    if (old) return { state: migrate(JSON.parse(old)), pending: [...COLLECTIONS], legacy: true, foyerId: null };
  } catch (err) {
    console.error('Cache local illisible, état réinitialisé', err);
  }
  return null;
}

const cached = loadCache();
let state = cached ? cached.state : defaultState();
const listeners = new Set();
const syncListeners = new Set();
/** status : 'idle' | 'syncing' | 'synced' | 'offline' | 'auth' | 'error' */
const sync = {
  status: 'idle', pending: new Set(cached ? cached.pending : []), legacy: !!(cached && cached.legacy), message: '', loaded: false, lastOk: null,
  user: null, foyer: null, foyerId: cached ? cached.foyerId : null, push: null, live: false,
};
let snapshots = snapshot(state);

function snapshot(s) {
  const o = {};
  for (const k of COLLECTIONS) o[k] = JSON.stringify(s[k]);
  return o;
}
function saveCache() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, state, pending: [...sync.pending], legacy: sync.legacy, foyerId: sync.foyerId })); }
  catch (err) { console.warn('Cache local non enregistré', err); }
}
function emit() { listeners.forEach((fn) => fn(state)); }
function emitSync() { syncListeners.forEach((fn) => fn(sync)); }
function setSync(status, message = '') { sync.status = status; sync.message = message; emitSync(); }

export const getState = () => state;
export const syncStatus = () => sync;
export const currentUser = () => sync.user;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onSync(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); }

/** Modifie l'état en place, met le cache à jour, planifie l'envoi, puis prévient l'UI (sauf `quiet`). */
export function update(mutator, { quiet = false } = {}) {
  mutator(state);
  persist();
  if (!quiet) emit();
}
function persist() {
  const now = snapshot(state);
  for (const k of COLLECTIONS) if (now[k] !== snapshots[k]) { sync.pending.add(k); snapshots[k] = now[k]; }
  saveCache();
  scheduleFlush();
}
export function replaceState(next) {
  state = migrate(next);
  for (const k of COLLECTIONS) sync.pending.add(k);
  snapshots = snapshot(state);
  saveCache();
  emit();
  scheduleFlush(0);
}
export function resetState() {
  replaceState(defaultState());
}
export const exportJSON = () => JSON.stringify(state, null, 2);

/* ---------- Synchronisation avec le serveur ---------- */
let flushTimer = null;
let flushing = false;
let retryDelay = 4000;
let pullAfterFlush = false;

function scheduleFlush(delay = 400) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

export async function flush() {
  if (flushing || !sync.pending.size) return;
  if (sync.status === 'auth') return;
  flushing = true;
  const keys = [...sync.pending];
  sync.pending.clear();
  const body = {};
  for (const k of keys) body[k] = state[k];
  setSync('syncing');
  try {
    await api('PUT', '/state', body);
    retryDelay = 4000;
    sync.lastOk = Date.now();
    sync.legacy = false;
    saveCache();
    setSync(sync.pending.size ? 'syncing' : 'synced');
  } catch (err) {
    for (const k of keys) sync.pending.add(k);
    saveCache();
    if (err.status === 401) setSync('auth', err.message);
    else if (err.status === 0) setSync('offline', 'Hors ligne : les modifications seront envoyées plus tard.');
    else setSync('error', err.message);
    if (err.status !== 401) { scheduleFlush(retryDelay); retryDelay = Math.min(60000, retryDelay * 2); }
  } finally {
    flushing = false;
    if (sync.pending.size && sync.status === 'synced') scheduleFlush(200);
    else if (!sync.pending.size && pullAfterFlush) { pullAfterFlush = false; pullFromServer(); }
  }
}

/** Recharge l'état depuis le serveur (après une modification faite par un autre appareil). */
export async function pullFromServer() {
  if (sync.pending.size) { pullAfterFlush = true; return; }
  try {
    const remote = await api('GET', '/state');
    if (sync.pending.size) { pullAfterFlush = true; return; }
    state = migrate(remote);
    snapshots = snapshot(state);
    sync.lastOk = Date.now();
    saveCache();
    setSync('synced');
    emit();
  } catch (err) {
    if (err.status === 401) setSync('auth', err.message);
  }
}

/**
 * Au démarrage : identifie la session, envoie les modifications en attente, puis charge l'état du foyer.
 * Cas particulier : des données héritées de l'ancienne version locale ne sont poussées que si le foyer est vide.
 */
export async function initStore() {
  if (!getToken()) { setSync('auth', ''); return sync; }
  let me;
  try {
    me = await api('GET', '/me');
  } catch (err) {
    if (err.status === 401) { setSync('auth', err.message); return sync; }
    setSync(err.status === 0 ? 'offline' : 'error', err.status === 0 ? 'Serveur injoignable : tu travailles sur la copie locale.' : err.message);
    sync.loaded = true;
    emit();
    return sync;
  }
  sync.user = me.user;
  sync.foyer = me.foyer;
  sync.push = me.push;
  setActor(me.user.nom);
  // Le cache local appartient à un autre foyer (autre compte sur cet appareil) : on repart de zéro.
  if (sync.foyerId && sync.foyerId !== me.foyer.id && !sync.legacy) {
    state = defaultState();
    sync.pending.clear();
    snapshots = snapshot(state);
  }
  sync.foyerId = me.foyer.id;

  let remote;
  try {
    if (sync.pending.size && !sync.legacy) await flushNow();
    remote = await api('GET', '/state');
  } catch (err) {
    if (err.status === 401) { setSync('auth', err.message); return sync; }
    setSync(err.status === 0 ? 'offline' : 'error', err.status === 0 ? 'Serveur injoignable : tu travailles sur la copie locale.' : err.message);
    sync.loaded = true;
    emit();
    return sync;
  }
  const serverEmpty = !remote?.settings?.onboarded && !(remote?.expenses || []).length && !(remote?.stock?.items || []).length;
  if (sync.legacy && sync.pending.size && serverEmpty) {
    await flushNow();
  } else if (!sync.pending.size || sync.legacy) {
    state = migrate(remote);
    sync.pending.clear();
    sync.legacy = false;
    snapshots = snapshot(state);
    if (serverEmpty) for (const k of ['settings', 'categories']) sync.pending.add(k);
  }
  sync.loaded = true;
  sync.lastOk = Date.now();
  saveCache();
  setSync(sync.pending.size ? 'syncing' : 'synced');
  emit();
  if (sync.pending.size) scheduleFlush(0);
  startLive();
  return sync;
}
async function flushNow() {
  clearTimeout(flushTimer);
  await flush();
  if (sync.status === 'auth') throw Object.assign(new Error(sync.message), { status: 401 });
}

/* ---------- Temps réel : les autres appareils du foyer ---------- */
let source = null;
function startLive() {
  if (source || typeof EventSource === 'undefined') return;
  const token = getToken();
  if (!token) return;
  source = new EventSource(`./api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener('change', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.client === getClientId()) return;
      sync.lastRemote = { by: msg.by, at: msg.at };
      pullFromServer();
    } catch {}
  });
  source.onopen = () => { sync.live = true; emitSync(); };
  source.onerror = () => { sync.live = false; emitSync(); };
}
function stopLive() {
  if (source) { source.close(); source = null; }
  sync.live = false;
}

/* ---------- Compte ---------- */
export async function login(login, password) {
  const r = await api('POST', '/auth/login', { login, password });
  setToken(r.token);
  return reconnect();
}
export async function register(data) {
  const r = await api('POST', '/auth/register', data);
  setToken(r.token);
  return reconnect();
}
/** Après connexion : recharge depuis le serveur. */
export async function reconnect() {
  stopLive();
  setSync('idle');
  return initStore();
}
/** Déconnexion : la session est fermée et la copie locale effacée (autre personne possible sur cet appareil). */
export async function logout() {
  try { await api('POST', '/auth/logout'); } catch {}
  stopLive();
  setToken('');
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); } catch {}
  location.reload();
}
export async function refreshMe() {
  const me = await api('GET', '/me');
  sync.user = me.user; sync.foyer = me.foyer; sync.push = me.push;
  emitSync();
  return me;
}

window.addEventListener('online', () => { if (sync.pending.size) scheduleFlush(0); else if (!sync.loaded) initStore(); });

/** Vérifie qu'un fichier importé ressemble bien à une sauvegarde Tartinou. */
export function checkBackup(obj) {
  if (!obj || typeof obj !== 'object') return 'Le fichier ne contient pas un objet JSON.';
  if (!obj.settings || typeof obj.settings !== 'object') return "Le fichier n'a pas de bloc « settings » : ce n'est pas une sauvegarde Tartinou.";
  if (!Array.isArray(obj.expenses)) return "Le fichier n'a pas de liste « expenses » : ce n'est pas une sauvegarde Tartinou.";
  return null;
}

export const categoryById = (id) =>
  state.categories.find((c) => c.id === id) || state.categories.find((c) => c.id === 'autre') || state.categories[0];
export const coursesCategoryId = () =>
  (state.categories.find((c) => c.id === 'courses') || state.categories.find((c) => c.nom.toLowerCase() === 'courses') || categoryById('autre')).id;
export const currentWeek = () => state.menus.weeks.find((w) => w.id === state.menus.currentId) || null;
