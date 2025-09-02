import logging
import subprocess
from enum import Enum
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
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

PRINTER_NAME = "zebra2844"

app = FastAPI()
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")

logger = logging.getLogger(__name__)


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
        img = to_1bit(img_bytes, width)
        if lang == Lang.EPL:
            payload = img_to_epl_gw(img)
        else:
            payload = img_to_zpl_gf(img)
        spool_raw(PRINTER_NAME, payload)
    except UnidentifiedImageError:
        logger.exception("Failed to process uploaded image")
        raise HTTPException(status_code=400, detail="Invalid image file")
    except subprocess.CalledProcessError:
        logger.exception("Printing failed")
        raise HTTPException(status_code=500, detail="Failed to spool print job")
    except Exception:
        logger.exception("Unexpected error during printing")
        raise HTTPException(status_code=500, detail="Internal server error")
    return {"status": "ok"}
