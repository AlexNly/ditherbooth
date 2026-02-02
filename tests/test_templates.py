import importlib
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DITHERBOOTH_CONFIG_PATH", str(tmp_path / "cfg.json"))
    import ditherbooth.app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


def test_list_templates_empty(client):
    res = client.get("/api/templates")
    assert res.status_code == 200
    assert res.json() == []


def test_create_template(client):
    payload = {"name": "My Label", "canvas_json": {"objects": [], "version": "5.3.1"}}
    res = client.post("/api/templates", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "My Label"
    assert "id" in data
    assert "created_at" in data
    assert data["canvas_json"] == payload["canvas_json"]


def test_create_template_missing_name(client):
    res = client.post("/api/templates", json={"canvas_json": {}})
    assert res.status_code == 400


def test_create_template_missing_canvas(client):
    res = client.post("/api/templates", json={"name": "Test"})
    assert res.status_code == 400


def test_list_templates_after_create(client):
    client.post("/api/templates", json={"name": "T1", "canvas_json": {}})
    client.post("/api/templates", json={"name": "T2", "canvas_json": {}})
    res = client.get("/api/templates")
    assert res.status_code == 200
    templates = res.json()
    assert len(templates) == 2
    names = {t["name"] for t in templates}
    assert names == {"T1", "T2"}


def test_delete_template(client):
    res = client.post("/api/templates", json={"name": "Del", "canvas_json": {}})
    tpl_id = res.json()["id"]

    res = client.delete(f"/api/templates/{tpl_id}")
    assert res.status_code == 200
    assert res.json() == {"status": "deleted"}

    # Verify it's gone
    res = client.get("/api/templates")
    assert res.json() == []


def test_delete_template_not_found(client):
    res = client.delete("/api/templates/nonexistent-id")
    assert res.status_code == 404


def test_get_template_by_id(client):
    payload = {"name": "Fetch Me", "canvas_json": {"objects": [1, 2]}}
    res = client.post("/api/templates", json=payload)
    tpl_id = res.json()["id"]

    res = client.get(f"/api/templates/{tpl_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Fetch Me"
    assert data["canvas_json"] == {"objects": [1, 2]}


def test_get_template_not_found(client):
    res = client.get("/api/templates/nonexistent-id")
    assert res.status_code == 404


def test_public_config_has_media_dimensions(client):
    res = client.get("/api/public-config")
    assert res.status_code == 200
    data = res.json()
    assert "media_dimensions" in data
    dims = data["media_dimensions"]
    assert "continuous80" in dims
    assert dims["continuous80"]["width"] == 640
    assert "label100x150" in dims
    assert dims["label100x150"]["width"] == 800
    assert dims["label100x150"]["height"] == 1200
