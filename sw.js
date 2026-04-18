const CACHE = 'nbu-pwa-v5';
const withScope = (path = '') => new URL(path, self.registration.scope).pathname;

const APP_SHELL = [
  withScope(''),
  withScope('index.html'),
  withScope('manifest.json'),
  withScope('styles/main.css'),
  withScope('styles/components/header.css'),
  withScope('styles/components/cards.css'),
  withScope('styles/components/converter.css'),
  withScope('styles/components/chart.css'),
  withScope('src/app.js'),
  withScope('src/domain/rates.js'),
  withScope('src/services/cache.js'),
  withScope('src/services/nbu-api.js'),
  withScope('src/ui/cards.js'),
  withScope('src/ui/charts.js'),
  withScope('src/ui/converter.js'),
  withScope('vendor/chart.umd.min.js'),
  withScope('icon-192.png'),
  withScope('icon-512.png'),
  withScope('icon-maskable-512.png')
];

const OFFLINE_FALLBACK = withScope('index.html');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.origin !== location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);

      try {
        const networkResponse = await fetch(event.request);

        if (event.request.method === 'GET' && networkResponse && networkResponse.ok) {
          await cache.put(event.request, networkResponse.clone());
        }

        return networkResponse;
      } catch (error) {
        return (await caches.match(OFFLINE_FALLBACK)) || cache.match(event.request);
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
