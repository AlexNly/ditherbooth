from enum import Enum
from pathlib import Path
import logging
import os
import subprocess

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
from PIL import UnidentifiedImageError

from imaging.process import to_1bit
from printer.cups import spool_raw
from printer.epl import img_to_epl_gw
from printer.zpl import img_to_zpl_gf


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

PRINTER_NAME = os.getenv("DITHERBOOTH_PRINTER", "zebra2844")

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
    media: Media = Form(...),
    lang: Lang = Form(...),
) -> dict:
    try:
        img_bytes = await file.read()
        width = MEDIA_WIDTHS[media]
        # Conversion to 1-bit is CPU-intensive, so run it in a thread pool to
        # avoid blocking the event loop.
        img = await run_in_threadpool(to_1bit, img_bytes, width)
        if lang == Lang.EPL:
            payload = img_to_epl_gw(img)
        else:
            payload = img_to_zpl_gf(img)
        await run_in_threadpool(spool_raw, PRINTER_NAME, payload)
        return {"status": "ok"}
    except UnidentifiedImageError as exc:
        logger.exception("Failed to process image")
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    except subprocess.CalledProcessError as exc:
        logger.exception("Printing command failed")
        raise HTTPException(status_code=502, detail="Printer error") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected server error")
        raise HTTPException(status_code=500, detail="Internal server error") from exc
