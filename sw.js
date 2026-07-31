/* Maoka Residence — unified app service worker
   Network-first for the HTML shell (so updates show immediately),
   cache-first for icons/manifest, network-first with fallback for everything else. */

const CACHE_NAME = 'maoka-unified-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Allows the page to tell this service worker to wipe all caches immediately
// (used by the "Clear cache & refresh" link in the app).
self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHtmlShell = url.pathname.endsWith('/index.html') || url.pathname === '/' || url.pathname.endsWith('/');
  const isStaticShell = APP_SHELL.some((p) => url.pathname.endsWith(p.replace('./', '/'))) && !isHtmlShell;

  // The HTML itself: always try the network first, so a redeploy shows up
  // immediately. Only fall back to the cached copy if there's no connection.
  if (isHtmlShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Icons/manifest: cache-first (fast, rarely change)
  if (isStaticShell) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Everything else (Apps Script calls, external assets): network-first,
  // falling back to cache if offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
