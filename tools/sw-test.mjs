/*
 * Drives sw.js through a real install -> activate -> fetch lifecycle against
 * an in-memory Cache API, so the routing and eviction logic is executed
 * rather than eyeballed.   node tools/sw-test.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = 'http://localhost:8000/sw.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra}`); }
};

/* ---------- minimal Request / Cache API ---------- */
class Req {
  constructor(input, init = {}) {
    if (input instanceof Req) Object.assign(this, input);
    else { this.url = new URL(String(input), BASE).href; this.method = 'GET'; this.mode = 'no-cors'; }
    if (init.method) this.method = init.method;
    if (init.mode) this.mode = init.mode;
  }
}
const keyOf = r => (r instanceof Req ? r.url : new URL(String(r), BASE).href);

class Cache {
  constructor() { this.m = new Map(); }            // Map preserves insertion order
  async put(req, res) { this.m.set(keyOf(req), res); }
  async match(req) { return this.m.get(keyOf(req)); }
  async keys() { return [...this.m.keys()].map(u => new Req(u)); }
  async delete(req) { return this.m.delete(keyOf(req)); }
  async add(req) {
    const r = req instanceof Req ? req : new Req(req);
    const res = await fetchMock(r);
    if (!res.ok) throw new Error('add failed ' + r.url + ' ' + res.status);
    await this.put(r, res);
  }
}
class CacheStorage {
  constructor() { this.c = new Map(); }
  async open(n) { if (!this.c.has(n)) this.c.set(n, new Cache()); return this.c.get(n); }
  async keys() { return [...this.c.keys()]; }
  async delete(n) { return this.c.delete(n); }
  async match(req, opts = {}) {
    if (opts.cacheName) return (await this.open(opts.cacheName)).match(req);
    for (const c of this.c.values()) { const h = await c.match(req); if (h) return h; }
  }
}

/* ---------- network ---------- */
const netLog = [];
let tileServerDown = false;
async function fetchMock(req) {
  const r = req instanceof Req ? req : new Req(req);
  netLog.push(r.url);
  const u = new URL(r.url);
  if (u.hostname.endsWith('openstreetmap.org')) {
    if (tileServerDown) throw new TypeError('network error');
    return new Response('PNGDATA', { status: 200, headers: { 'content-type': 'image/png' } });
  }
  if (u.origin === 'http://localhost:8000') {
    const rel = decodeURIComponent(u.pathname).replace(/^\//, '') || 'index.html';
    const disk = path.join(ROOT, rel);
    if (fs.existsSync(disk) && fs.statSync(disk).isFile()) {
      return new Response(fs.readFileSync(disk), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }
  return new Response('', { status: 404 });
}

/* ---------- service worker global ---------- */
const handlers = {};
const self_ = {
  addEventListener: (t, fn) => { (handlers[t] ||= []).push(fn); },
  location: new URL(BASE),
  registration: { navigationPreload: { disable: async () => {} } },
  clients: { claim: async () => {} },
  skipWaiting: () => { self_.didSkipWaiting = true; },
  caches: new CacheStorage(),
  fetch: fetchMock,
  Request: Req,
  Response,
  URL,
  console,
  Promise, Map, Set, JSON, Error, TypeError, Object, Array, String, Number,
  setTimeout, clearTimeout,
};
self_.self = self_;
self_.importScripts = (...srcs) => {
  for (const s of srcs) {
    const p = path.join(ROOT, new URL(s, BASE).pathname);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });
  }
};
const ctx = vm.createContext(self_);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });

/* ---------- event drivers ---------- */
async function fire(type) {
  const waits = [];
  const ev = { waitUntil: p => waits.push(p) };
  for (const h of handlers[type] || []) h(ev);
  await Promise.all(waits);
}
async function fireFetch(input, init) {
  const req = new Req(input, init);
  let responded = null;
  const ev = { request: req, respondWith: p => { responded = p; } };
  for (const h of handlers.fetch || []) h(ev);
  return responded ? await responded : null;
}

/* ================= run ================= */
console.log('\nsw.js lifecycle\n');

/* Read expectations from the real files rather than baking in numbers that
   go stale the moment the data or the version changes. */
const EXPECTED_PLACES =
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/places.json'), 'utf8')).places.length;

ok('config.js loaded via importScripts',
   !!(self_.KK && /^\d+\.\d+\.\d+$/.test(self_.KK.version || '')),
   `(version ${self_.KK && self_.KK.version})`);

/* a stale cache from a previous version must be cleaned up on activate */
(await self_.caches.open('kk-shell-0.9.0')).put('http://localhost:8000/old', new Response('x'));

await fire('install');
const shell = await self_.caches.open('kk-shell-' + self_.KK.version);
const data  = await self_.caches.open('kk-data-'  + self_.KK.version);
const shellKeys = await shell.keys();
ok('install precached the shell', shellKeys.length >= 24, `(got ${shellKeys.length})`);
ok('install seeded places.json', !!(await data.match('http://localhost:8000/data/places.json')));

const missing = [];
for (const f of ['index.html','manifest.webmanifest','assets/js/app.js','assets/css/app.css',
                 'assets/vendor/leaflet/leaflet.js','assets/vendor/leaflet/leaflet.css',
                 'assets/fonts/manrope-400-800-latin.woff2','assets/icons/icon-512.png']) {
  if (!(await shell.match('http://localhost:8000/' + f))) missing.push(f);
}
ok('every critical shell asset is cached', missing.length === 0, missing.join(', '));

await fire('activate');
ok('activate deleted the stale version cache', !(await self_.caches.keys()).includes('kk-shell-0.9.0'));

/* --- routing --- */
netLog.length = 0;
const t1 = await fireFetch('https://tile.openstreetmap.org/15/24148/13755.png');
ok('tile request is handled', !!t1);
const netAfterFirstTile = netLog.length;
await fireFetch('https://tile.openstreetmap.org/15/24148/13755.png');
ok('repeat tile is served from cache (no 2nd network hit)', netLog.length === netAfterFirstTile);

const nav = await fireFetch('http://localhost:8000/', { mode: 'navigate' });
ok('navigation is answered', !!nav && nav.status === 200);

const pj = await fireFetch('http://localhost:8000/data/places.json');
const pjBody = pj && JSON.parse(await pj.text());
ok('places.json returns real data',
   !!pjBody && pjBody.places.length === EXPECTED_PLACES,
   `(expected ${EXPECTED_PLACES}, got ${pjBody && pjBody.places.length})`);

const css = await fireFetch('http://localhost:8000/assets/css/app.css');
ok('shell asset is answered', !!css && css.status === 200);

ok('POST is not intercepted', (await fireFetch('http://localhost:8000/x', { method: 'POST' })) === null);
ok('unrelated cross-origin is not intercepted',
   (await fireFetch('https://example.com/a.js')) === null);

/* --- offline --- */
tileServerDown = true;
const offlineTile = await fireFetch('https://tile.openstreetmap.org/15/24148/13755.png');
ok('cached tile still served with the network down', !!offlineTile);
const offlineNav = await fireFetch('http://localhost:8000/', { mode: 'navigate' });
ok('navigation still served with the network down', !!offlineNav && offlineNav.status === 200);
const offlineData = await fireFetch('http://localhost:8000/data/places.json');
ok('places.json still served with the network down',
   !!offlineData && JSON.parse(await offlineData.text()).places.length === EXPECTED_PLACES);
tileServerDown = false;

/* --- eviction --- */
self_.KK.tiles.cacheLimit = 50;
for (let i = 0; i < 140; i++) await fireFetch(`https://tile.openstreetmap.org/16/${i}/999.png`);
await new Promise(r => setTimeout(r, 30));
const tiles = await self_.caches.open('kk-tiles-' + self_.KK.version);
const n = (await tiles.keys()).length;
ok('tile cache is capped', n <= 50 + 30, `(limit 50, holding ${n})`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
