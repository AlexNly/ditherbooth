from fastapi.testclient import TestClient
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))
from app import app


def test_index_returns_html():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")


def test_print_endpoint(monkeypatch):
    client = TestClient(app)
    called = []

    def fake_spool_raw(printer_name, payload):
        called.append((printer_name, payload))

    monkeypatch.setattr("app.spool_raw", fake_spool_raw)

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
    assert printer_name == "zebra2844"
    assert isinstance(payload, (bytes, bytearray))
