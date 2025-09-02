from enum import Enum
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool

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


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.post("/print")
async def print_image(
    file: UploadFile = File(...),
    media: Media = Form(...),
    lang: Lang = Form(...),
) -> dict:
    img_bytes = await file.read()
    width = MEDIA_WIDTHS[media]
    img = to_1bit(img_bytes, width)
    if lang == Lang.EPL:
        payload = img_to_epl_gw(img)
    else:
        payload = img_to_zpl_gf(img)
    await run_in_threadpool(spool_raw, PRINTER_NAME, payload)
    return {"status": "ok"}
