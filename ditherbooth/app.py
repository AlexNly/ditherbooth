from enum import Enum
from pathlib import Path
import io
import json
import logging
import os
import subprocess
import tempfile
from typing import Optional
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError

from ditherbooth.imaging.process import to_1bit
from ditherbooth.printer.cups import spool_raw
from ditherbooth.printer.epl import img_to_epl_gw
from ditherbooth.printer.zpl import img_to_zpl_gf


class Media(str, Enum):
    continuous58 = "continuous58"
    continuous80 = "continuous80"
    label100x150 = "label100x150"
    label55x30 = "label55x30"
    label50x30 = "label50x30"


class Lang(str, Enum):
    EPL = "EPL"
    ZPL = "ZPL"


MEDIA_DIMENSIONS = {
    Media.continuous58: (463, None),
    Media.continuous80: (640, None),
    # LP2844 at 203dpi: 100mm≈800 dots, 150mm≈1200 dots
    Media.label100x150: (800, 1200),
    Media.label55x30: (440, 240),
    # 50x30 mm at 203dpi
    Media.label50x30: (400, 240),
}

# Default to the typical CUPS queue name for Zebra LP2844 printers,
# while still allowing overrides via the DITHERBOOTH_PRINTER environment
# variable or the config file.
PRINTER_NAME = os.getenv("DITHERBOOTH_PRINTER", "Zebra_LP2844")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.post("/print")
async def print_image(
    file: UploadFile = File(...),
    media: Optional[Media] = Form(None),
    lang: Optional[Lang] = Form(None),
) -> dict:
    try:
        cfg = load_config()
        # Fallback to configured defaults if not provided.
        media_val = media or Media(cfg.get("default_media", Media.continuous58.value))
        lang_val = lang or Lang(cfg.get("default_lang", Lang.EPL.value))

        img_bytes = await file.read()
        # Simple upload size guard (10 MB)
        if len(img_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large")
        width, fixed_height = MEDIA_DIMENSIONS[media_val]
        # Conversion to 1-bit is CPU-intensive, so run it in a thread pool to
        # avoid blocking the event loop.
        # Resize to fit width and, if present, max label height (contain).
        img = await run_in_threadpool(to_1bit, img_bytes, width, fixed_height)
        if lang_val == Lang.EPL:
            cfg_dark = cfg.get("epl_darkness")
            cfg_speed = cfg.get("epl_speed")
            if media_val in (Media.continuous58, Media.continuous80):
                # Trim trailing white rows for continuous media to avoid
                # unnecessary feed after content. Leave a tiny post-print
                # spacing by setting a small form length (Q=16 ≈ 2 mm).
                img = await run_in_threadpool(trim_bottom_white, img)
                payload = img_to_epl_gw(
                    img,
                    y=0,
                    gap=0,
                    label_height=16,
                    darkness=cfg_dark if cfg_dark is not None else None,
                    speed=cfg_speed if cfg_speed is not None else None,
                )
            else:
                # For fixed-size labels, start at y=0 and let the printer use
                # calibrated gap; reduce darkness and speed to avoid thermal cutoffs.
                payload = img_to_epl_gw(
                    img,
                    y=0,
                    label_height=fixed_height,
                    gap=None,
                    darkness=cfg_dark if cfg_dark is not None else None,
                    speed=cfg_speed if cfg_speed is not None else None,
                )
        else:
            payload = img_to_zpl_gf(img)

        if bool(cfg.get("test_mode", False)):
            # In test mode, delay to simulate print time and skip spooling.
            delay_ms = int(cfg.get("test_mode_delay_ms", 0) or 0)
            if delay_ms > 0:
                await asyncio.sleep(delay_ms / 1000)
            return {
                "status": "ok",
                "mode": "test",
                "bytes": len(payload) if isinstance(payload, (bytes, bytearray)) else len(payload.encode("utf-8")),
                "media": media_val.value,
                "lang": lang_val.value,
            }

        printer_name = cfg.get("printer_name") or PRINTER_NAME
        await run_in_threadpool(spool_raw, printer_name, payload)
        return {"status": "ok"}
    except HTTPException as exc:
        # Propagate intended HTTP errors (e.g., 413 size limit)
        raise exc
    except UnidentifiedImageError as exc:
        logger.exception("Failed to process image")
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    except subprocess.CalledProcessError as exc:
        logger.exception("Printing command failed")
        raise HTTPException(status_code=502, detail="Printer error") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected server error")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


# ---- Dev settings and configuration helpers ----

def get_config_path() -> Path:
    # Allow tests or deployments to override the config file path.
    env_path = os.getenv("DITHERBOOTH_CONFIG_PATH")
    if env_path:
        return Path(env_path)
    # Default to user config directory to avoid repo-local side effects
    xdg = os.getenv("XDG_CONFIG_HOME")
    if xdg:
        base = Path(xdg)
    else:
        base = Path.home() / ".config"
    return base / "ditherbooth" / "config.json"


DEFAULT_CONFIG = {
    "test_mode": False,
    "design_mode": False,
    "default_media": Media.continuous80.value,
    "default_lang": Lang.EPL.value,
    "lock_controls": False,
    "test_mode_delay_ms": 0,
    # EPL-specific tuning (optional). If None, omit commands.
    "epl_darkness": 8,
    "epl_speed": 2,
    # Optional: override printer queue name; falls back to PRINTER_NAME env.
    # "printer_name": "Zebra_LP2844",
}


def load_config() -> dict:
    path = get_config_path()
    if not path.exists():
        return DEFAULT_CONFIG.copy()
    try:
        data = json.loads(path.read_text())
        # Merge with defaults to ensure new keys are present
        merged = DEFAULT_CONFIG.copy()
        merged.update(data)
        return merged
    except Exception:  # noqa: BLE001
        logger.exception("Failed to read config; using defaults")
        return DEFAULT_CONFIG.copy()


def write_config(cfg: dict) -> None:
    path = get_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="ditherbooth_config.", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(tmp_fd, "w") as f:
            json.dump(cfg, f, indent=2, default=str)
        os.replace(tmp_path, path)
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:  # noqa: BLE001
            pass


def trim_bottom_white(img: Image.Image, margin: int = 6, min_density_ratio: float = 0.01) -> Image.Image:
    """Trim trailing white rows from a 1-bit image for continuous media.

    Scans from the bottom up to find the last row containing any black pixel
    (value 0). Returns a crop from the top to that row plus a small margin.
    Ensures a minimum height of 1 row.
    """
    if img.mode != "1":
        return img
    width, height = img.size
    pixels = img.load()
    last_content = -1
    # Consider a row "content" only if it has a modest number of black pixels
    # to avoid sparse dither specks keeping long blank tails.
    min_black = max(3, int(width * min_density_ratio))
    for row in range(height - 1, -1, -1):
        black_count = 0
        # Count black pixels but stop early if threshold reached
        for col in range(width):
            if pixels[col, row] == 0:
                black_count += 1
                if black_count >= min_black:
                    break
        if black_count >= min_black:
            last_content = row
            break
    if last_content == -1:
        # No black pixels; keep a tiny height to avoid zero-length form
        return img.crop((0, 0, width, 1))
    new_h = min(height, max(1, last_content + 1 + margin))
    if new_h >= height:
        return img
    return img.crop((0, 0, width, new_h))


def check_dev_password(request: Request) -> None:
    supplied = request.headers.get("X-Dev-Password")
    expected = os.getenv("DITHERBOOTH_DEV_PASSWORD", "dev")
    if supplied is None:
        raise HTTPException(status_code=401, detail="Missing X-Dev-Password")
    if supplied != expected:
        raise HTTPException(status_code=403, detail="Invalid password")


@app.get("/api/public-config")
async def public_config() -> dict:
    cfg = load_config()
    return {
        "default_media": str(cfg.get("default_media", Media.continuous58.value)),
        "default_lang": str(cfg.get("default_lang", Lang.EPL.value)),
        "lock_controls": bool(cfg.get("lock_controls", False)),
        "design_mode": bool(cfg.get("design_mode", False)),
        "media_options": [m.value for m in Media],
        "lang_options": [l.value for l in Lang],
        "epl_darkness": cfg.get("epl_darkness"),
        "epl_speed": cfg.get("epl_speed"),
        "media_dimensions": {m.value: {"width": w, "height": h} for m, (w, h) in MEDIA_DIMENSIONS.items()},
    }


@app.get("/api/dev/settings")
async def get_dev_settings(request: Request) -> JSONResponse:
    check_dev_password(request)
    cfg = load_config()
    cfg.setdefault("design_mode", False)
    # Include available options to aid the UI
    body = {
        "config": cfg,
        "media_options": [m.value for m in Media],
        "lang_options": [l.value for l in Lang],
    }
    return JSONResponse(body)


@app.put("/api/dev/settings")
async def put_dev_settings(request: Request) -> JSONResponse:
    check_dev_password(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    cfg = load_config()

    def coerce_media(val):
        if val is None:
            return None
        try:
            return Media(val).value
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="Invalid default_media") from exc

    def coerce_lang(val):
        if val is None:
            return None
        try:
            return Lang(val).value
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="Invalid default_lang") from exc

    if "test_mode" in payload:
        cfg["test_mode"] = bool(payload["test_mode"])
    if "default_media" in payload:
        m = coerce_media(payload["default_media"])
        if m is not None:
            cfg["default_media"] = m
    if "default_lang" in payload:
        l = coerce_lang(payload["default_lang"])
        if l is not None:
            cfg["default_lang"] = l
    if "lock_controls" in payload:
        cfg["lock_controls"] = bool(payload["lock_controls"])
    if "design_mode" in payload:
        cfg["design_mode"] = bool(payload["design_mode"])
    if "printer_name" in payload:
        # Allow empty/None to clear override
        v = payload["printer_name"]
        if v is None or v == "":
            cfg.pop("printer_name", None)
        elif not isinstance(v, str):
            raise HTTPException(status_code=400, detail="printer_name must be string")
        else:
            cfg["printer_name"] = v
    if "test_mode_delay_ms" in payload:
        try:
            val = int(payload["test_mode_delay_ms"]) if payload["test_mode_delay_ms"] is not None else 0
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="test_mode_delay_ms must be an integer") from exc
        if val < 0:
            raise HTTPException(status_code=400, detail="test_mode_delay_ms must be >= 0")
        cfg["test_mode_delay_ms"] = val

    if "epl_darkness" in payload:
        val = payload["epl_darkness"]
        if val is None or val == "":
            cfg["epl_darkness"] = None
        else:
            try:
                d = int(val)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status_code=400, detail="epl_darkness must be an integer or null") from exc
            if not (0 <= d <= 15):
                raise HTTPException(status_code=400, detail="epl_darkness must be between 0 and 15")
            cfg["epl_darkness"] = d

    if "epl_speed" in payload:
        val = payload["epl_speed"]
        if val is None or val == "":
            cfg["epl_speed"] = None
        else:
            try:
                s = int(val)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status_code=400, detail="epl_speed must be an integer or null") from exc
            if not (1 <= s <= 6):
                raise HTTPException(status_code=400, detail="epl_speed must be between 1 and 6")
            cfg["epl_speed"] = s

    write_config(cfg)
    return JSONResponse({"status": "saved", "config": cfg})


@app.post("/preview")
async def preview_image(
    file: UploadFile = File(...),
    media: Optional[Media] = Form(None),
) -> Response:
    """Return a processed 1-bit PNG preview for the given image and media width.

    Language does not affect dithering, so it's not needed here.
    """
    try:
        cfg = load_config()
        media_val = media or Media(cfg.get("default_media", Media.continuous58.value))
        img_bytes = await file.read()
        if len(img_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large")
        width, max_h = MEDIA_DIMENSIONS[media_val]
        img = await run_in_threadpool(to_1bit, img_bytes, width, max_h)
        # Ensure mode 1-bit, convert to PNG bytes
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        return Response(content=data, media_type="image/png")
    except HTTPException as exc:
        raise exc
    except UnidentifiedImageError as exc:
        logger.exception("Failed to process image for preview")
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected server error in preview")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


# ---- Template CRUD ----

def get_templates_dir() -> Path:
    return get_config_path().parent / "templates"


@app.get("/api/templates")
async def list_templates() -> list:
    tpl_dir = get_templates_dir()
    if not tpl_dir.exists():
        return []
    templates = []
    for f in sorted(tpl_dir.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            templates.append({"id": data["id"], "name": data["name"], "created_at": data.get("created_at")})
        except Exception:  # noqa: BLE001
            continue
    return templates


@app.post("/api/templates")
async def create_template(request: Request) -> dict:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    name = payload.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    canvas_json = payload.get("canvas_json")
    if canvas_json is None:
        raise HTTPException(status_code=400, detail="canvas_json is required")

    tpl_id = str(uuid.uuid4())
    tpl = {
        "id": tpl_id,
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "canvas_json": canvas_json,
    }
    tpl_dir = get_templates_dir()
    tpl_dir.mkdir(parents=True, exist_ok=True)
    (tpl_dir / f"{tpl_id}.json").write_text(json.dumps(tpl, indent=2))
    return tpl


@app.get("/api/templates/{template_id}")
async def get_template(template_id: str) -> dict:
    tpl_dir = get_templates_dir()
    path = tpl_dir / f"{template_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Template not found")
    return json.loads(path.read_text())


@app.delete("/api/templates/{template_id}")
async def delete_template(template_id: str) -> dict:
    tpl_dir = get_templates_dir()
    path = tpl_dir / f"{template_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Template not found")
    path.unlink()
    return {"status": "deleted"}
