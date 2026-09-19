/* =====================================================================
   katakhelne — shared configuration

   Loaded as a plain script in the page AND via importScripts() in the
   service worker, so it assigns to `self` (which is `window` in a page).
   Change the tile source here and both the map and the offline cache
   follow — there is nothing else to update.
   ===================================================================== */

self.KK = {
  /* Bump to invalidate every cache on the next service-worker activation. */
  version: '1.1.0',

  tiles: {
    /* OpenStreetMap's own tiles: open data, open renderer, no API key.
       Their servers are volunteer-funded and the usage policy
       (https://operations.osmfoundation.org/policies/tiles/) asks that
       apps keep volume modest and never bulk-download. This app caches
       only tiles you actually pan over, which is well within it.

       For heavier traffic, swap the four fields below for another
       OSM-data provider — OpenFreeMap, Carto, Stadia and MapTiler all
       serve the same open data. Keep `attribution` accurate. */
    url:        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:'© OpenStreetMap contributors',
    maxZoom:    19,

    /* Hosts whose responses the service worker treats as map tiles.
       Subdomains (a./b./c.) are matched automatically. */
    hosts: ['tile.openstreetmap.org'],

    /* A real Kathmandu tile at z12 — used to detect a blocked tile server
       (see app.js) and, as a side effect, to warm the tile cache. */
    probe: 'https://tile.openstreetmap.org/12/3018/1719.png',

    /* Cached tiles are evicted oldest-first past this count.
       ~600 tiles is roughly 15-25 MB and covers the valley at the zooms
       this app actually uses. */
    cacheLimit: 600
  },

  map: {
    center:    [27.7089, 85.3206],  /* Kathmandu */
    zoom:      12.5,
    labelZoom: 15                   /* pins swap dot -> name label at/above this */
  },

  /* Fallback when geolocation is denied or unavailable. Thamel. */
  demoLocation: [27.7154, 85.3123],

  /* The "Get directions" CTA hands off to a turn-by-turn app. Google Maps
     is what people actually navigate with in Kathmandu, so it is the
     default; for an end-to-end open-source stack use OSM instead:
     'https://www.openstreetmap.org/directions?to={lat},{lng}' */
  directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination={lat},{lng}',

  data: 'data/places.json'
};
