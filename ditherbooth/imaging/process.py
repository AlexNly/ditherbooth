import io
from PIL import Image, ImageOps


def to_1bit(
    img_bytes: bytes,
    target_width_dots: int,
    max_height_dots: int | None = None,
    center_x: bool = True,
) -> Image.Image:
    """Convert to 1-bit B/W sized to the printer width and optional max height.

    Reads the image, applies EXIF orientation, converts to grayscale, then
    rescales to fit within ``target_width_dots`` and (if provided)
    ``max_height_dots`` while preserving aspect ratio. The result is pasted on
    a white canvas of width ``target_width_dots`` and height equal to the
    resized image's height (no bottom padding), then converted to 1-bit using
    Pillow's default Floyd–Steinberg dithering.
    """

    with Image.open(io.BytesIO(img_bytes)) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("L")
        # Compute scale to fit width and optional height
        sx = target_width_dots / img.width
        if max_height_dots:
            sy = max_height_dots / img.height
            scale = min(sx, sy)
        else:
            scale = sx
        new_w = max(1, int(round(img.width * scale)))
        new_h = max(1, int(round(img.height * scale)))
        img = img.resize((new_w, new_h), Image.LANCZOS)
        # Paste onto a canvas of the target width; top-aligned vertically
        canvas = Image.new("L", (target_width_dots, new_h), 255)
        x_off = ((target_width_dots - new_w) // 2) if center_x else 0
        canvas.paste(img, (x_off, 0))
        return canvas.convert("1")
