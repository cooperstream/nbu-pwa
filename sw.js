const CACHE = "nbu-pwa-v3";
const scopeUrl = new URL(self.registration.scope);
const withScope = (path) => new URL(path, scopeUrl).toString();
const APP_SHELL = [
  withScope("./"),
  withScope("./index.html"),
  withScope("./manifest.json"),
  withScope("./icon-192.png"),
  withScope("./icon-512.png"),
  withScope("./icon-maskable-512.png")
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
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

self.addEventListener("fetch", (event) => {
  if(event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if(url.origin !== location.origin) return;

  if(event.request.mode === "navigate"){
    event.respondWith(
      fetch(event.request).catch(() => caches.match(withScope("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if(cached) return cached;

      return fetch(event.request).then((response) => {
        if(!response || response.status !== 200 || response.type !== "basic") return response;
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
