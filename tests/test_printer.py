from PIL import Image
import pytest
from ditherbooth.printer.epl import img_to_epl_gw
from ditherbooth.printer.zpl import img_to_zpl_gf


def make_black_image():
    return Image.new("1", (8, 8), 0)


def test_img_to_epl_gw_formats_bytes():
    img = make_black_image()
    payload = img_to_epl_gw(img)
    assert payload.startswith(b"N\nq8\nQ8,24\nGW20,20,1,8,")
    assert payload.endswith(b"\nP1\n")
    data = payload.split(b"GW20,20,1,8,")[1].split(b"\nP1\n")[0]
    assert data == b"\xff" * 8


def test_img_to_epl_gw_accepts_gap():
    img = make_black_image()
    payload = img_to_epl_gw(img, gap=0)
    assert payload.startswith(b"N\nq8\nQ8,0\nGW20,20,1,8,")


def test_img_to_zpl_gf_formats_bytes():
    img = make_black_image()
    payload = img_to_zpl_gf(img)
    assert payload.startswith(b"^XA^FO20,20^GFA,8,8,1,")
    assert payload.endswith(b"^FS^XZ")
    data = payload.split(b"^GFA,8,8,1,")[1].split(b"^FS^XZ")[0]
    assert data == b"FFFFFFFFFFFFFFFF"


def test_printer_functions_require_1bit():
    img = Image.new("L", (8, 8), 0)
    with pytest.raises(ValueError):
        img_to_epl_gw(img)
    with pytest.raises(ValueError):
        img_to_zpl_gf(img)
