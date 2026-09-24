// Service worker : cache-first pour les fichiers de l'app ; lecteur
// ZXing et images Open Food Facts mis en cache à la première visite ; l'API
// (/api/) et Open Food Facts ne passent jamais par le cache.
// Incrémente VERSION à chaque déploiement.
const VERSION = 'foyer-v2.2.1';
const RUNTIME = 'foyer-runtime';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './js/utils.js',
  './js/api.js',
  './js/store.js',
  './js/budget.js',
  './js/menu-schema.js',
  './js/motion.js',
  './js/install.js',
  './js/stock.js',
  './js/off.js',
  './js/scanner.js',
  './js/components/gauge.js',
  './js/components/dialog.js',
  './js/components/expense-sheet.js',
  './js/components/expense-row.js',
  './js/components/recipe.js',
  './js/components/stepper.js',
  './js/components/product-sheet.js',
  './js/components/ranger-sheet.js',
  './js/components/waste-dialog.js',
  './js/screens/today.js',
  './js/screens/expenses.js',
  './js/screens/menus.js',
  './js/screens/shopping.js',
  './js/screens/stock.js',
  './js/screens/settings.js',
  './js/screens/onboarding.js',
  './js/screens/login.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/wordmark.png',
];
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'images.openfoodfacts.org', 'static.openfoodfacts.org'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API et Open Food Facts : toujours le réseau.
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return;
  if (url.hostname.endsWith('openfoodfacts.org') && !RUNTIME_HOSTS.includes(url.hostname)) return;

  // Navigation : l'app est une page unique, on sert toujours index.html.
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(request)));
    return;
  }

  // Polices, lecteur ZXing, images produit : cache-first, mis en cache à la première visite.
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(RUNTIME).then((cache) =>
        cache.match(request).then((hit) => hit || fetch(request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => new Response('', { status: 503 }))),
      ),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Fichiers de l'app : cache-first, réseau en secours.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) caches.open(VERSION).then((cache) => cache.put(request, res.clone()));
      return res;
    })),
  );
});
