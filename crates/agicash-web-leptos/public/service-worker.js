// agicash-web-leptos service worker — minimal, hand-rolled (no Workbox).
//
// Goals (spec §6):
//   1. Cache the app shell so the PWA boots offline.
//   2. Pass SDK / API calls straight through to the network (no proof caching).
//   3. Navigation requests fall back to cached `/` shell when offline so the
//      Leptos app can mount and show a "last known" state.
//
// Bump CACHE_VERSION whenever the cached asset list changes.

const CACHE_VERSION = 'agicash-v1';
const SHELL_URLS = [
  '/',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-maskable.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)),
  );
  // Take over from any older SW on first install.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only intercept GETs; POST /api/auth/* etc. must hit the network.
  if (request.method !== 'GET') return;

  // Navigation requests: try network, fall back to cached shell so the
  // SPA can still mount when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/')),
    );
    return;
  }

  // Same-origin static assets: cache-first.
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request)),
    );
  }
});
