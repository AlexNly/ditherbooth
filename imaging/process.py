import io
from PIL import Image, ImageOps


def to_1bit(img_bytes: bytes, target_width_dots: int) -> Image.Image:
    with Image.open(io.BytesIO(img_bytes)) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("L")
        ratio = target_width_dots / img.width
        new_height = int(img.height * ratio)
        img = img.resize((target_width_dots, new_height), Image.LANCZOS)
        canvas = Image.new("L", (target_width_dots, new_height), 255)
        canvas.paste(img, (0, 0))
        return canvas.convert("1")
