#!/usr/bin/env python3
"""
Generate katakhelne PWA icons — the Tumlet two-T lockup on beige.

Pure stdlib: shapes are axis-aligned rectangles rasterised on a 4x supersampled
grid and box-downsampled, then encoded as PNG with zlib. No image libraries.
Run from the repo root:  python3 tools/make-icons.py
"""
import zlib, struct, pathlib

BEIGE = (0xFA, 0xF1, 0xE4)
RED   = (0xF1, 0x61, 0x47)
YEL   = (0xF3, 0xB9, 0x52)
SS    = 4                       # supersample factor

OUT = pathlib.Path("assets/icons"); OUT.mkdir(parents=True, exist_ok=True)


class Canvas:
    def __init__(self, n, bg):
        self.n = n
        self.rows = [bytearray(bg * n) for _ in range(n)]

    def rect(self, x0, y0, x1, y1, color):
        """Fill [x0,x1) x [y0,y1) in device pixels, clipped to the canvas."""
        x0 = max(0, int(round(x0))); x1 = min(self.n, int(round(x1)))
        y0 = max(0, int(round(y0))); y1 = min(self.n, int(round(y1)))
        if x1 <= x0 or y1 <= y0:
            return
        span = bytes(color) * (x1 - x0)
        for y in range(y0, y1):
            self.rows[y][x0 * 3:x1 * 3] = span

    def downsample(self, factor):
        """Box-filter down by `factor`, giving antialiased edges."""
        m = self.n // factor
        out = []
        inv = 1.0 / (factor * factor)
        for y in range(m):
            row = bytearray(m * 3)
            src = self.rows[y * factor:(y + 1) * factor]
            for x in range(m):
                r = g = b = 0
                lo = x * factor * 3
                for sr in src:
                    for k in range(factor):
                        i = lo + k * 3
                        r += sr[i]; g += sr[i + 1]; b += sr[i + 2]
                row[x * 3]     = int(r * inv + .5)
                row[x * 3 + 1] = int(g * inv + .5)
                row[x * 3 + 2] = int(b * inv + .5)
            out.append(row)
        return out


def draw_tt(c, cx, cy, logo_w):
    """Two overlapping T's centred on (cx, cy), total lockup width `logo_w`."""
    # One T: width tw, height th (Manrope-800 'T' proportions), stem 26% of width,
    # crossbar 26% of height. Second T sits 71% along the first -> 29% overlap.
    tw = logo_w / 1.71
    th = tw * 1.16
    bar, stem = th * 0.26, tw * 0.26
    x0, y0 = cx - logo_w / 2, cy - th / 2

    def T(left, color):
        c.rect(left, y0, left + tw, y0 + bar, color)                       # crossbar
        c.rect(left + (tw - stem) / 2, y0, left + (tw + stem) / 2,
               y0 + th, color)                                            # stem

    T(x0, RED)                       # red T first ...
    T(x0 + tw * 0.71, YEL)           # ... yellow T overlaps it, per the wordmark


def png(path, rows, n):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    blob = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))
    path.write_bytes(blob)
    return len(blob)


# name, size, logo width as a fraction of the canvas
ICONS = [
    ("icon-192.png",          192, 0.72),
    ("icon-512.png",          512, 0.72),
    ("icon-maskable-192.png", 192, 0.50),   # inside the 40% maskable safe zone
    ("icon-maskable-512.png", 512, 0.50),
    ("apple-touch-icon.png",  180, 0.68),
    ("favicon-32.png",         32, 0.80),
    ("favicon-16.png",         16, 0.86),
]

for name, size, frac in ICONS:
    n = size * SS
    c = Canvas(n, BEIGE)
    draw_tt(c, n / 2, n / 2, n * frac)
    nbytes = png(OUT / name, c.downsample(SS), size)
    print(f"  {name:24s} {size:>4}px  {nbytes/1024:5.1f} KB")

# Vector favicon — same geometry, crisp at any size.
tw = 100 / 1.71; th = tw * 1.16; bar = th * .26; stem = tw * .26
x0, y0 = (128 - 100) / 2, (128 - th) / 2


def t_svg(left, fill):
    return (f'<path fill="{fill}" d="M{left:.2f} {y0:.2f}h{tw:.2f}v{bar:.2f}'
            f'h-{(tw-stem)/2:.2f}v{th-bar:.2f}h-{stem:.2f}v-{th-bar:.2f}'
            f'h-{(tw-stem)/2:.2f}z"/>')


(OUT / "favicon.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
    '<rect width="128" height="128" fill="#FAF1E4"/>'
    + t_svg(x0, "#F16147") + t_svg(x0 + tw * .71, "#F3B952") +
    '</svg>\n'
)
print("  favicon.svg")

# ---------------------------------------------------------------------------
# favicon.ico — browsers still probe /favicon.ico even when <link rel="icon">
# is declared. ICO can embed PNG payloads directly (Vista+), so the 16px and
# 32px PNGs above are packed as-is; no ICO-specific encoder needed.
entries, blobs = [], []
offset = 6 + 16 * 2
for src in ("favicon-16.png", "favicon-32.png"):
    blob = (OUT / src).read_bytes()
    size = 16 if "16" in src else 32
    entries.append(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(blob), offset))
    blobs.append(blob)
    offset += len(blob)

ico = OUT.parent.parent / "favicon.ico"
ico.write_bytes(struct.pack("<HHH", 0, 1, 2) + b"".join(entries) + b"".join(blobs))
print(f"  favicon.ico              16+32px  {ico.stat().st_size/1024:5.1f} KB  (repo root)")
