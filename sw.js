/* OrbitBills offline shell — cache app pages; prefer real pages over offline.html */
const CACHE = 'orbitbills-v6';
const ASSETS = [
  './', './index.html', './signin.html', './billing.html',
  './admin-dashboard.html', './accountant-dashboard.html',
  './offline.html', './404error.html',
  './Db.js', './orbit-native.js', './orbit-assets.js', './qrcode.min.js',
  './favicon.ico', './app-icon-96.png', './app-icon-192.png', './app-icon-512.png',
  './logo.png', './orbit-icon.png', './calc.png', './calc-256.png',
  './splash-boot.png', './splash-loading.png', './ts-element-512.png',
  './manifest.webmanifest', './manifest.json', './app-icon-512-maskable.png', './app-icon-192-maskable.png', './techserenia_users.json',
  './aboutus.html', './contact.html', './privacy-policy.html', './terms-of-use.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of ASSETS) {
      try { await cache.add(new Request(u, { cache: 'reload' })); }
      catch (err) {
        try {
          const r = await fetch(u, { cache: 'reload' });
          if (r && r.ok) await cache.put(u, r);
        } catch (e2) {}
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isHTML(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));
}

async function matchPage(cache, pathname) {
  const name = (pathname || '/').replace(/^\//, '') || 'index.html';
  for (const key of ['./' + name, name, '/' + name, pathname,
    './billing.html', './signin.html', './index.html']) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (isHTML(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          try { await cache.put(req, res.clone()); } catch (e) {}
          try {
            const n = url.pathname.replace(/^\//, '') || 'index.html';
            await cache.put('./' + n, res.clone());
          } catch (e) {}
          return res;
        }
      } catch (e) {}
      // Offline: serve the same page from cache — NOT offline.html first
      const hit = await cache.match(req) || await matchPage(cache, url.pathname);
      if (hit) return hit;
      const offline = await cache.match('./offline.html') || await cache.match('offline.html');
      if (offline) return offline;
      return new Response('<!doctype html><title>OrbitBills</title><body style="font-family:system-ui;padding:2rem;text-align:center"><h1>OrbitBills</h1><p>Open once with internet so the app is saved on this phone.</p><p><a href="./billing.html">Billing</a></p></body>', { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req) || await cache.match(url.pathname);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) try { await cache.put(req, res.clone()); } catch (e) {}
      return res;
    } catch (e) {
      return new Response('', { status: 503 });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url && "focus" in list[i]) { list[i].focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow("./billing.html");
    })
  );
});
