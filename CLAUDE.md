# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Setup
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt  # For development
```

### Running the dev server
```bash
make dev                              # Runs on 127.0.0.1:8000
make dev HOST=0.0.0.0 PORT=8008      # Custom host/port
```

The dev server uses uvicorn with auto-reload enabled.

### Testing
```bash
pytest                                # Run all tests
pytest tests/test_app.py             # Run specific test file
pytest tests/test_app.py::test_name  # Run single test
pytest --cov=. --cov-report=xml      # With coverage report
```

### Formatting
```bash
make format                           # Runs black formatter
```

### Image processing script
```bash
python notebooks/image_processing.py                        # Auto-picks image
python notebooks/image_processing.py -i path/to/image.png   # Specific image
python notebooks/image_processing.py -w 463                 # Custom width
```

## Architecture Overview

Ditherbooth is a FastAPI service that converts photos to 1-bit dithered prints for Zebra LP2844 label printers.

### Core modules

**`ditherbooth/app.py`** (main FastAPI application)
- `/print` endpoint: accepts image upload, media type, and printer language
- `/preview` endpoint: returns processed 1-bit PNG without printing
- Dev settings API (`/api/dev/settings`) with password protection
- Public config API (`/api/public-config`) — includes `media_dimensions` for canvas sizing
- Template CRUD API (`/api/templates`) — GET list, POST create, GET by ID, DELETE

**`ditherbooth/imaging/process.py`**
- `to_1bit()`: Core image processing function
  - Reads image bytes, applies EXIF orientation
  - Converts to grayscale
  - Resizes to fit target width and optional max height (preserves aspect ratio)
  - Pastes centered on white canvas
  - Converts to 1-bit using Floyd-Steinberg dithering

**`ditherbooth/printer/epl.py`** and **`ditherbooth/printer/zpl.py`**
- `img_to_epl_gw()`: Converts 1-bit PIL image to EPL2 GW command
- `img_to_zpl_gf()`: Converts 1-bit PIL image to ZPL GF command
- Both encode pixel data as raw bytes (white pixels set bit high)

**`ditherbooth/printer/cups.py`**
- `spool_raw()`: Writes payload to temp file and sends to CUPS via `lpr -o raw`

### Image processing pipeline

1. **Upload** → FastAPI receives image file + media preset + language
2. **Dither** → `to_1bit()` resizes and converts to 1-bit B/W
3. **Trim** (continuous media only) → `trim_bottom_white()` removes trailing blank rows
4. **Encode** → EPL or ZPL encoder converts to printer language bytes
5. **Print** → `spool_raw()` sends to CUPS printer queue

### Media presets and dimensions

Defined in `MEDIA_DIMENSIONS` dict in `app.py`:
- `continuous58`: 463 dots wide, no fixed height
- `continuous80`: 640 dots wide, no fixed height (default)
- `label100x150`: 800×1200 dots (fixed label)
- `label55x30`: 440×240 dots (fixed label)
- `label50x30`: 400×240 dots (fixed label)

**Continuous media behavior:**
- Trailing white rows are trimmed via `trim_bottom_white()` to avoid excessive feed
- Label height is set to a small value (Q=16 ≈ 2mm post-print spacing)
- Gap is set to 0

**Fixed label behavior:**
- Image is resized to fit within fixed width×height (contain mode, no cropping)
- Label height matches media height
- Gap is omitted (printer uses calibrated gap detection)

### Configuration system

**Config file location:**
- `DITHERBOOTH_CONFIG_PATH` env var (if set)
- Otherwise: `$XDG_CONFIG_HOME/ditherbooth/config.json`
- Otherwise: `~/.config/ditherbooth/config.json`

**Config keys:**
- `test_mode` (bool): Skip actual printing, return test response
- `default_media` (str): Default media preset
- `default_lang` (str): "EPL" or "ZPL"
- `lock_controls` (bool): Hide media/lang selectors in UI (kiosk mode)
- `printer_name` (str): Override CUPS queue name
- `test_mode_delay_ms` (int): Simulate print delay in test mode
- `epl_darkness` (int, 0-15): EPL darkness setting (D command)
- `epl_speed` (int, 1-6): EPL speed setting (S command)

**Dev settings API:**
- Password required via `X-Dev-Password` header
- Password from `DITHERBOOTH_DEV_PASSWORD` env (default: "dev")

### Environment variables

- `DITHERBOOTH_PRINTER`: CUPS queue name (default: "Zebra_LP2844")
- `DITHERBOOTH_DEV_PASSWORD`: Password for settings API (default: "dev")
- `DITHERBOOTH_CONFIG_PATH`: Custom config file location

### Printer setup

**macOS:**

macOS no longer supports raw CUPS queues. Instead, use the EPL2 driver:

```bash
# Find the USB device
lpinfo -v | grep -i zebra

# Create printer with EPL2 driver (update serial number to match your printer)
sudo lpadmin -p Zebra_LP2844 -E \
  -v "usb://Zebra/LP2844?serial=42J103400046" \
  -m drv:///sample.drv/zebraep2.ppd

# Enable and accept jobs
cupsenable Zebra_LP2844
cupsaccept Zebra_LP2844
```

**Linux:**

Create a raw CUPS queue:
```bash
sudo lpadmin -p Zebra_LP2844 -E -v usb://Zebra/LP2844 -m raw
```

**Test printing:**
```bash
echo -e "N\nq400\nQ200,24\nA50,50,0,3,1,1,N,\"Hello\"\nP1" | lpr -P Zebra_LP2844
```

**Troubleshooting:**

If printer shows as paused or disabled:
```bash
cupsenable Zebra_LP2844    # Enable the printer
cupsaccept Zebra_LP2844    # Accept jobs
lpstat -p Zebra_LP2844     # Check status
```

If jobs are stuck:
```bash
cancel -a Zebra_LP2844     # Cancel all jobs
```

### Designer v2 (Fabric.js label editor)

**`ditherbooth/static/designer-v2.js`** — Fabric.js-based label designer
- Loaded as a tab alongside the photo flow in `index.html`
- Canvas sized to media dimensions from `/api/public-config`
- CSS transform scaling to fit viewport
- Text tool: adds `fabric.IText` objects, font size control, inline editing
- Preview: exports canvas to PNG, POSTs to `/preview` for 1-bit dithered preview
- Print: exports canvas to PNG, POSTs to `/print`
- Templates: save/load/delete via `/api/templates` endpoints
- Multi-label queue: add labels to queue, reorder via drag-and-drop, print all sequentially

**Template storage:**
- Templates stored as JSON files in `{config_dir}/templates/` directory
- Each template: `{ id, name, created_at, canvas_json }` (Fabric.js JSON serialization)
- Template ID = UUID, filename = `{id}.json`

**Multi-label queue (frontend-only):**
- Queue is an in-memory array of `{ id, name, thumbnailDataURL, canvasJSON }` items
- "Add to Queue" captures current canvas state + generates thumbnail via off-screen Fabric.js canvas
- Horizontal scrollable thumbnail strip below the designer canvas
- Drag-to-reorder using HTML5 drag and drop
- Click thumbnail to load canvasJSON back onto main canvas for editing
- "Print Queue" iterates items sequentially, POSTing each to `/print` with progress indicator
- Stops on first error and reports which label failed

**Frontend tab system:**
- Tab bar in `index.html`: Photo | Designer
- Tab switching via JS show/hide in `app.js` (no page reload)
- `app.js` exposes `window.getPublicConfig()` for `designer-v2.js` to access config
- `window.initDesignerV2()` called after DOMContentLoaded + config loaded
- `window.onDesignerTabVisible()` called when designer tab becomes visible (for canvas resize)

**Image elements:**
- "Add Image" button triggers hidden file input, reads file as dataURL, creates `fabric.Image`
- Image auto-scaled to fit within 80% of canvas bounds, centered
- Images are regular Fabric.js objects — movable, scalable, deletable via Delete button

**Smart snapping (PowerPoint-style guidelines):**
- On `object:moving`, collects snap targets from canvas edges, canvas center, and other objects' edges/centers
- Snaps within 8px threshold, draws dashed blue guide lines at snap points
- Falls back to grid snapping when no smart snap hits
- Guide lines are temporary (`_isSnapGuide`), cleared on mouse release
- `canvasToCleanJSON()` strips grid lines from serialization (templates and queue)

**Shapes tool:**
- Toolbar dropdown: Rectangle, Circle, Line
- Shapes created with stroke only (no fill), using current fill color
- Standard Fabric.js objects — movable, scalable, deletable

**Font picker and fill color:**
- Font dropdown: Arial, Courier, Georgia, Impact, Times, Comic Sans
- Fill toggle button switches between black and white (`currentFill` state)
- Applies to new objects and updates selected object on toggle

**Object layering:**
- "Bring Forward" (↑) and "Send Backward" (↓) buttons in toolbar
- Send backward prevents objects from going behind grid lines

**Queue duplication:**
- Duplicate button (⧉) on each queue thumbnail, next to remove (×)
- Deep-copies canvasJSON and reuses thumbnail, inserts after original

**Touch optimization:**
- Larger Fabric.js selection handles on touch devices (`cornerSize: 20`, `touchCornerSize: 40`)
- Increased snap threshold (14px vs 8px) on touch for easier snapping

## Key implementation details

### Image resizing strategy (ditherbooth/imaging/process.py:5-39)

The `to_1bit()` function uses **contain** resizing:
- Calculates scale factor to fit both width constraint AND optional height constraint
- Uses `min(sx, sy)` to ensure image fits within bounds
- No cropping or padding to fill the entire label height
- Centers horizontally on white canvas (unless `center_x=False`)

This differs from "cover" (would crop) or "fill" (would pad/distort).

### EPL encoding details (ditherbooth/printer/epl.py)

EPL format uses the GW (Graphics Write) command:
- Pixels are packed into bytes (8 pixels per byte)
- White pixels → bit set to 1, black pixels → bit set to 0
- Commands: `N` (clear), `D` (darkness), `S` (speed), `q` (width), `Q` (height, gap)
- For continuous media: small Q value (16 dots) creates minimal post-print spacing
- For fixed labels: Q matches label height, gap detection automatic

### Test mode

When `test_mode` is enabled in config:
- `/print` endpoint processes the image but skips `spool_raw()`
- Returns `{"status": "ok", "mode": "test", "bytes": ..., "media": ..., "lang": ...}`
- Optional `test_mode_delay_ms` simulates print latency
- Useful for UI testing without a physical printer
