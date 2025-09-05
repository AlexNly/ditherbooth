from fastapi.testclient import TestClient
import importlib
import pytest

from ditherbooth.app import app


def test_index_returns_html():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")


def test_print_endpoint(tmp_path, monkeypatch):
    # Ensure test_mode is not enabled via any existing config
    monkeypatch.setenv("DITHERBOOTH_CONFIG_PATH", str(tmp_path / "cfg.json"))
    import ditherbooth.app as app_module
    importlib.reload(app_module)
    client = TestClient(app_module.app)
    called = []

    def fake_spool_raw(printer_name, payload):
        called.append((printer_name, payload))
    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(app_module, "spool_raw", fake_spool_raw)

    from PIL import Image
    import io

    img = Image.new("RGB", (463, 10), color="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    files = {"file": ("test.png", buf.getvalue(), "image/png")}
    data = {"media": "continuous58", "lang": "EPL"}
    response = client.post("/print", files=files, data=data)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert called, "spool_raw was not called"
    printer_name, payload = called[0]
    assert printer_name == "Zebra_LP2844"
    assert isinstance(payload, (bytes, bytearray))
    assert payload.startswith(b"N\nD8\nS2\nq463\nQ16,0\nGW20,0,58,10,")


@pytest.mark.parametrize(
    "media,width,height",
    [
        ("label100x150", 800, 1200),
        ("label55x30", 440, 240),
    ],
)
def test_print_endpoint_label_media(tmp_path, monkeypatch, media, width, height):
    # Ensure test_mode is not enabled via any existing config
    monkeypatch.setenv("DITHERBOOTH_CONFIG_PATH", str(tmp_path / "cfg.json"))
    import ditherbooth.app as app_module
    importlib.reload(app_module)
    client = TestClient(app_module.app)
    called = []

    def fake_spool_raw(printer_name, payload):
        called.append((printer_name, payload))

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(app_module, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(app_module, "spool_raw", fake_spool_raw)

    from PIL import Image
    import io

    img = Image.new("RGB", (width, 10), color="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    files = {"file": ("test.png", buf.getvalue(), "image/png")}
    data = {"media": media, "lang": "EPL"}
    response = client.post("/print", files=files, data=data)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert called, "spool_raw was not called"
    _, payload = called[0]
    row_bytes = width // 8
    expected = f"N\nD8\nS2\nq{width}\nQ{height}\nGW20,0,{row_bytes},10,".encode()
    assert payload.startswith(expected)


def test_printer_name_from_env(monkeypatch):
    monkeypatch.setenv("DITHERBOOTH_PRINTER", "myprinter")
    import ditherbooth.app as app_module
    importlib.reload(app_module)
    assert app_module.PRINTER_NAME == "myprinter"
