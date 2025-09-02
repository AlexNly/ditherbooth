import io
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def make_img_bytes():
    img = Image.new("RGB", (50, 30), color="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_preview_returns_png(monkeypatch):
    import app as app_module

    client = TestClient(app_module.app)

    # Avoid threads
    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)

    files = {"file": ("x.png", make_img_bytes(), "image/png")}
    data = {"media": "continuous58"}
    res = client.post("/preview", files=files, data=data)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/png")
    assert len(res.content) > 0


def test_public_config_has_continuous80():
    import app as app_module

    client = TestClient(app_module.app)
    res = client.get("/api/public-config")
    assert res.status_code == 200
    data = res.json()
    assert "continuous80" in data.get("media_options", [])
