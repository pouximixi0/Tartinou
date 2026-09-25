// Point d'entrée : routeur par ancre, thème, service worker, rendu des écrans,
// chargement de l'état depuis le serveur (SQLite) et indicateur de synchronisation.
import { getState, subscribe, initStore, onSync, syncStatus, flush } from './js/store.js';
import { setAnimate } from './js/motion.js';
import './js/install.js';
import { renderToday } from './js/screens/today.js';
import { renderExpenses } from './js/screens/expenses.js';
import { renderMenus } from './js/screens/menus.js';
import { renderShopping } from './js/screens/shopping.js';
import { renderStock } from './js/screens/stock.js';
import { renderSettings } from './js/screens/settings.js';
import { renderOnboarding } from './js/screens/onboarding.js';
import { renderLogin } from './js/screens/login.js';
import { renderFoyer, lastSeen } from './js/screens/foyer.js';
import { unreadCount } from './js/social.js';
import { isOn } from './js/modules.js';
import { h } from './js/utils.js';

// Un écran, une couleur d'accent : budget = moutarde, cuisine = vert.
const ROUTES = {
  aujourdhui: { render: renderToday, accent: 'budget', title: "Aujourd'hui" },
  depenses: { render: renderExpenses, accent: 'budget', title: 'Dépenses' },
  menus: { render: renderMenus, accent: 'cuisine', title: 'Menus' },
  courses: { render: renderShopping, accent: 'cuisine', title: 'Courses' },
  stock: { render: renderStock, accent: 'cuisine', title: 'Stock' },
  communaute: { render: renderFoyer, accent: 'budget', title: 'Communauté' },
  reglages: { render: renderSettings, accent: 'budget', title: 'Réglages' },
};

const main = document.getElementById('screen');
const tabbar = document.getElementById('tabbar');
const topbar = document.getElementById('topbar');
const screenTitle = document.getElementById('screen-title');
const settingsLink = document.getElementById('settings-link');
const topbarActions = document.getElementById('topbar-actions');
const syncDot = document.getElementById('sync-dot');
let lastRoute = null;

// Sur mobile, Menus, Courses et Stock partagent l'onglet « Cuisine » ; le sous-menu
// en haut de l'écran passe de l'un à l'autre. Sur PC, la barre latérale les liste.
const KITCHEN = ['menus', 'courses', 'stock'];
const MODULE_OF = { menus: 'menus', courses: 'courses', stock: 'stock', communaute: 'foyer' };
const routeOn = (key) => !(key in MODULE_OF) || isOn(MODULE_OF[key]);
const kitchenOn = () => KITCHEN.filter(routeOn);
const CUISINE_KEY = 'foyer:cuisine';
function kitchenRoute() {
  let last = null;
  try { last = localStorage.getItem(CUISINE_KEY); } catch {}
  const on = kitchenOn();
  return on.includes(last) ? last : on[0] || 'aujourdhui';
}

function currentRoute() {
  let key = location.hash.replace(/^#\/?/, '');
  if (key === 'foyer') key = 'communaute'; // ancienne adresse de l'onglet
  if (key === 'cuisine') key = kitchenRoute();
  if (!ROUTES[key] || !routeOn(key)) return 'aujourdhui';
  return key;
}

function subnav(key) {
  if (!KITCHEN.includes(key)) return null;
  const on = kitchenOn();
  if (on.length < 2) return null;
  return h('nav', { class: 'subnav', 'aria-label': 'Cuisine' }, on.map((r) => h('a', { href: `#${r}`, 'aria-current': r === key ? 'page' : null }, ROUTES[r].title)));
}

function errorScreen(route, err) {
  return h('section', { class: 'screen' }, h('div', { class: 'empty' },
    h('p', null, `L’écran ${route.title} n’a pas pu s’afficher.`),
    h('p', { class: 'muted small' }, String((err && err.message) || err)),
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => location.reload() }, 'Recharger l’app')));
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#121211' : '#F4F3EF');
}

function render() {
  const state = getState();
  applyTheme(state.settings.theme);
  const sync = syncStatus();

  if (sync.status === 'auth') {
    document.body.dataset.accent = 'budget';
    tabbar.hidden = true;
    topbar.hidden = true;
    main.replaceChildren(renderLogin());
    document.title = 'Connexion · Tartinou';
    return;
  }

  if (!state.settings.onboarded) {
    document.body.dataset.accent = 'budget';
    tabbar.hidden = true;
    topbar.hidden = true;
    main.replaceChildren(renderOnboarding());
    document.title = 'Bienvenue · Tartinou';
    return;
  }

  const key = currentRoute();
  const route = ROUTES[key];
  const y = window.scrollY;
  tabbar.hidden = false;
  topbar.hidden = false;
  screenTitle.textContent = route.title;
  document.body.dataset.accent = route.accent;
  document.title = `${route.title} · Tartinou`;
  const hashKey = location.hash.replace(/^#\/?/, '');
  if (hashKey !== key) history.replaceState(null, '', `#${key}`);
  topbarActions.replaceChildren();
  let content;
  try { content = route.render(); }
  catch (err) { console.error(`Écran ${key}`, err); content = errorScreen(route, err); }
  if (KITCHEN.includes(key)) { try { localStorage.setItem(CUISINE_KEY, key); } catch {} }
  main.replaceChildren(...[subnav(key), content].filter(Boolean));
  let visible = 0;
  for (const tab of tabbar.querySelectorAll('.tab')) {
    const r = tab.dataset.route;
    const off = r === 'cuisine' ? !kitchenOn().length : !routeOn(r);
    tab.hidden = off;
    if (!off && !tab.classList.contains('tab-settings') && !tab.classList.contains('tab-desk')) visible++;
    const current = r === key || (r === 'cuisine' && KITCHEN.includes(key));
    if (current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  tabbar.style.setProperty('--tabs', String(visible));
  const badge = tabbar.querySelector('.tab-badge');
  if (badge) { const n = key === 'communaute' ? 0 : unreadCount(state.posts, lastSeen(), syncStatus().user?.nom); badge.textContent = n ? String(n) : ''; badge.hidden = !n; }
  settingsLink.setAttribute('aria-current', key === 'reglages' ? 'page' : 'false');
  // Même écran re-rendu après une action : on garde la position de défilement.
  window.scrollTo(0, key === lastRoute ? y : 0);
  lastRoute = key;
}

const SYNC_LABELS = {
  idle: 'Connexion au serveur…', syncing: 'Envoi en cours…', synced: 'Synchronisé avec le serveur',
  offline: 'Hors ligne : modifications gardées sur cet appareil', auth: 'Code d’accès requis', error: 'Erreur de synchronisation',
};
function drawSync(sync) {
  if (!syncDot) return;
  syncDot.dataset.status = sync.status;
  const pending = sync.pending.size;
  syncDot.title = SYNC_LABELS[sync.status] + (pending && sync.status !== 'syncing' ? ` (${pending} en attente)` : '');
  syncDot.setAttribute('aria-label', syncDot.title);
}

subscribe(() => {
  setAnimate(true);
  render();
  setAnimate(false);
});
let wasAuth = false;
onSync((sync) => {
  drawSync(sync);
  // Passage connexion → app (ou l'inverse) : on re-rend l'écran.
  const isAuth = sync.status === 'auth';
  if (isAuth !== wasAuth) { wasAuth = isAuth; render(); }
});
syncDot?.addEventListener('click', () => { const s = syncStatus(); if (s.pending.size) flush(); else if (s.status !== 'synced') initStore(); });
window.addEventListener('hashchange', () => {
  render();
  main.focus({ preventScroll: true });
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getState().settings.theme));

render();
drawSync(syncStatus());
initStore().then(importSharedRecipe);

/** #recette=ID dans l'adresse (lien public) : la recette rejoint les favoris. */
async function importSharedRecipe() {
  const m = location.hash.match(/recette=([A-Za-z0-9_-]+)/);
  if (!m || syncStatus().status === 'auth') return;
  try {
    const { api } = await import('./js/api.js');
    const { update, getState } = await import('./js/store.js');
    const { uid, todayISO, toast } = await import('./js/utils.js');
    const r = await api('GET', `/public/recette/${m[1]}`);
    if (getState().recettes.some((x) => x.nom.toLowerCase() === r.nom.toLowerCase())) toast(`« ${r.nom} » est déjà dans tes favoris`);
    else { update((s) => { s.recettes.push({ id: uid(), nom: r.nom, temps: r.temps, tags: r.tags || [], recette: r.recette, lien: r.lien || null, ingredients: r.ingredients || [], personnes: r.personnes || 2, ajouteLe: todayISO() }); }); toast(`« ${r.nom} » ajoutée à tes recettes`); }
  } catch (e) {
    const { toast } = await import('./js/utils.js');
    toast(e.message || 'Recette introuvable');
  }
  location.hash = '#menus';
}

if ('serviceWorker' in navigator) {
  // Quand une nouvelle version prend le contrôle (VERSION changée dans sw.js), on recharge
  // pour ne pas mélanger anciens et nouveaux modules. Pas de rechargement à la première installation.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker non enregistré', err)));
}
