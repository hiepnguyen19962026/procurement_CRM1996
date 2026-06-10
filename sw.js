const CACHE_NAME = 'procurement-crm-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/assets/css/app.css',
  '/assets/js/core/api.js',
  '/assets/js/core/state.js',
  '/assets/js/core/utils.js',
  '/assets/js/core/auth.js',
  '/assets/js/modules/dashboard.js',
  '/assets/js/modules/clients.js',
  '/assets/js/modules/suppliers.js',
  '/assets/js/modules/rfqs.js',
  '/assets/js/modules/rfq-items.js',
  '/assets/js/modules/audit.js',
  '/assets/js/modules/accounts.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
