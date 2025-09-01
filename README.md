# Ditherbooth

Ditherbooth is a small FastAPI service and single-page app for printing photos to a Zebra LP2844 label printer.  Images are uploaded through the web UI, converted to 1‑bit dithered bitmaps with Pillow, encoded as EPL2 or ZPL graphics commands, and spooled to CUPS as raw jobs.

## Prerequisites

* Python 3.9+
* [CUPS](https://www.cups.org/) with a **raw** queue named `zebra2844`
* Zebra LP2844 or LP2844‑Z printer connected via USB

### Create a raw queue
Plug the printer in and register it with CUPS.  Both Raspberry Pi OS and macOS ship with CUPS.

```bash
sudo lpadmin -p zebra2844 -E -v usb://Zebra/LP2844 -m raw
```

You can verify the queue with:

```bash
lpstat -p zebra2844
```

### Smoke‑test the printer
Print a simple "Hello" label to confirm the queue works before using the app:

```bash
python - <<'PY'
from printer.cups import spool_raw
payload = (
    'N\nq400\nQ200,24\nA50,50,0,3,1,1,N,"Hello"\nP1\n'
)
spool_raw('zebra2844', payload)
PY
```

The printer should output a small label containing the word *Hello*.

## Installation

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Development server

Start the API and static frontend:

```bash
make dev
```

Visit [http://localhost:8000](http://localhost:8000) and upload or capture a photo.  Choose media width and printer language and press **Print** to send the job to the printer.

## API test with cURL

You can send an image directly to the `/print` endpoint without the UI:

```bash
curl -F "file=@path/to/image.jpg" \
     -F media=continuous58 \
     -F lang=EPL \
     http://localhost:8000/print
```

A JSON response of `{ "status": "ok" }` indicates the job was submitted.

## Formatting and linting

Format the code with:

```bash
make format
```

## Compiling

Check that the Python sources are syntactically valid:

```bash
python -m py_compile app.py imaging/process.py printer/cups.py printer/epl.py printer/zpl.py
```

## Notes

Camera capture in the browser requires HTTPS on non‑localhost hosts.  When deploying on a LAN, run the service behind a self‑signed certificate or a local CA such as `mkcert`.
