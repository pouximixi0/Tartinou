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

// Un écran, une couleur d'accent : budget = moutarde, cuisine = vert.
const ROUTES = {
  aujourdhui: { render: renderToday, accent: 'budget', title: "Aujourd'hui" },
  depenses: { render: renderExpenses, accent: 'budget', title: 'Dépenses' },
  menus: { render: renderMenus, accent: 'cuisine', title: 'Menus' },
  courses: { render: renderShopping, accent: 'cuisine', title: 'Courses' },
  stock: { render: renderStock, accent: 'cuisine', title: 'Stock' },
  reglages: { render: renderSettings, accent: 'budget', title: 'Réglages' },
};

const main = document.getElementById('screen');
const tabbar = document.getElementById('tabbar');
const topbar = document.getElementById('topbar');
const screenTitle = document.getElementById('screen-title');
const settingsLink = document.getElementById('settings-link');
const syncDot = document.getElementById('sync-dot');
let lastRoute = null;

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, '');
  return ROUTES[key] ? key : 'aujourdhui';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0F172A' : '#14213D');
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
  main.replaceChildren(route.render());
  for (const tab of tabbar.querySelectorAll('.tab')) {
    if (tab.dataset.route === key) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
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
initStore();

if ('serviceWorker' in navigator) {
  // Quand une nouvelle version prend le contrôle (VERSION changée dans sw.js), on recharge
  // pour ne pas mélanger anciens et nouveaux modules. Pas de rechargement à la première installation.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker non enregistré', err)));
}
