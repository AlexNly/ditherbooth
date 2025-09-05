import math
from typing import Optional
from PIL import Image


def img_to_epl_gw(
    img: Image.Image,
    x: int = 20,
    y: int = 20,
    gap: int = 24,
    label_height: Optional[int] = None,
) -> bytes:
    if img.mode != "1":
        raise ValueError("Image must be 1-bit")
    width, height = img.size
    row_bytes = math.ceil(width / 8)
    pixels = img.load()
    data = bytearray()
    for row in range(height):
        byte = 0
        bit_count = 0
        for col in range(width):
            if pixels[col, row] == 255:
                byte |= 1 << (7 - (bit_count % 8))
            bit_count += 1
            if bit_count % 8 == 0:
                data.append(byte)
                byte = 0
        if bit_count % 8 != 0:
            data.append(byte)
    target_height = label_height or height
    header = f"N\nq{width}\nQ{target_height},{gap}\n".encode()
    command = f"GW{x},{y},{row_bytes},{height},".encode()
    return header + command + bytes(data) + b"\nP1\n"
