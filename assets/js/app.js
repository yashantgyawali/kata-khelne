/* =====================================================================
   katakhelne — board games in Kathmandu

   Ported from the Claude Design prototype "Kathmandu Board Game Map"
   (handoff v2). Behaviour is faithful to the design; the additions are
   the PWA layer, escaping for user-supplied place data, and keyboard
   access for the list.
   ===================================================================== */
(function () {
'use strict';

const CFG = self.KK;

const phone    = document.getElementById('phone');
const sheet    = document.getElementById('sheet');
const bodyEl   = document.getElementById('body');
const listEl   = document.getElementById('list');
const detailEl = document.getElementById('detail');
const titleEl  = document.getElementById('title');
const subEl    = document.getElementById('sub');
const toastEl  = document.getElementById('toast');
const locateBtn= document.getElementById('locate');

const TICK = '<svg class="tick" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0l1.9 1.4 2.3-.3 1 2.1 2.1 1-.3 2.3L16 8l-1.4 1.9.3 2.3-2.1 1-1 2.1-2.3-.3L8 16l-1.9-1.4-2.3.3-1-2.1-2.1-1 .3-2.3L0 8l1.4-1.9-.3-2.3 2.1-1 1-2.1 2.3.3z"/><path d="M6.9 10.8L4.4 8.3l1-1 1.5 1.5 3.7-3.7 1 1z" fill="#fff"/></svg>';

const REDUCE_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

let DATA = [], markers = {}, selected = null, userLoc = null, meMarker = null, labelsOn = false;

/* places.json is meant to be replaced with a real list, so treat its
   strings as untrusted when they go into innerHTML. */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false, attributionControl: false, zoomSnap: .5 })
  .setView(CFG.map.center, CFG.map.zoom);

L.control.attribution({ position: 'topright', prefix: false })
  .addAttribution(CFG.tiles.attribution).addTo(map);

L.tileLayer(CFG.tiles.url, {
  attribution: CFG.tiles.attribution,
  maxZoom: CFG.tiles.maxZoom,
  crossOrigin: 'anonymous'
}).addTo(map);

/* OSM's volunteer tile servers refuse some origins and answer with a
   valid-but-blank "access blocked" PNG — no error event fires. Probe one
   tile; if it comes back as the notice, drop the tile pane rather than
   paint the map with error text. Only meaningful while online: offline,
   a failed probe just means the tile is not cached yet, and any tiles
   that ARE cached should still render. */
let noTilesShown = false;
function noTiles() {
  if (noTilesShown) return;
  noTilesShown = true;
  document.getElementById('map').classList.add('no-tiles');
  const n = document.createElement('div');
  n.className = 'notile-note';
  n.textContent = 'Map tiles unavailable here';
  phone.appendChild(n);
}
function probeTiles() {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onerror = noTiles;
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 64);
      const d = x.getImageData(0, 0, 64, 64).data;
      let white = 0, sat = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) white++;
        const mx = Math.max(d[i], d[i + 1], d[i + 2]);
        const mn = Math.min(d[i], d[i + 1], d[i + 2]);
        sat += mx ? (mx - mn) / mx : 0;
      }
      if (white / n > 0.45 || sat / n < 0.02) noTiles();
    } catch (e) { /* tainted canvas — assume the tiles are fine */ }
  };
  img.src = CFG.tiles.probe;
}
if (navigator.onLine) probeTiles();

/* ---------- sheet snapping ---------- */
const SNAP = { full: 0, half: 0, peek: 0 };
let snapName = 'half', ty = 0;

/* .sheet is height:88% of .phone — read it defensively, percentage
   heights can still be unresolved on the first pass. */
function sheetH() {
  return sheet.offsetHeight || Math.round(phone.clientHeight * 0.88);
}
/* Bottom safe-area inset, in px, as resolved by CSS. */
function sab() {
  return parseFloat(getComputedStyle(phone).getPropertyValue('--sab')) || 0;
}
function computeSnaps() {
  const h = sheetH();
  if (!h) { requestAnimationFrame(computeSnaps); return; }
  SNAP.full = 0;
  SNAP.half = Math.round(h * 0.46);
  SNAP.peek = Math.max(0, h - (152 + sab()));
  setSnap(snapName, false);
}
/* The sheet keeps its full height and is pushed down by translateY, so its
   scroller overhangs the phone's clipped bottom edge by exactly `ty`. Pad
   the scroll content by that much so the end of the list — and the CTA —
   land inside the visible area. */
function applyY(y) {
  ty = y;
  sheet.style.transform = 'translateY(' + ty + 'px)';
  phone.style.setProperty('--sheet-visible', (sheetH() - ty) + 'px');
  bodyEl.style.paddingBottom = (ty + 28 + sab()) + 'px';
}
function setSnap(name, animate) {
  if (animate === undefined) animate = true;
  snapName = name;
  sheet.style.transition = animate ? '' : 'none';
  applyY(SNAP[name]);
  if (!animate) requestAnimationFrame(() => { sheet.style.transition = ''; });
  bodyEl.style.overflowY = name === 'peek' ? 'hidden' : 'auto';
}
function setY(y) {
  applyY(Math.min(SNAP.peek, Math.max(0, y)));
}

let dragging = false, startY = 0, startTy = 0, lastY = 0, lastT = 0, vel = 0;
function onDown(e) {
  dragging = true; startY = lastY = e.clientY; startTy = ty;
  lastT = performance.now(); vel = 0;
  sheet.style.transition = 'none';
  sheet.setPointerCapture(e.pointerId);
}
function onMove(e) {
  if (!dragging) return;
  const now = performance.now();
  vel = (e.clientY - lastY) / Math.max(1, now - lastT);
  lastY = e.clientY; lastT = now;
  setY(startTy + (e.clientY - startY));
}
function onUp() {
  if (!dragging) return;
  dragging = false; sheet.style.transition = '';
  const order = ['full', 'half', 'peek'];
  let target;
  if (Math.abs(vel) > .5) {
    const i = order.indexOf(snapName);
    target = vel > 0 ? order[Math.min(2, i + 1)] : order[Math.max(0, i - 1)];
    if (Math.abs(ty - SNAP[snapName]) < 6) target = snapName;
  } else {
    target = order.reduce((a, b) => Math.abs(SNAP[b] - ty) < Math.abs(SNAP[a] - ty) ? b : a);
  }
  setSnap(target);
}
['grab', 'head'].forEach(id => {
  document.getElementById(id).addEventListener('pointerdown', onDown);
});
sheet.addEventListener('pointermove', onMove);
sheet.addEventListener('pointerup', onUp);
sheet.addEventListener('pointercancel', onUp);

/* ---------- helpers ---------- */
const R = 6371;
function dist(a, b, c, d) {
  const p = Math.PI / 180;
  const x = .5 - Math.cos((c - a) * p) / 2 +
    Math.cos(a * p) * Math.cos(c * p) * (1 - Math.cos((d - b) * p)) / 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmt = km => km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(km < 10 ? 1 : 0) + ' km';

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('action');
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
function icon(p, active) {
  const label = (labelsOn || active)
    ? '<div class="pin-label">' + esc(p.name) + '</div>'
    : '<div class="pin-dot"></div>';
  return L.divIcon({
    className: 'pin-wrap' + (active ? ' pin-active' : ''),
    html: label, iconSize: [0, 0], iconAnchor: [0, 0]
  });
}
/* Centre a point in the map area still visible above the sheet. */
function focusOn(lat, lng, zoom) {
  const ph = phone.clientHeight;
  const visible = sheetH() - ty;
  const offset = ph / 2 - (ph - visible) / 2;
  const pt = map.project([lat, lng], zoom).add([0, offset]);
  const target = map.unproject(pt, zoom);
  if (REDUCE_MOTION) map.setView(target, zoom, { animate: false });
  else map.flyTo(target, zoom, { duration: .55 });
}

/* ---------- render ---------- */
function sorted() {
  const l = DATA.slice();
  if (userLoc) l.sort((a, b) => a._d - b._d);
  else l.sort((a, b) => b.gameCount - a.gameCount);
  return l;
}
function thumbHTML(p) {
  return p.photo
    ? '<img src="' + esc(p.photo) + '" alt="">'
    : '<b aria-hidden="true">' + esc(p.name[0]) + '</b>';
}
function renderList() {
  const l = sorted();
  titleEl.textContent = userLoc ? 'Nearest to you' : 'Board games in Kathmandu';
  subEl.textContent = l.length + ' places';
  listEl.innerHTML = l.map((p, i) =>
    '<div class="row' + (selected === p.id ? ' sel' : '') + '" data-id="' + esc(p.id) + '"' +
      ' role="button" tabindex="0">' +
      '<div class="thumb">' + thumbHTML(p) + '</div>' +
      '<div class="rmain">' +
        '<div class="rtop"><h2>' + esc(p.name) + '</h2>' +
          (p.verified ? TICK + '<span class="sr-only">Played here by Tumlet</span>' : '') + '</div>' +
        '<div class="rmeta">' + esc(p.type) + ' · ' + esc(p.area) + '</div>' +
        '<div class="rgames">' + esc(p.gameCount) + ' games</div>' +
      '</div>' +
      (userLoc ? '<div class="dist">' + fmt(p._d) + '</div>' : '') +
    '</div>' + (i < l.length - 1 ? '<div class="sep"></div>' : '')
  ).join('');

  listEl.querySelectorAll('.row').forEach(r => {
    r.addEventListener('click', () => select(r.dataset.id));
    r.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.dataset.id); }
    });
  });
}
function renderDetail(p) {
  const shown = p.games.slice(0, 6);
  const rest = Math.max(0, p.gameCount - shown.length);
  const dir = CFG.directionsUrl
    .replace('{lat}', encodeURIComponent(p.lat))
    .replace('{lng}', encodeURIComponent(p.lng));

  detailEl.innerHTML =
    '<button class="back" id="back" type="button">← all places</button>' +
    '<div class="hero">' + thumbHTML(p) + '</div>' +
    '<h2>' + esc(p.name) + '</h2>' +
    '<div class="dmeta">' + esc(p.type) + ' · ' + esc(p.area) +
      (userLoc ? ' · ' + fmt(p._d) + ' away' : '') + '</div>' +
    (p.verified ? '<div class="vbadge">' + TICK + ' Played here by Tumlet</div>' : '') +
    '<p class="blurb">' + esc(p.blurb) + '</p>' +
    '<div class="chips">' + shown.map(g => '<span class="chip">' + esc(g) + '</span>').join('') +
      (rest ? '<span class="chip more">+' + rest + ' more</span>' : '') + '</div>' +
    '<div class="line"></div>' +
    '<div class="kv"><span>Phone</span><a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a></div>' +
    '<a class="cta" target="_blank" rel="noopener" href="' + esc(dir) + '">Get directions</a>';

  detailEl.querySelector('#back').addEventListener('click', deselect);
}
/* Where the list was scrolled to before opening a detail, so going back
   returns you to the place you were reading rather than to a stale offset
   inherited from the detail's own scroll height. */
let listScroll = 0;

function select(id) {
  const p = DATA.find(x => x.id === id);
  if (!p) return;
  if (!listEl.classList.contains('hidden')) listScroll = bodyEl.scrollTop;
  if (selected && markers[selected]) {
    markers[selected].setIcon(icon(DATA.find(x => x.id === selected), false));
    markers[selected].setZIndexOffset(0);
  }
  selected = id;
  markers[id].setIcon(icon(p, true));
  markers[id].setZIndexOffset(1000);
  renderDetail(p);
  listEl.classList.add('hidden');
  detailEl.classList.remove('hidden');
  bodyEl.scrollTop = 0;
  if (snapName === 'full' || snapName === 'peek') setSnap('half');
  setTimeout(() => focusOn(p.lat, p.lng, Math.max(15.5, map.getZoom())), 20);
}
function deselect() {
  if (selected && markers[selected]) {
    markers[selected].setIcon(icon(DATA.find(x => x.id === selected), false));
    markers[selected].setZIndexOffset(0);
  }
  selected = null;
  detailEl.classList.add('hidden');
  listEl.classList.remove('hidden');
  renderList();
  bodyEl.scrollTop = listScroll;
}

map.on('zoomend', () => {
  const on = map.getZoom() >= CFG.map.labelZoom;
  if (on === labelsOn) return;
  labelsOn = on;
  DATA.forEach(p => markers[p.id].setIcon(icon(p, p.id === selected)));
});

/* ---------- locate ---------- */
function applyLocation(lat, lng, demo) {
  userLoc = [lat, lng];
  DATA.forEach(p => { p._d = dist(lat, lng, p.lat, p.lng); });
  if (meMarker) map.removeLayer(meMarker);
  meMarker = L.marker([lat, lng], {
    icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me"></div>',
                      iconSize: [0, 0], iconAnchor: [0, 0] }),
    interactive: false, zIndexOffset: 500
  }).addTo(map);
  locateBtn.classList.add('on');
  if (selected) deselect(); else renderList();
  /* The list has just been re-sorted by distance, so any remembered
     position points at a different place now. */
  listScroll = 0;
  bodyEl.scrollTop = 0;
  setSnap('half');
  setTimeout(() => focusOn(lat, lng, 14.5), 20);
  const near = sorted()[0];
  toast(demo ? 'Using a demo location in Thamel'
             : near.name + ' is ' + fmt(near._d) + ' away');
}
function doLocate() {
  if (userLoc) { focusOn(userLoc[0], userLoc[1], 14.5); return; }
  toast('Finding you…');
  const demo = () => applyLocation(CFG.demoLocation[0], CFG.demoLocation[1], true);
  if (!navigator.geolocation) return demo();
  navigator.geolocation.getCurrentPosition(
    pos => applyLocation(pos.coords.latitude, pos.coords.longitude, false),
    demo,
    { enableHighAccuracy: true, timeout: 7000 }
  );
}
locateBtn.addEventListener('click', doLocate);

/* ---------- boot ---------- */
function boot(d) {
  DATA = d.places;
  if (d.center) map.setView(d.center, CFG.map.zoom);
  DATA.forEach(p => {
    const m = L.marker([p.lat, p.lng], { icon: icon(p, false) }).addTo(map);
    m.on('click', () => select(p.id));
    markers[p.id] = m;
  });
  map.fitBounds(L.latLngBounds(DATA.map(p => [p.lat, p.lng])),
                { paddingTopLeft: [36, 70], paddingBottomRight: [36, 180] });
  computeSnaps();
  renderList();

  /* Manifest shortcut: katakhelne://?locate=1 */
  if (new URLSearchParams(location.search).get('locate') === '1') {
    setTimeout(doLocate, 400);
  }
}

fetch(CFG.data)
  .then(r => r.json())
  .then(boot)
  .catch(() => {
    computeSnaps();
    listEl.innerHTML = '<div style="padding:20px;color:#8a8580;font-size:14px">' +
      'Could not load places.json</div>';
  });

map.on('click', () => { if (selected) deselect(); });
window.addEventListener('resize', computeSnaps);
window.addEventListener('load', computeSnaps);
computeSnaps();

/* =====================================================================
   PWA
   ===================================================================== */

/* --- offline awareness --- */
window.addEventListener('offline', () => toast('Offline — showing saved places'));
window.addEventListener('online',  () => { if (!noTilesShown) probeTiles(); });
if (!navigator.onLine) setTimeout(() => toast('Offline — showing saved places'), 900);

/* --- service worker + update prompt --- */
function offerUpdate(reg) {
  toastEl.innerHTML = 'A new version is ready<u>Reload</u>';
  toastEl.classList.add('show', 'action');
  clearTimeout(toastTimer);
  toastEl.onclick = () => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloaded) { reloaded = true; location.reload(); }
  });
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          /* An install with an existing controller means an update, not a
             first run. */
          if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
        });
      });
    }).catch(() => { /* http:// or unsupported — the app still works */ });
  });
}

/* --- install prompt --- */
const installEl = document.getElementById('install');
const DISMISS_KEY = 'kk.install.dismissed';

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches ||
                     navigator.standalone === true;

let deferredPrompt = null;

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
}
function showInstall() {
  if (isStandalone || dismissed()) return;
  if (!deferredPrompt && !isIOS) return;
  installEl.setAttribute('data-show', '1');
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  setTimeout(showInstall, 2500);
});
/* Safari fires no beforeinstallprompt — surface the manual route instead. */
if (isIOS && !isStandalone) setTimeout(showInstall, 3500);

document.getElementById('installGo').addEventListener('click', async () => {
  if (deferredPrompt) {
    installEl.removeAttribute('data-show');
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  } else if (isIOS) {
    toast('Tap Share, then “Add to Home Screen”');
  }
});
document.getElementById('installX').addEventListener('click', () => {
  installEl.removeAttribute('data-show');
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* private mode */ }
});
window.addEventListener('appinstalled', () => {
  installEl.removeAttribute('data-show');
  deferredPrompt = null;
});

})();
