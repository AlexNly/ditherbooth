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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
from PIL import UnidentifiedImageError

from ditherbooth.imaging.process import to_1bit
from ditherbooth.printer.cups import spool_raw
from ditherbooth.printer.epl import img_to_epl_gw
from ditherbooth.printer.zpl import img_to_zpl_gf


class Media(str, Enum):
    continuous58 = "continuous58"
    continuous80 = "continuous80"
    label100x150 = "label100x150"


class Lang(str, Enum):
    EPL = "EPL"
    ZPL = "ZPL"


MEDIA_WIDTHS = {
    Media.continuous58: 463,
    Media.continuous80: 640,
    Media.label100x150: 799,
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
        width = MEDIA_WIDTHS[media_val]
        # Conversion to 1-bit is CPU-intensive, so run it in a thread pool to
        # avoid blocking the event loop.
        img = await run_in_threadpool(to_1bit, img_bytes, width)
        if lang_val == Lang.EPL:
            payload = img_to_epl_gw(img)
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
    "default_media": Media.continuous80.value,
    "default_lang": Lang.EPL.value,
    "lock_controls": False,
    "test_mode_delay_ms": 0,
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
        "media_options": [m.value for m in Media],
        "lang_options": [l.value for l in Lang],
    }


@app.get("/api/dev/settings")
async def get_dev_settings(request: Request) -> JSONResponse:
    check_dev_password(request)
    cfg = load_config()
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
        width = MEDIA_WIDTHS[media_val]
        img = await run_in_threadpool(to_1bit, img_bytes, width)
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
