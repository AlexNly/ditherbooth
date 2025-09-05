import io
from PIL import Image, ImageOps


def to_1bit(img_bytes: bytes, target_width_dots: int) -> Image.Image:
    """Convert image bytes into a 1-bit black and white image of a fixed width.

    This helper reads raw image data, applies EXIF orientation, converts the
    image to grayscale, then resizes it to ``target_width_dots`` while preserving
    the original aspect ratio.  The resized image is pasted onto a white canvas
    to guarantee the exact target width before being converted to 1-bit mode.

    Parameters
    ----------
    img_bytes : bytes
        Raw byte content of the source image.  Any format supported by Pillow
        may be used.  Images with EXIF orientation data will be rotated
        accordingly.
    target_width_dots : int
        The desired width of the output image in pixels (or printer dots).

    Returns
    -------
    Image.Image
        A Pillow ``Image`` object in mode ``"1"`` sized to ``target_width_dots``
        pixels wide, with height scaled proportionally.

    Examples
    --------
    >>> with open("photo.png", "rb") as f:
    ...     out = to_1bit(f.read(), 384)
    >>> out.mode
    '1'
    """

    with Image.open(io.BytesIO(img_bytes)) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("L")
        ratio = target_width_dots / img.width
        new_height = int(img.height * ratio)
        img = img.resize((target_width_dots, new_height), Image.LANCZOS)
        canvas = Image.new("L", (target_width_dots, new_height), 255)
        canvas.paste(img, (0, 0))
        return canvas.convert("1")
