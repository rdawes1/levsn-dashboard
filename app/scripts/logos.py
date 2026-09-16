"""
Standardise partner logos for the dashboard.

    python3 app/scripts/logos.py

Reads the originals from "Project Planning/Logos" and writes trimmed, uniformly
sized images to app/public/logos/<slug>.webp.

"Uniform" means equal visual weight, not equal box size: every logo is scaled to
the same *area*, then capped by a maximum width and height. Fitting logos into a
fixed box instead makes wide wordmarks look enormous next to square badges.

Backgrounds are left alone (white stays white). Knocking out white would eat
white artwork inside some logos, e.g. the heron in Huron River's, so the
dashboard always shows logos on a white chip instead.
"""
import json
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "Project Planning" / "Logos"
OUT = ROOT / "app" / "public" / "logos"
MANIFEST = ROOT / "app" / "src" / "lib" / "logos.generated.json"

# Organisation name exactly as it appears in Airtable -> (source file, slug).
LOGOS = {
    "Ashland Soil & Water Conservation District": ("ashlandSoilandWaterlogo.jpg", "ashland-swcd"),
    "Buffalo Niagara Waterkeeper": ("buffaloniagralogo.webp", "buffalo-niagara-waterkeeper"),
    "City of Cuyahoga Falls": ("cityofcuyahogafalls.png", "city-of-cuyahoga-falls"),
    "Clinton River Watershed Council": ("Clinton River Watershed CouncilLogo.jpeg", "clinton-river-watershed-council"),
    "Defiance Soil & Water Conservation District": ("defianceSoilandWaterConservationDistrict.png", "defiance-swcd"),
    "Doan Brook Watershed Partnership": ("DoanBrooklogo.webp", "doan-brook-watershed-partnership"),
    "Erie Soil and Water Conservation District": ("Erie Soil & Water Conservation District.webp", "erie-swcd"),
    "Huron River Watershed Council": ("huron.webp", "huron-river-watershed-council"),
    "River Raisin": ("riverraisin.png", "river-raisin-watershed-council"),
    "Summit Soil and Water Conservation District": ("SummitSoil and Water.jpeg", "summit-swcd"),
    "Tinkers Creek Watershed Partners": ("tinkerscreeklogo.webp", "tinkers-creek-watershed-partners"),
    "University of Windsor": ("University of Windsor Logo.webp", "university-of-windsor"),
    "Water Rangers": ("Water-Rangers-Logo.webp", "water-rangers"),
    # Deliberately absent - see the dashboard notes:
    #   Community Water Action Toledo: supplied file is the Partners for Clean Streams logo
    #   Cleveland Metroparks, Fredonia State University of New York: no logo supplied
}

TARGET_AREA = 150 * 72      # px^2 at 2x - sets the shared visual weight
MAX_W, MAX_H = 260, 96      # 2x pixels; displayed at half size
PAD = 4


def trim(im: Image.Image) -> Image.Image:
    """Crop away uniform white or transparent borders."""
    rgba = im.convert("RGBA")
    alpha_box = rgba.getchannel("A").point(lambda a: 255 if a > 12 else 0).getbbox()
    white = Image.new("RGB", rgba.size, (255, 255, 255))
    diff = ImageChops.difference(rgba.convert("RGB"), white).convert("L")
    ink_box = diff.point(lambda v: 255 if v > 24 else 0).getbbox()
    # Content must be both opaque and not near-white.
    boxes = [b for b in (alpha_box, ink_box) if b]
    if not boxes:
        return rgba
    l = max(b[0] for b in boxes); t = max(b[1] for b in boxes)
    r = min(b[2] for b in boxes); btm = min(b[3] for b in boxes)
    if r - l < 4 or btm - t < 4:  # fall back if the intersection collapses
        l, t, r, btm = ink_box or alpha_box
    return rgba.crop((l, t, r, btm))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for org, (fname, slug) in LOGOS.items():
        im = trim(Image.open(SRC / fname))
        w, h = im.size
        scale = (TARGET_AREA / (w * h)) ** 0.5
        scale = min(scale, MAX_W / w, MAX_H / h)
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        im = im.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGBA", (nw + PAD * 2, nh + PAD * 2), (255, 255, 255, 0))
        canvas.paste(im, (PAD, PAD), im)
        dest = OUT / f"{slug}.webp"
        canvas.save(dest, "WEBP", quality=90, method=6)
        # Width and height are the 2x pixel size; the dashboard displays at half.
        manifest[org] = {"src": f"/logos/{slug}.webp", "width": canvas.width, "height": canvas.height}
        upscaled = scale > 1.05
        print(f"{slug:36} {w:5}x{h:<5} -> {canvas.width:3}x{canvas.height:<3} "
              f"{dest.stat().st_size//1024:3} KB{'  (upscaled - low-res source)' if upscaled else ''}")

    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"\nmanifest: {MANIFEST.relative_to(ROOT)} ({len(manifest)} organisations)")


if __name__ == "__main__":
    main()
