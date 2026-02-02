# Ditherbooth

[![tests](https://github.com/AlexNly/ditherbooth/actions/workflows/tests.yml/badge.svg)](https://github.com/AlexNly/ditherbooth/actions/workflows/tests.yml)
[![codecov](https://codecov.io/gh/AlexNly/ditherbooth/graph/badge.svg?token=LJ6M51Y55D)](https://codecov.io/gh/AlexNly/ditherbooth)
[![python](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org/)
[![code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

Turn photos into crisp 1‑bit dithered prints on a Zebra label printer.

<p align="center">
  <img src="static/examples/original.png" alt="Original example" width="280"/>
  <img src="static/examples/final_1bit_463.png" alt="Processed 1-bit" width="280"/>
</p>

Original (left) and final 1‑bit dithered image (right). See [Image processing script](#image-processing-script) to reproduce the example locally.

Ditherbooth is a small FastAPI service and single-page app that turns uploaded photos into 1‑bit dithered bitmaps and prints them on a Zebra LP2844 label printer.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Troubleshooting](#troubleshooting)
- [Developer Settings and Test Mode](#developer-settings-and-test-mode)
- [API Test with cURL](#api-test-with-curl)
- [Media Presets](#media-presets)
- [Image Processing Script](#image-processing-script)
- [Formatting and Linting](#formatting-and-linting)
- [Testing](#testing)
- [Compiling](#compiling)
- [Notes](#notes)
- [Code Coverage](#code-coverage)
- [Contributing](#contributing)
- [License](#license)

## Features

* Upload or capture images via the web UI
* Convert photos to 1‑bit dithered bitmaps using Pillow
* Encode to EPL2 or ZPL and send raw jobs to CUPS
* Configure media widths and printer language
* Optional test mode to skip actual printing

## Quick Start

### Prerequisites

* Python 3.9+
* [CUPS](https://www.cups.org/) with a printer queue named `Zebra_LP2844`
* Zebra LP2844 or LP2844‑Z printer connected via USB
* `DITHERBOOTH_PRINTER` environment variable (optional) to override the CUPS queue name; defaults to `Zebra_LP2844`

#### Create a printer queue

**macOS:**

macOS no longer supports raw CUPS queues. Use the EPL2 driver instead:

```bash
# Find your printer's USB device (note the serial number)
lpinfo -v | grep -i zebra

# Create printer with EPL2 driver (update serial number to match yours)
sudo lpadmin -p Zebra_LP2844 -E \
  -v "usb://Zebra/LP2844?serial=YOUR_SERIAL_NUMBER" \
  -m drv:///sample.drv/zebraep2.ppd

# Enable and accept jobs
cupsenable Zebra_LP2844
cupsaccept Zebra_LP2844
```

**Linux:**

```bash
sudo lpadmin -p Zebra_LP2844 -E -v usb://Zebra/LP2844 -m raw
```

Verify the queue:

```bash
lpstat -p Zebra_LP2844
```

#### Smoke-test the printer

Print a simple label to confirm the queue works:

```bash
echo -e "N\nq400\nQ200,24\nA50,50,0,3,1,1,N,\"Hello\"\nP1" | lpr -P Zebra_LP2844
```

If successful, the printer should print a small label with "Hello" text.

### Installation

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# For development and testing
pip install -r requirements-dev.txt
```

### Run the development server

```bash
make dev
```

Visit [http://localhost:8000](http://localhost:8000) and upload or capture a photo. Choose media width and printer language and press **Print** to send the job to the printer.

#### Access on your network

Run the dev server bound to your LAN IP:

```bash
make dev HOST=0.0.0.0 PORT=8000
```

Find your IP:

* macOS: `ipconfig getifaddr en0`
* Linux: `hostname -I`

Open `http://<your-ip>:8000` on your phone. Use the gear icon (Dev Settings) to enable Test Mode so no printer is required.

## Troubleshooting

### Printer shows as paused or disabled

If the printer appears paused in System Settings or `lpstat` shows it as disabled:

```bash
cupsenable Zebra_LP2844    # Enable the printer
cupsaccept Zebra_LP2844    # Accept jobs
lpstat -p Zebra_LP2844     # Verify status
```

### Print jobs are stuck in queue

```bash
cancel -a Zebra_LP2844     # Cancel all pending jobs
lpstat -o                  # Check queue is empty
```

### "Unable to send data to printer" error

This usually means the printer lost communication. Try:

1. Check USB cable is connected
2. Verify printer is powered on and shows a green ready light
3. Check the printer appears in USB devices:
   ```bash
   lpinfo -v | grep -i zebra
   ```
4. If the device URI is wrong or shows `/dev/null`, reconfigure:
   ```bash
   # Find the correct USB device
   lpinfo -v | grep -i zebra

   # Update the printer (use your serial number)
   sudo lpadmin -p Zebra_LP2844 -v "usb://Zebra/LP2844?serial=YOUR_SERIAL"

   # Re-enable
   cupsenable Zebra_LP2844
   cupsaccept Zebra_LP2844
   ```

### Web interface returns "Printer error" (502)

The app returns HTTP 502 when CUPS cannot communicate with the printer. Check:

1. Printer status: `lpstat -p Zebra_LP2844`
2. Recent CUPS errors: `tail -20 /var/log/cups/error_log`
3. Follow steps above to enable printer and clear stuck jobs

### Development without a printer

Use test mode to develop without a physical printer:

```bash
curl -X PUT -H "X-Dev-Password: dev" -H "Content-Type: application/json" \
  -d '{"test_mode": true}' http://localhost:8000/api/dev/settings
```

Or enable it through the web UI using the gear icon (Dev Settings) with password `dev`.

## Developer settings and test mode

The app exposes a small password-protected settings API to make the frontend configurable without exposing options to end users. These settings are persisted to a JSON file (`ditherbooth_config.json` by default) and are used both by the UI and the print endpoint.

* `DITHERBOOTH_DEV_PASSWORD`: Password required for the settings API (default: `dev` for local/testing). Set this in production.
* `DITHERBOOTH_CONFIG_PATH`: Optional path to the settings JSON file. Useful in tests or deployments.

Endpoints:

* `GET /api/public-config`: Public, returns defaults and whether to lock controls in the UI.
* `GET /api/dev/settings`: Requires header `X-Dev-Password`. Returns full config.
* `PUT /api/dev/settings`: Requires header `X-Dev-Password`. Accepts JSON fields:
  * `test_mode` (bool) — if true, the `/print` endpoint will process the image but skip spooling to the printer and return `{status:"ok", mode:"test"}`.
  * `default_media` (string: one of `continuous58`, `continuous80`, `label100x150`, `label55x30`)
  * `default_lang` (string: `EPL` or `ZPL`)
  * `lock_controls` (bool) — hides media/language selectors in the UI for kiosk usage.
  * `printer_name` (string, optional) — override the printer queue name used by the backend (otherwise falls back to `DITHERBOOTH_PRINTER` env, then `Zebra_LP2844`).

## API test with cURL

Send an image directly to the `/print` endpoint without the UI:

```bash
curl -F "file=@path/to/image.jpg" \
     -F media=continuous58 \
     -F lang=EPL \
     http://localhost:8000/print
```

A JSON response of `{ "status": "ok" }` indicates the job was submitted.

If test mode is enabled via settings, the response will include `{ "status": "ok", "mode": "test", ... }` and no job is sent to the printer.

## Media presets

Available media widths (dots):

* `continuous58` → 463
* `continuous80` → 640 (default)
* `label100x150` → 800
* `label55x30` → 440

You can change the default in the Dev Settings modal, or via the API.

## Image processing script

* `notebooks/image_processing.py` (uses `# %%` cells)

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

Optional intermediate views used for illustration (not sent to the printer):

<p>
  <img src="notebooks/out/01_gray.png" alt="Grayscale" width="280"/>
  <img src="notebooks/out/02_resized.png" alt="Resized to printer width" width="280"/>
</p>

## Formatting and linting

Format the code with:

```bash
pip install -r requirements-dev.txt
make format
```

## Testing

Run the test suite:

```bash
pip install -r requirements-dev.txt
pytest
```

## Compiling

Check that the Python sources are syntactically valid:

```bash
python -m py_compile ditherbooth/app.py ditherbooth/imaging/process.py ditherbooth/printer/cups.py ditherbooth/printer/epl.py ditherbooth/printer/zpl.py
```

## Notes

Camera capture in the browser requires HTTPS on non‑localhost hosts. When deploying on a LAN, run the service behind a self‑signed certificate or a local CA such as `mkcert`.

## Code coverage

This repository publishes test coverage to Codecov via GitHub Actions. The workflow runs `pytest --cov=. --cov-report=xml` and uploads `coverage.xml`.

* Public repo: no token required.
* Private repo: set `CODECOV_TOKEN` in repository secrets if needed.

## Contributing

Pull requests are welcome! Please open an issue for major changes and ensure tests pass before submitting.

```bash
make format
pytest
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
