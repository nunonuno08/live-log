// Serves the app from cache first (venues often have poor signal) and refreshes
// the cache in the background, so updates appear on the next launch.
// Jacket / artist images from iTunes and Deezer are kept in a separate cache.
const CACHE = 'livelog-v3';
const IMG_CACHE = 'livelog-img-v1';
const IMG_HOSTS = /(^|\.)mzstatic\.com$|(^|\.)dzcdn\.net$/;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/db.js',
  'js/store.js',
  'js/util.js',
  'js/nav.js',
  'js/ui.js',
  'js/music.js',
  'js/components.js',
  'js/setlist.js',
  'js/views/home.js',
  'js/views/lives.js',
  'js/views/artist.js',
  'js/views/live.js',
  'js/views/edit.js',
  'js/views/stats.js',
  'js/views/detail.js',
  'js/views/settings.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (IMG_HOSTS.test(url.hostname)) {
    e.respondWith(
      caches.open(IMG_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'cors') cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
