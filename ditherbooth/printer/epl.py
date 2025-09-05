import math
from typing import Optional
from PIL import Image


def img_to_epl_gw(
    img: Image.Image,
    x: int = 20,
    y: int = 20,
    gap: Optional[int] = 24,
    label_height: Optional[int] = None,
    darkness: Optional[int] = None,
    speed: Optional[int] = None,
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
            # Set bit for white pixel; 0-bit prints black on many EPL devices
            if pixels[col, row] == 255:
                byte |= 1 << (7 - (bit_count % 8))
            bit_count += 1
            if bit_count % 8 == 0:
                data.append(byte)
                byte = 0
        if bit_count % 8 != 0:
            data.append(byte)
    target_height = label_height or height
    header_parts = ["N"]
    if darkness is not None:
        header_parts.append(f"D{int(darkness)}")
    if speed is not None:
        header_parts.append(f"S{int(speed)}")
    header_parts.append(f"q{width}")
    if gap is None:
        header_parts.append(f"Q{target_height}")
    else:
        header_parts.append(f"Q{target_height},{gap}")
    header = ("\n".join(header_parts) + "\n").encode()
    command = f"GW{x},{y},{row_bytes},{height},".encode()
    return header + command + bytes(data) + b"\nP1\n"
