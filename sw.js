// bump CACHE_NAME on every deploy that changes JS/CSS to bust stale asset cache
const CACHE_NAME = 'procurement-crm-v9';
const STATIC_ASSETS = [
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
  '/assets/js/modules/supplier-quotes.js',
  '/assets/js/modules/audit.js',
  '/assets/js/modules/accounts.js',
];
// index.html / are intentionally excluded: always network-first (see fetch handler)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML navigation — always fresh after deploy; fall back to cache if offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
