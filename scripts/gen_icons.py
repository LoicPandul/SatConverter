"""Regenerate all app icons from the master logo.

Usage:  python scripts/gen_icons.py path/to/logo.png

Each size is resized directly from the master (with per-size sharpening) and
masked with ~22% rounded corners (Windows 11 style).

IMPORTANT — entry order in icon.ico:
Tauri embeds the FIRST entry of icon.ico as the runtime window icon
(tauri-codegen `icon_dir.entries()[0]`), which the Windows taskbar then
scales to ~48 physical px. The 256px entry must therefore come FIRST,
otherwise the taskbar upscales a 16px image and looks pixelated.
Pillow writes entries smallest-first, so we reorder the ICONDIR after saving
(directory entries are permuted in place; data offsets stay valid).
"""

import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parent.parent
ICONS = REPO / "src-tauri" / "icons"


def rounded_mask(size: int, radius_pct: float = 0.22) -> Image.Image:
    big = size * 4
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=int(big * radius_pct), fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def make(logo: Image.Image, size: int, radius_pct: float = 0.22) -> Image.Image:
    im = logo.resize((size, size), Image.LANCZOS)
    if size <= 64:
        im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=110, threshold=1))
    else:
        im = im.filter(ImageFilter.UnsharpMask(radius=1.5, percent=60, threshold=2))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), rounded_mask(size, radius_pct))
    return out


def put_largest_entry_first(ico_path: Path) -> None:
    data = bytearray(ico_path.read_bytes())
    count = struct.unpack("<H", data[4:6])[0]
    entries = [bytes(data[6 + i * 16 : 6 + (i + 1) * 16]) for i in range(count)]
    # width byte 0 means 256
    entries.sort(key=lambda e: e[0] or 256, reverse=True)
    data[6 : 6 + count * 16] = b"".join(entries)
    ico_path.write_bytes(bytes(data))


def main() -> None:
    src = Path(sys.argv[1])
    logo = Image.open(src).convert("RGBA")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = {s: make(logo, s) for s in sizes}
    imgs[256].save(
        ICONS / "icon.ico", format="ICO",
        append_images=[imgs[s] for s in sizes if s != 256],
    )
    put_largest_entry_first(ICONS / "icon.ico")

    make(logo, 512).save(ICONS / "icon.png")
    make(logo, 256).save(ICONS / "128x128@2x.png")
    make(logo, 128).save(ICONS / "128x128.png")
    make(logo, 32).save(ICONS / "32x32.png")
    make(logo, 64, radius_pct=0.32).save(REPO / "ui" / "assets" / "logo-64.png")
    make(logo, 512).save(REPO / "assets" / "logo.png")
    print("icons regenerated")


if __name__ == "__main__":
    main()
