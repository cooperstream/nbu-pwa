 self.addEventListener('install', (e) => {
  console.log('Service Worker встановлено');
});

self.addEventListener('fetch', (e) => {
  // Пропускаємо всі мережеві запити як є
  e.respondWith(fetch(e.request));
});

