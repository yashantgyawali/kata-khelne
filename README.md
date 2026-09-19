# katakhelne

**कता खेल्ने** — *where to play.* A map of the cafes, bars, co-working spaces
and game rooms around Kathmandu with board games on the shelf.

An installable Progressive Web App: no build step, no framework, no runtime
third-party requests. Once opened it works offline, including the parts of the
map you have already panned over.

Built from the Claude Design prototype *Kathmandu Board Game Map* (handoff v2)
against the Tumlet design system.

---

## Run it

```bash
python3 tools/serve.py
```

Then open <http://localhost:8000>.

Any static file server works, but `tools/serve.py` gets two things right that
`python3 -m http.server` does not: it serves `.webmanifest` as
`application/manifest+json` and `.woff2` as `font/woff2`, and it sends
`Cache-Control: no-cache` rather than `no-store` — **Chrome silently refuses to
register a service worker whose script it may not store**, and fails with a
generic "unknown error occurred when fetching the script".

Service workers need a secure context. `http://localhost` counts, so local
development is fine; anywhere else must be HTTPS.

## Deploy

Copy the repository to any static host — Netlify, Cloudflare Pages, GitHub
Pages, an nginx root. There is nothing to compile.

Every path is relative, so it works from a subdirectory
(`example.com/katakhelne/`) as well as from a domain root.

Two things the host must get right:

- **HTTPS**, or the service worker will not register and the app will not install.
- **Do not send `Cache-Control: no-store`** for `sw.js`. Prefer `no-cache` so
  updates are picked up promptly.

### Netlify

`netlify.toml` is committed and needs no changes. Connect the repo and deploy —
leave the build command empty and the publish directory as the repo root.

It pins `sw.js` to `max-age=0, must-revalidate` so a deploy is picked up
immediately, and caches `assets/fonts`, `assets/vendor` and `assets/icons` for
a year (those are version-pinned by filename). `assets/css` and `assets/js` are
deliberately left on Netlify's revalidating default — they are **not**
content-hashed, so an immutable cache there would outlive a deploy.

`.nojekyll` is only relevant to GitHub Pages; it is harmless on Netlify.

## Testing

```bash
node tools/sw-test.mjs
```

Runs `sw.js` through a real install → activate → fetch lifecycle against an
in-memory Cache API: precaching, stale-cache cleanup, tile caching and
eviction, offline serving, and which requests it declines to intercept.

---

## The map

The basemap is [Leaflet](https://leafletjs.com/) rendering
[OpenStreetMap](https://www.openstreetmap.org/) tiles — open renderer, open
data, no API key, no account. Both are vendored into `assets/vendor/` and
verified against the SRI hashes from the design, so nothing is fetched from a
CDN at runtime.

Tiles are desaturated in CSS (`grayscale(1) sepia(.10) brightness(1.07)
contrast(.9)`) to sit under the warm Tumlet palette instead of competing
with it.

### Swapping the tile source

`assets/js/config.js` is the only place to change. The page and the service
worker both read it, so the map and the offline cache stay in agreement:

```js
tiles: {
  url:        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:'© OpenStreetMap contributors',
  hosts:      ['tile.openstreetmap.org'],   // what the SW treats as a tile
  probe:      'https://tile.openstreetmap.org/12/3018/1719.png',
  ...
}
```

**You will probably need to.** OSM's tile servers are volunteer-funded and
their [usage policy](https://operations.osmfoundation.org/policies/tiles/)
asks that apps keep volume modest. They also refuse some origins — and the
refusal arrives as a *valid, blank PNG*, not an error, so nothing fails
loudly. The app probes one tile through a canvas on startup and, if it comes
back as the block notice, hides the tile layer and shows "Map tiles
unavailable here" rather than papering the map with error text.

OpenFreeMap, Carto, Stadia and MapTiler all serve the same open OSM data if
you need more headroom. Keep `attribution` accurate whichever you pick.

Tiles are only ever cached as you pan over them — nothing is pre-fetched in a
grid, which would count as bulk downloading under that policy.

---

## The data

`data/places.json` is the list — 11 cafes around the valley. Edit it and the
map picks the change up on reload; there is nothing to rebuild.

```json
{
  "id": "p11",
  "name": "Daily Drip",
  "type": "Cafe",
  "area": "Tundaldevi, Baluwatar",
  "lat": 27.724603,
  "lng": 85.331017,
  "approx": true,
  "photo": "",
  "blurb": "",
  "collection": "Good collection",
  "games": ["Bluff Momo", "Dungeons & Dragons"],
  "gameCount": null,
  "phone": "",
  "verified": false
}
```

| field | notes |
|---|---|
| `id` | unique; any stable string |
| `lat` / `lng` | `null` is fine — the place still lists, it just gets no pin and its detail page says "Location not added yet" |
| `approx` | `true` = the pin is the neighbourhood centre, not the door. The detail page says so |
| `photo` | image URL or a repo path like `assets/photos/daily-drip.jpg`; `""` falls back to the initial on a beige tile |
| `blurb` | one or two lines. Empty is fine — the paragraph is skipped entirely |
| `collection` | a human note like "Crazy collection". Shown in the list instead of a number |
| `games` | named games; the first 6 become chips |
| `gameCount` | total on the shelf **if you actually know it**, else `null` |
| `phone` | empty hides the phone row completely |
| `verified` | shows the "Played here by Tumlet" badge |

The list row shows `collection` if set, else `gameCount` as "N games", else
"N games listed" from the named games — so it never states a total nobody
has counted.

**Ordering.** With no location the list keeps the order of the file, which
makes that order an editorial decision worth making deliberately. Once
located it sorts by distance, with unpinned places last.

### Where the coordinates came from

Geocoded against [Nominatim](https://nominatim.openstreetmap.org/), OSM's own
geocoder — same open data as the basemap, no API key. Three resolved to the
actual venue; the rest only to their neighbourhood and carry `approx: true`.
Where two approximate pins landed on the same centroid they are nudged ~110 m
apart so both stay tappable.

To pin one exactly: open [openstreetmap.org](https://www.openstreetmap.org),
right-click the spot → "Show address", copy the lat/lng in, and set
`approx` to `false`.

### Photos

`photo` is empty for every place, and the initial-on-beige fallback is doing
the work. **Google's place photos are not usable here** — the Places API
needs a billed API key, and the images are third-party copyrighted works that
scraping would not license for a public site. Hotlinked Google URLs also
expire.

The workable routes, in order of how well they fit:

1. **Your own photos.** Drop files in `assets/photos/` and point `photo` at
   them. You have been to these places.
2. **Ask the cafes.** Most will happily hand over a photo for a listing.
3. **Google Places API** with your own key, if you want it automated — the
   `photo` field takes any URL, so nothing in the app needs to change.

## PWA behaviour

**Caching** — three caches, each with the strategy that suits it:

| cache | holds | strategy |
|---|---|---|
| `kk-shell-<v>` | HTML, CSS, JS, fonts, icons, Leaflet | cache-first |
| `kk-data-<v>` | `places.json` | stale-while-revalidate |
| `kk-tiles-<v>` | map tiles | cache-first, oldest-first cap (600) |

`places.json` renders instantly from cache and refreshes behind you, so
editing the list does not require a version bump.

**Offline** — the app shell and the places list are precached on install, so
the first offline launch already works. Tiles appear for areas you have
visited; elsewhere the map is empty but the list, detail pages and phone
links all still work.

**Updates** — bump `version` in `assets/js/config.js`. The new worker installs
in the background, the app shows a "A new version is ready — Reload" toast,
and nothing is swapped until the user accepts. Old caches are deleted on
activation.

**Install** — a prompt appears once, bottom-left, and stays dismissed
(`localStorage`). iOS Safari fires no `beforeinstallprompt`, so there it
explains the Share → Add to Home Screen route instead.

**Installed layout** — on desktop the app draws itself inside a phone mockup,
as designed. On a phone, or once installed, the device *is* the frame: the
bezel is dropped and the notch and home-indicator insets are respected via
`env(safe-area-inset-*)`.

---

## Project structure

```
index.html                 markup + PWA head
manifest.webmanifest       name, icons, standalone, "Near me" shortcut
sw.js                      service worker
assets/
  css/tokens.css           Tumlet design system tokens
  css/fonts.css            self-hosted @font-face (generated)
  css/app.css              the app
  js/config.js             tile source, map defaults, version — page AND sw
  js/app.js                map, sheet, list, detail, PWA glue
  fonts/                   Atkinson Hyperlegible, Manrope, Patrick Hand (OFL)
  icons/                   generated from the two-T mark
  vendor/leaflet/          Leaflet 1.9.4, SRI-verified
data/places.json           the list
tools/                     dev server, icon + font generators, sw test
```

### Regenerating assets

```bash
python3 tools/make-icons.py    # icons, from the two-T lockup
python3 tools/fetch-fonts.py   # re-pull webfonts from Google Fonts
```

`make-icons.py` rasterises the mark with a small dependency-free PNG encoder,
so there is no ImageMagick or Pillow to install.

---

## Notes and limitations

- **Fonts are vendored.** Atkinson Hyperlegible, Manrope and Patrick Hand are
  all OFL 1.1. Baloo 2 is declared as `--font-nepali` in the tokens but is
  *not* bundled — this app ships no Devanagari copy yet. Add the face to
  `fonts.css` before using it.
- **"Get directions" opens Google Maps**, which is what people actually
  navigate with in Kathmandu. `directionsUrl` in `config.js` swaps it for
  OpenStreetMap if you want the stack open end to end.
- **Geolocation falls back to Thamel** when it is denied or unavailable, and
  says so, rather than leaving the list unsorted.
- Reduced-motion is honoured: the map jumps rather than flies, and
  transitions are disabled.
