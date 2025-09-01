# %%
# Interactive image processing script (notebook alternative)
# Run as a script:  python notebooks/image_processing.py
# Or open in VS Code / Jupyter and run cell-by-cell.

from __future__ import annotations

from pathlib import Path
import sys
import argparse

from PIL import Image, ImageOps


# Ensure repo root is on sys.path so `imaging` imports resolve
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from imaging.process import to_1bit  # noqa: E402


def _show(img: Image.Image, title: str | None = None) -> None:
    """Display an image if possible; fall back to opening a window."""
    try:
        from IPython.display import display  # type: ignore

        display(img)
    except Exception:
        try:
            img.show(title=title)
        except Exception:
            pass  # Headless environments may not be able to display


# %%
# Inputs and configuration (CLI-friendly)

script_dir = Path(__file__).parent

def pick_default_image() -> Path:
    # Prefer images in notebooks/ first, then repo root
    nb_pngs = sorted(script_dir.glob("*.png"))
    if nb_pngs:
        return nb_pngs[0]
    root_pngs = sorted(REPO_ROOT.glob("*.png"))
    if root_pngs:
        return root_pngs[0]
    # Fall back to a conventional name in notebooks/
    return script_dir / "sample.png"


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--image", "-i", type=str, help="Path to input image")
parser.add_argument("--width", "-w", type=int, default=463, help="Printer width in dots")
parser.add_argument("--out", type=str, default=str(script_dir / "out"), help="Output directory")

# Be permissive in interactive environments
args, _ = parser.parse_known_args()

OUT_DIR = Path(args.out)
OUT_DIR.mkdir(exist_ok=True)

printer_width = int(args.width)  # LP2844 max ~576 depending on media

if args.image:
    candidate = Path(args.image)
    if not candidate.is_file():
        # Try relative to notebooks/ if not found
        rel = (script_dir / args.image).resolve()
        candidate = rel if rel.is_file() else candidate
    image_path = candidate
else:
    image_path = pick_default_image()

if not image_path.exists():
    raise FileNotFoundError(f"Input image not found: {image_path}")

print(f"Using image: {image_path}")


# %%
# Load original image
original = Image.open(image_path)
_show(original, title="Original")


# %%
# Convert to grayscale with EXIF orientation applied
# Allow running this cell independently in interactive mode
if 'image_path' not in globals():
    # Recreate inputs if this cell is run first
    sample_pngs = sorted(REPO_ROOT.glob("*.png"))
    image_path = sample_pngs[0] if sample_pngs else REPO_ROOT / "sample.png"
if 'original' not in globals():
    original = Image.open(image_path)
img_gray = ImageOps.exif_transpose(original).convert("L")
_show(img_gray, title="Grayscale")
img_gray.save(OUT_DIR / "01_gray.png")


# %%
# Resize to printer width while preserving aspect ratio
if 'printer_width' not in globals():
    printer_width = 463
if 'img_gray' not in globals():
    # Fallback for out-of-order cell execution
    if 'image_path' not in globals():
        sample_pngs = sorted(REPO_ROOT.glob("*.png"))
        image_path = sample_pngs[0] if sample_pngs else REPO_ROOT / "sample.png"
    if 'original' not in globals():
        original = Image.open(image_path)
    img_gray = ImageOps.exif_transpose(original).convert("L")
ratio = printer_width / img_gray.width
new_height = int(img_gray.height * ratio)
img_resized = img_gray.resize((printer_width, new_height), Image.LANCZOS)
_show(img_resized, title="Resized")
img_resized.save(OUT_DIR / "02_resized.png")


# %%
# Paste onto a white canvas (ensures exact width) and convert to 1-bit
if 'printer_width' not in globals():
    printer_width = 463
if 'img_resized' not in globals():
    if 'img_gray' not in globals():
        if 'image_path' not in globals():
            sample_pngs = sorted(REPO_ROOT.glob("*.png"))
            image_path = sample_pngs[0] if sample_pngs else REPO_ROOT / "sample.png"
        if 'original' not in globals():
            original = Image.open(image_path)
        img_gray = ImageOps.exif_transpose(original).convert("L")
    ratio = printer_width / img_gray.width
    new_height = int(img_gray.height * ratio)
    img_resized = img_gray.resize((printer_width, new_height), Image.LANCZOS)
canvas = Image.new("L", (printer_width, new_height), 255)
canvas.paste(img_resized, (0, 0))
final_img = canvas.convert("1")
_show(final_img, title="Final 1-bit")
final_img.save(OUT_DIR / "03_final_1bit.png")


# %%
# Alternative: use the helper function directly
final_img_direct = to_1bit(image_path.read_bytes(), printer_width)
_show(final_img_direct, title="Final 1-bit (helper)")
final_img_direct.save(OUT_DIR / "04_final_1bit_direct.png")


# %%
print(f"Wrote outputs to: {OUT_DIR}")
