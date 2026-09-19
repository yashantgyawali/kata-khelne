/* =====================================================================
   katakhelne — service worker

   Three caches, three strategies:
     shell  cache-first            app code; swapped only on a version bump
     data   stale-while-revalidate places.json; instant, refreshes behind you
     tiles  cache-first + FIFO cap map tiles you have actually panned over

   Tile caching is deliberately passive — nothing is pre-fetched in a grid,
   which would be bulk downloading under the OSM tile usage policy.
   ===================================================================== */

importScripts('./assets/js/config.js');

const V     = self.KK.version;
const SHELL = 'kk-shell-' + V;
const DATA  = 'kk-data-'  + V;
const TILES = 'kk-tiles-' + V;

const INDEX = new URL('index.html', self.location).href;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/fonts.css',
  'assets/css/tokens.css',
  'assets/css/app.css',
  'assets/vendor/leaflet/leaflet.css',
  'assets/vendor/leaflet/leaflet.js',
  'assets/js/config.js',
  'assets/js/app.js',
  'assets/fonts/atkinson-hyperlegible-400-latin.woff2',
  'assets/fonts/atkinson-hyperlegible-400-latin-ext.woff2',
  'assets/fonts/atkinson-hyperlegible-700-latin.woff2',
  'assets/fonts/atkinson-hyperlegible-700-latin-ext.woff2',
  'assets/fonts/manrope-400-800-latin.woff2',
  'assets/fonts/manrope-400-800-latin-ext.woff2',
  'assets/fonts/patrick-hand-400-latin.woff2',
  'assets/fonts/patrick-hand-400-latin-ext.woff2',
  'assets/icons/favicon.svg',
  'assets/icons/favicon-32.png',
  'assets/icons/favicon-16.png',
  'favicon.ico',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-192.png',
  'assets/icons/icon-maskable-512.png'
];

const isTile = url =>
  self.KK.tiles.hosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h));

/* ---------- install ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    /* Individually, so one failed asset cannot abort the whole install. */
    await Promise.all(SHELL_FILES.map(f =>
      shell.add(new Request(f, { cache: 'reload' })).catch(err =>
        console.warn('[sw] skipped', f, err))));

    /* Seed the data cache so the very first offline launch has places. */
    const data = await caches.open(DATA);
    await data.add(new Request(self.KK.data, { cache: 'reload' })).catch(() => {});
  })());
});

/* ---------- activate ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, TILES]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('kk-') && !keep.has(n))
                           .map(n => caches.delete(n)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable();
    }
    await self.clients.claim();
  })());
});

/* The page asks for this when the user accepts the update toast. */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- strategies ---------- */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || net.then(r => r || Response.error());
}

/* Tiles: cache-first, with an oldest-first cap. Cache API preserves
   insertion order in keys(), so the head of the list is the oldest. */
let putsSinceTrim = 0;
async function trimTiles() {
  const limit = self.KK.tiles.cacheLimit;
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map(k => cache.delete(k)));
}
async function tileFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    await cache.put(req, res.clone());
    if (++putsSinceTrim >= 30) { putsSinceTrim = 0; trimTiles(); }
  }
  return res;
}

/* ---------- fetch ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  /* Map tiles (cross-origin). */
  if (isTile(url)) {
    event.respondWith(tileFirst(req).catch(() => Response.error()));
    return;
  }

  /* Navigations — serve the cached shell instantly, refresh behind it. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(INDEX);
      const net = fetch(req).then(res => {
        if (res && res.ok) cache.put(INDEX, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await net) || Response.error();
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* The places list. */
  if (url.pathname.endsWith('/' + self.KK.data) || url.pathname.endsWith('places.json')) {
    event.respondWith(staleWhileRevalidate(req, DATA));
    return;
  }

  /* Everything else same-origin: app shell. */
  event.respondWith(cacheFirst(req, SHELL).catch(() => Response.error()));
});
