import io
import importlib
import os
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def make_image_bytes(w=20, h=10):
    img = Image.new("RGB", (w, h), color="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


def setup_app_with_tmp_config(tmp_path, monkeypatch, password="dev"):
    cfg_path = tmp_path / "cfg.json"
    monkeypatch.setenv("DITHERBOOTH_CONFIG_PATH", str(cfg_path))
    monkeypatch.setenv("DITHERBOOTH_DEV_PASSWORD", password)
    import ditherbooth.app as app_module

    importlib.reload(app_module)
    return app_module


def test_public_config_defaults(tmp_path, monkeypatch):
    app_module = setup_app_with_tmp_config(tmp_path, monkeypatch)
    client = TestClient(app_module.app)
    res = client.get("/api/public-config")
    assert res.status_code == 200
    data = res.json()
    assert set(["default_media", "default_lang", "lock_controls", "media_options", "lang_options"]).issubset(data.keys())
    assert data["default_media"] in data["media_options"]
    assert data["default_lang"] in data["lang_options"]


def test_dev_settings_requires_auth(tmp_path, monkeypatch):
    app_module = setup_app_with_tmp_config(tmp_path, monkeypatch, password="pw")
    client = TestClient(app_module.app)
    # Missing header
    res = client.get("/api/dev/settings")
    assert res.status_code == 401
    # Wrong password
    res = client.get("/api/dev/settings", headers={"X-Dev-Password": "nope"})
    assert res.status_code == 403


def test_dev_settings_get_put_and_print_test_mode(tmp_path, monkeypatch):
    app_module = setup_app_with_tmp_config(tmp_path, monkeypatch, password="pw")
    client = TestClient(app_module.app)

    # Connect and ensure we can read settings with correct password
    res = client.get("/api/dev/settings", headers={"X-Dev-Password": "pw"})
    assert res.status_code == 200

    # Enable test mode and change defaults
    payload = {
        "test_mode": True,
        "default_media": "continuous58",
        "default_lang": "EPL",
        "lock_controls": True,
    }
    res = client.put("/api/dev/settings", headers={"X-Dev-Password": "pw"}, json=payload)
    assert res.status_code == 200
    data = res.json()["config"]
    assert data["test_mode"] is True

    # Avoid threads in tests
    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)

    # Ensure spool_raw is not called in test mode
    called = {"count": 0}

    def fake_spool_raw(printer_name, payload):
        called["count"] += 1

    monkeypatch.setattr(app_module, "spool_raw", fake_spool_raw)

    files = {"file": ("img.png", make_image_bytes(), "image/png")}
    # Omit media/lang to test config defaults
    res = client.post("/print", files=files)
    assert res.status_code == 200
    j = res.json()
    assert j.get("mode") == "test"
    assert called["count"] == 0


def test_static_style_served(tmp_path, monkeypatch):
    # Static files don't depend on config; just ensure 200
    app_module = setup_app_with_tmp_config(tmp_path, monkeypatch)
    client = TestClient(app_module.app)
    res = client.get("/static/style.css")
    assert res.status_code == 200
    assert "text/css" in res.headers.get("content-type", "")
