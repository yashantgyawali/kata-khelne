import re, os, urllib.request, pathlib

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
OUT = pathlib.Path("assets/fonts"); OUT.mkdir(parents=True, exist_ok=True)
KEEP = {"latin", "latin-ext"}

FAMILIES = [
    ("Atkinson Hyperlegible", "Atkinson+Hyperlegible:wght@400;700", "atkinson-hyperlegible"),
    ("Manrope",               "Manrope:wght@400..800",              "manrope"),
    ("Patrick Hand",          "Patrick+Hand",                       "patrick-hand"),
]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req).read()

blocks_out = []
for fam, spec, slug in FAMILIES:
    css = get(f"https://fonts.googleapis.com/css2?family={spec}&display=swap").decode()
    # split into @font-face blocks, each preceded by a /* subset */ comment
    parts = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", css)
    for subset, block in parts:
        if subset not in KEEP:
            continue
        url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        wght = re.search(r"font-weight:\s*([^;]+);", block).group(1).strip()
        style = re.search(r"font-style:\s*([^;]+);", block).group(1).strip()
        urange = re.search(r"unicode-range:\s*([^;]+);", block).group(1).strip()
        name = f"{slug}-{wght.replace(' ', '-')}-{subset}.woff2"
        (OUT / name).write_bytes(get(url))
        blocks_out.append(
            "@font-face {\n"
            f"  font-family: '{fam}';\n"
            f"  font-style: {style};\n"
            f"  font-weight: {wght};\n"
            "  font-display: swap;\n"
            f"  src: url('../fonts/{name}') format('woff2');\n"
            f"  unicode-range: {urange};\n"
            "}"
        )
        print(f"  {name:52s} {(OUT/name).stat().st_size/1024:6.1f} KB")

header = (
    "/* =====================================================================\n"
    "   SELF-HOSTED WEBFONTS\n"
    "   Pulled from Google Fonts and vendored so the app renders correctly\n"
    "   offline and makes no third-party requests at runtime. Regenerate with\n"
    "   tools/fetch-fonts.py after changing the families in tokens.css.\n\n"
    "   Atkinson Hyperlegible - Braille Institute      (OFL 1.1)\n"
    "   Manrope               - Mikhail Sharanda       (OFL 1.1)\n"
    "   Patrick Hand          - Patrick Wagesreiter    (OFL 1.1)\n"
    "   ===================================================================== */\n\n"
)
pathlib.Path("assets/css/fonts.css").write_text(header + "\n\n".join(blocks_out) + "\n")
print(f"\nwrote assets/css/fonts.css ({len(blocks_out)} faces)")
