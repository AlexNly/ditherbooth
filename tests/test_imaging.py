from imaging.process import to_1bit
from PIL import Image
import io


def test_to_1bit_converts_and_resizes():
    img = Image.new("RGB", (10, 5), "black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    result = to_1bit(buf.getvalue(), 20)
    assert result.mode == "1"
    assert result.size == (20, 10)
    pixels = result.load()
    assert pixels[0, 0] == 0
    assert pixels[19, 9] == 0
