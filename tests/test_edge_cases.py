import io
import json
import time
import importlib
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient


def tiny_png_bytes():
    # Minimal non-image bytes for invalid image tests
    return b"not_an_image"


def oversize_bytes(megabytes=11):
    return b"0" * (megabytes * 1024 * 1024)


def test_print_invalid_image_returns_400(monkeypatch):
    import app as app_module

    client = TestClient(app_module.app)

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)

    files = {"file": ("bad.bin", tiny_png_bytes(), "application/octet-stream")}
    data = {"media": "continuous58", "lang": "EPL"}
    res = client.post("/print", files=files, data=data)
    assert res.status_code == 400


def test_print_oversize_returns_413(monkeypatch):
    import app as app_module

    client = TestClient(app_module.app)

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)

    files = {"file": ("big.bin", oversize_bytes(11), "application/octet-stream")}
    data = {"media": "continuous58", "lang": "EPL"}
    res = client.post("/print", files=files, data=data)
    assert res.status_code == 413


def test_preview_invalid_image_returns_400(monkeypatch):
    import app as app_module

    client = TestClient(app_module.app)

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)

    files = {"file": ("bad.bin", tiny_png_bytes(), "application/octet-stream")}
    data = {"media": "continuous58"}
    res = client.post("/preview", files=files, data=data)
    assert res.status_code == 400


def test_preview_oversize_returns_413(monkeypatch):
    import app as app_module

    client = TestClient(app_module.app)

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)

    files = {"file": ("big.bin", oversize_bytes(11), "application/octet-stream")}
    data = {"media": "continuous58"}
    res = client.post("/preview", files=files, data=data)
    assert res.status_code == 413


def test_print_spool_error_returns_502(monkeypatch, tmp_path):
    # Isolate config so test_mode is definitely off
    monkeypatch.setenv("DITHERBOOTH_CONFIG_PATH", str(tmp_path / "cfg.json"))
    import app as app_module
    import importlib
    importlib.reload(app_module)
    from PIL import Image

    client = TestClient(app_module.app)

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    def bad_spool(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "lpr")

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(app_module, "spool_raw", bad_spool)

    import io as _io

    img = Image.new("RGB", (463, 10), color="black")
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    files = {"file": ("ok.png", buf.getvalue(), "image/png")}
    data = {"media": "continuous58", "lang": "EPL"}
    res = client.post("/print", files=files, data=data)
    assert res.status_code == 502


def test_print_zpl_path(monkeypatch, tmp_path):
    monkeypatch.setenv("DITHERBOOTH_CONFIG_PATH", str(tmp_path / "cfg.json"))
    import app as app_module
    import importlib
    importlib.reload(app_module)
    from PIL import Image

    client = TestClient(app_module.app)

    calls = []

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    def capture_spool(printer_name, payload):
        calls.append((printer_name, payload))

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(app_module, "spool_raw", capture_spool)

    import io as _io

    img = Image.new("RGB", (640, 5), color="black")
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    files = {"file": ("ok.png", buf.getvalue(), "image/png")}
    data = {"media": "continuous80", "lang": "ZPL"}
    res = client.post("/print", files=files, data=data)
    assert res.status_code == 200
    assert calls, "spool not called"
    _printer, payload = calls[0]
    assert isinstance(payload, (bytes, bytearray))
    assert payload.startswith(b"^XA")


def test_testmode_delay(monkeypatch, tmp_path):
    # Set a short delay and ensure the endpoint honors it
    cfg_path = tmp_path / "cfg.json"
    monkeypatch.setenv("DITHERBOOTH_CONFIG_PATH", str(cfg_path))
    import app as app_module
    importlib.reload(app_module)
    client = TestClient(app_module.app)

    # Set test_mode and small delay via settings
    res = client.put(
        "/api/dev/settings",
        headers={"X-Dev-Password": "dev"},
        json={"test_mode": True, "test_mode_delay_ms": 150},
    )
    assert res.status_code == 200

    from PIL import Image
    import io as _io

    img = Image.new("RGB", (463, 10), color="black")
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    files = {"file": ("ok.png", buf.getvalue(), "image/png")}
    data = {"media": "continuous58", "lang": "EPL"}

    start = time.perf_counter()
    res = client.post("/print", files=files, data=data)
    elapsed = (time.perf_counter() - start) * 1000

    assert res.status_code == 200
    assert res.json().get("mode") == "test"
    assert elapsed >= 120  # allow some variance vs 150ms
