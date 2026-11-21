// Offline cache: lets the page open again even without network / server.
// Game progress itself lives in localStorage (see app.js), not here.
const CACHE = 'ccw-denver-cache-v4';
const CORE = ['./', './index.html', './style.css?v=7', './app.js?v=7'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy));
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Network first so updates show up; fall back to the cached copy when offline.
    e.respondWith(
      fetch(req)
        .then((res) => put(req, res))
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))
        )
    );
  } else if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    // Fonts never change: cache first.
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => put(req, res))));
  }
});
