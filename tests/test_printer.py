from unittest.mock import patch, mock_open, MagicMock

from PIL import Image
import pytest
from ditherbooth.printer.cups import spool_raw
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
    assert data == b"\x00" * 8


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
    assert data == b"0000000000000000"


def test_printer_functions_require_1bit():
    img = Image.new("L", (8, 8), 0)
    with pytest.raises(ValueError):
        img_to_epl_gw(img)
    with pytest.raises(ValueError):
        img_to_zpl_gf(img)


def test_spool_raw_dev_path():
    m = mock_open()
    with patch("builtins.open", m):
        spool_raw("/dev/usb/lp0", b"hello printer")
    m.assert_called_once_with("/dev/usb/lp0", "wb")
    m().write.assert_called_once_with(b"hello printer")


def test_spool_raw_dev_path_with_str_payload():
    m = mock_open()
    with patch("builtins.open", m):
        spool_raw("/dev/usb/lp0", "string payload")
    m().write.assert_called_once_with(b"string payload")


def test_spool_raw_lpr_path(tmp_path, monkeypatch):
    with patch("subprocess.run") as mock_run:
        spool_raw("TestPrinter", b"test data")
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert args[0] == "lpr"
        assert args[1] == "-P"
        assert args[2] == "TestPrinter"
