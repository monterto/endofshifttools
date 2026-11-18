// Bump VERSION on every deploy that changes app files. Both caches follow it,
// so nothing from an older version can linger.
const VERSION = 'v19';
const CACHE_NAME = 'calculator-hub-' + VERSION;
const RUNTIME_CACHE = 'calculator-hub-runtime-' + VERSION;

// Files the app needs to work offline
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './app.js',
  './icon-192.png',
  './icon-512.png'
];

// Install: download a FRESH copy of every file. `cache: 'reload'` skips the
// phone's ordinary download cache — GitHub Pages lets phones reuse files for
// 10 minutes, so without it a new version could be stored with the OLD
// files and stay stuck on them. If anything fails to download, the install
// fails and the previous version keeps running (instead of activating a
// half-empty cache).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete every cache from older versions, take over open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: app files from this version's cache first (works offline), anything
// else from the network (kept in the runtime cache for next time).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith((async () => {
    const shell = await caches.open(CACHE_NAME);
    const cached = await shell.match(request, { ignoreSearch: request.mode === 'navigate' })
      || await (await caches.open(RUNTIME_CACHE)).match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    } catch (error) {
      // Offline and not cached: for page loads, fall back to the app itself.
      if (request.mode === 'navigate') {
        const fallback = await shell.match('./index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
