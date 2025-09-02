# Ditherbooth

[![tests](https://github.com/AlexNly/ditherbooth/actions/workflows/tests.yml/badge.svg)](https://github.com/AlexNly/ditherbooth/actions/workflows/tests.yml)
[![python](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org/)
[![code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)

Ditherbooth is a small FastAPI service and single-page app for printing photos to a Zebra LP2844 label printer.  Images are uploaded through the web UI, converted to 1‑bit dithered bitmaps with Pillow, encoded as EPL2 or ZPL graphics commands, and spooled to CUPS as raw jobs.

## Prerequisites

* Python 3.9+
* [CUPS](https://www.cups.org/) with a **raw** queue named `zebra2844`
* Zebra LP2844 or LP2844‑Z printer connected via USB
* `DITHERBOOTH_PRINTER` environment variable (optional) to override the CUPS queue name; defaults to `zebra2844`

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

## Image processing script

- `notebooks/image_processing.py` (uses `# %%` cells)

Run end-to-end (auto-picks an image in `notebooks/` if available):

```bash
python notebooks/image_processing.py
```

Examples:

```bash
# Use a specific image in notebooks/
python notebooks/image_processing.py -i notebooks/your_image.png

# Change printer width (dots)
python notebooks/image_processing.py -i notebooks/your_image.png -w 463

# Choose a custom output directory
python notebooks/image_processing.py -i notebooks/your_image.png --out notebooks/out_custom
```

You can also open the script in VS Code/Jupyter and run the `# %%` cells interactively.

## Examples

The images below are produced with the exact pipeline used for printing: the helper `imaging.process.to_1bit` (same code path FastAPI calls before encoding to EPL/ZPL). Width is set to `463` dots (media `continuous58`).

Generate the outputs locally:

```bash
python notebooks/image_processing.py -i notebooks/20250902_0027_PartyinthePark_example.png -w 463
```

Result files are written to `notebooks/out/`.

Original (left) and final 1‑bit (right):

<p>
  <img src="static/examples/original.png" alt="Original example" width="280"/>
  <img src="static/examples/final_1bit_463.png" alt="Processed 1-bit (to_1bit)" width="280"/>
</p>

Optional intermediate views used for illustration (not sent to the printer):

<p>
  <img src="notebooks/out/01_gray.png" alt="Grayscale" width="280"/>
  <img src="notebooks/out/02_resized.png" alt="Resized to printer width" width="280"/>
</p>

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
