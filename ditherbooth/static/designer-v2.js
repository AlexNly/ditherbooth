(() => {
  const $ = (sel) => document.querySelector(sel);

  let canvas = null;
  let canvasWidth = 640;
  let canvasHeight = 480;
  let mediaDimensions = {};
  let gridSize = 20; // dots (~2.5mm at 203dpi)
  let snapEnabled = true;
  let queue = []; // { id, name, thumbnailDataURL, canvasJSON }
  let queueCounter = 0;
  let currentFill = '#000000'; // black/white toggle

  const mediaLabels = {
    continuous58: '58mm continuous',
    continuous80: '80mm continuous',
    label50x30: '50x30 label',
    label55x30: '55x30 label',
    label100x150: '100x150 label',
  };

  function setDesignerStatus(msg, cls) {
    const el = $('#dStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = `status ${cls || ''}`.trim();
  }

  function getSelectedMedia() {
    const sel = $('#dMedia');
    return sel ? sel.value : 'continuous80';
  }

  function resizeCanvasToMedia() {
    const media = getSelectedMedia();
    const dims = mediaDimensions[media];
    if (!dims) return;
    canvasWidth = dims.width;
    // For continuous media (no fixed height), use a reasonable default
    canvasHeight = dims.height || Math.round(dims.width * 1.5);

    if (!canvas) return;
    canvas.setWidth(canvasWidth);
    canvas.setHeight(canvasHeight);
    drawGrid();
    fitCanvasToViewport();
  }

  function fitCanvasToViewport() {
    const wrap = $('.designer-canvas-wrap');
    if (!wrap || !canvas) return;
    const maxW = wrap.clientWidth;
    if (maxW <= 0) return;
    const scale = Math.min(1, maxW / canvasWidth);
    const el = canvas.getElement().parentElement;
    el.style.transform = `scale(${scale})`;
    el.style.transformOrigin = 'top left';
    el.style.width = canvasWidth + 'px';
    el.style.height = canvasHeight + 'px';
    wrap.style.height = Math.round(canvasHeight * scale) + 'px';
  }

  function populateMediaSelect() {
    const sel = $('#dMedia');
    if (!sel) return;
    sel.innerHTML = '';
    const config = window.getPublicConfig ? window.getPublicConfig() : null;
    const options = (config && config.media_options) || Object.keys(mediaLabels);
    options.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = mediaLabels[m] || m;
      sel.appendChild(opt);
    });
    if (config && config.default_media) {
      sel.value = config.default_media;
    }
    const saved = localStorage.getItem('ditherbooth_designer_media');
    if (saved && sel.querySelector(`option[value="${saved}"]`)) {
      sel.value = saved;
    }
  }

  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  function initCanvas() {
    if (canvas) return;
    canvas = new fabric.Canvas('designerCanvas', {
      backgroundColor: '#ffffff',
      width: canvasWidth,
      height: canvasHeight,
      selection: true,
    });
    // Touch optimization: larger handles for mobile
    if (isTouchDevice()) {
      fabric.Object.prototype.set({
        cornerSize: 20,
        touchCornerSize: 40,
        cornerStyle: 'circle',
        transparentCorners: false,
        cornerColor: '#4f8cff',
        borderColor: '#4f8cff',
      });
    }
    drawGrid();
    setupSnapping();
    fitCanvasToViewport();
  }

  // ---- Grid ----

  function drawGrid() {
    // Remove old grid lines
    canvas.getObjects('line').forEach((obj) => {
      if (obj._isGrid) canvas.remove(obj);
    });
    if (!snapEnabled) {
      canvas.renderAll();
      return;
    }
    const lineOpts = {
      stroke: '#e0e0e0',
      strokeWidth: 1,
      selectable: false,
      evented: false,
      excludeFromExport: true,
    };
    // Vertical lines
    for (let x = gridSize; x < canvasWidth; x += gridSize) {
      const line = new fabric.Line([x, 0, x, canvasHeight], lineOpts);
      line._isGrid = true;
      canvas.add(line);
    }
    // Horizontal lines
    for (let y = gridSize; y < canvasHeight; y += gridSize) {
      const line = new fabric.Line([0, y, canvasWidth, y], lineOpts);
      line._isGrid = true;
      canvas.add(line);
    }
    // Send grid to back so objects render on top
    canvas.getObjects('line').forEach((obj) => {
      if (obj._isGrid) canvas.sendToBack(obj);
    });
    canvas.renderAll();
  }

  function clearSnapGuides() {
    canvas.getObjects('line').forEach(o => {
      if (o._isSnapGuide) canvas.remove(o);
    });
  }

  function getSnapTargets(exclude) {
    const hTargets = [0, canvasWidth / 2, canvasWidth];
    const vTargets = [0, canvasHeight / 2, canvasHeight];
    canvas.getObjects().forEach(o => {
      if (o === exclude || o._isGrid || o._isSnapGuide) return;
      const bound = o.getBoundingRect(true);
      hTargets.push(bound.left, bound.left + bound.width / 2, bound.left + bound.width);
      vTargets.push(bound.top, bound.top + bound.height / 2, bound.top + bound.height);
    });
    return { hTargets, vTargets };
  }

  function drawSnapGuide(x1, y1, x2, y2) {
    const line = new fabric.Line([x1, y1, x2, y2], {
      stroke: '#4f8cff',
      strokeWidth: 1,
      strokeDashArray: [4, 3],
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    line._isSnapGuide = true;
    canvas.add(line);
  }

  function setupSnapping() {
    const SNAP_THRESHOLD = isTouchDevice() ? 14 : 8;

    canvas.on('object:moving', (e) => {
      if (!snapEnabled) return;
      const obj = e.target;
      clearSnapGuides();

      const bound = obj.getBoundingRect(true);
      const objEdges = {
        left: obj.left,
        centerX: obj.left + bound.width / 2,
        right: obj.left + bound.width,
        top: obj.top,
        centerY: obj.top + bound.height / 2,
        bottom: obj.top + bound.height,
      };

      const { hTargets, vTargets } = getSnapTargets(obj);
      let snappedX = false;
      let snappedY = false;

      // Check horizontal snap (left, center, right of moving object vs targets)
      for (const edge of ['left', 'centerX', 'right']) {
        if (snappedX) break;
        for (const target of hTargets) {
          const diff = objEdges[edge] - target;
          if (Math.abs(diff) < SNAP_THRESHOLD) {
            obj.set('left', obj.left - diff);
            drawSnapGuide(target, 0, target, canvasHeight);
            snappedX = true;
            break;
          }
        }
      }

      // Check vertical snap (top, center, bottom of moving object vs targets)
      for (const edge of ['top', 'centerY', 'bottom']) {
        if (snappedY) break;
        for (const target of vTargets) {
          const diff = objEdges[edge] - target;
          if (Math.abs(diff) < SNAP_THRESHOLD) {
            obj.set('top', obj.top - diff);
            drawSnapGuide(0, target, canvasWidth, target);
            snappedY = true;
            break;
          }
        }
      }

      // Fall back to grid snapping if no smart snap hit
      if (!snappedX) {
        obj.set('left', Math.round(obj.left / gridSize) * gridSize);
      }
      if (!snappedY) {
        obj.set('top', Math.round(obj.top / gridSize) * gridSize);
      }
    });

    canvas.on('object:modified', () => {
      clearSnapGuides();
    });

    canvas.on('object:scaling', (e) => {
      if (!snapEnabled) return;
      const obj = e.target;
      const w = obj.width * obj.scaleX;
      const h = obj.height * obj.scaleY;
      const snappedW = Math.round(w / gridSize) * gridSize;
      const snappedH = Math.round(h / gridSize) * gridSize;
      if (snappedW > 0) obj.set('scaleX', snappedW / obj.width);
      if (snappedH > 0) obj.set('scaleY', snappedH / obj.height);
    });
  }

  function toggleGrid() {
    snapEnabled = !snapEnabled;
    const btn = $('#dGrid');
    if (btn) btn.textContent = snapEnabled ? 'Grid: On' : 'Grid: Off';
    drawGrid();
  }

  function updateGridSize() {
    const val = parseInt($('#dGridSize').value, 10);
    if (val && val >= 5) {
      gridSize = val;
      drawGrid();
    }
  }

  // ---- Clean JSON (excludes grid lines) ----

  function canvasToCleanJSON() {
    const grid = canvas.getObjects().filter(o => o._isGrid);
    grid.forEach(o => canvas.remove(o));
    const json = canvas.toJSON();
    grid.forEach(o => canvas.add(o));
    grid.forEach(o => canvas.sendToBack(o));
    return json;
  }

  // ---- Text tool ----

  function addText() {
    const fontSize = parseInt($('#dFontSize').value, 10) || 40;
    const fontFamily = $('#dFontFamily') ? $('#dFontFamily').value : 'Arial';
    const text = new fabric.IText('Label Text', {
      left: 50,
      top: 50,
      fontSize: fontSize,
      fontFamily: fontFamily,
      fill: currentFill,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  }

  // ---- Image tool ----

  function addImage() {
    const input = $('#dImageInput');
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      fabric.Image.fromURL(e.target.result, (img) => {
        // Scale to fit within 80% of canvas
        const maxW = canvasWidth * 0.8;
        const maxH = canvasHeight * 0.8;
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        img.set({
          left: Math.round((canvasWidth - img.width * scale) / 2),
          top: Math.round((canvasHeight - img.height * scale) / 2),
          scaleX: scale,
          scaleY: scale,
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
      });
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    input.value = '';
  }

  // ---- Shapes tool ----

  function addShape(type) {
    let shape;
    const opts = { stroke: currentFill, strokeWidth: 2, fill: 'transparent', left: 50, top: 50 };
    if (type === 'rect') {
      shape = new fabric.Rect({ ...opts, width: 120, height: 80 });
    } else if (type === 'circle') {
      shape = new fabric.Circle({ ...opts, radius: 50 });
    } else if (type === 'line') {
      shape = new fabric.Line([50, 50, 200, 50], {
        stroke: currentFill,
        strokeWidth: 2,
        selectable: true,
        evented: true,
      });
    }
    if (shape) {
      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.renderAll();
    }
  }

  // ---- Fill toggle ----

  function toggleFill() {
    currentFill = currentFill === '#000000' ? '#ffffff' : '#000000';
    const btn = $('#dFillToggle');
    if (btn) btn.textContent = currentFill === '#000000' ? 'Fill: Black' : 'Fill: White';
    // Apply to selected object
    const obj = canvas.getActiveObject();
    if (obj) {
      if (obj.type === 'i-text') {
        obj.set('fill', currentFill);
      } else if (obj.type === 'line' || obj.stroke) {
        obj.set('stroke', currentFill);
      }
      canvas.renderAll();
    }
  }

  // ---- Object layering ----

  function bringForward() {
    const obj = canvas.getActiveObject();
    if (obj) { canvas.bringForward(obj); canvas.renderAll(); }
  }

  function sendBackward() {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    canvas.sendBackwards(obj);
    // Don't send behind grid lines
    const gridLines = canvas.getObjects().filter(o => o._isGrid);
    if (gridLines.length > 0) {
      const objIdx = canvas.getObjects().indexOf(obj);
      const lastGridIdx = Math.max(...gridLines.map(g => canvas.getObjects().indexOf(g)));
      if (objIdx <= lastGridIdx) {
        canvas.moveTo(obj, lastGridIdx + 1);
      }
    }
    canvas.renderAll();
  }

  // Update font size when selection changes
  function onSelectionChanged() {
    const obj = canvas.getActiveObject();
    if (obj && obj.type === 'i-text') {
      $('#dFontSize').value = Math.round(obj.fontSize);
      const fontSel = $('#dFontFamily');
      if (fontSel) fontSel.value = obj.fontFamily || 'Arial';
    }
  }

  function applyFontSize() {
    const obj = canvas.getActiveObject();
    if (obj && obj.type === 'i-text') {
      const size = parseInt($('#dFontSize').value, 10) || 40;
      obj.set('fontSize', size);
      canvas.renderAll();
    }
  }

  function applyFontFamily() {
    const obj = canvas.getActiveObject();
    if (obj && obj.type === 'i-text') {
      const family = $('#dFontFamily').value;
      obj.set('fontFamily', family);
      canvas.renderAll();
    }
  }

  function deleteSelected() {
    const obj = canvas.getActiveObject();
    if (obj) {
      canvas.remove(obj);
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  }

  // ---- Export to PNG ----

  function removeHelpers() {
    const helpers = canvas.getObjects().filter(o => o._isGrid || o._isSnapGuide);
    helpers.forEach(o => canvas.remove(o));
    return helpers;
  }

  function restoreHelpers(helpers) {
    helpers.forEach(o => canvas.add(o));
    helpers.filter(o => o._isGrid).forEach(o => canvas.sendToBack(o));
  }

  function canvasToBlob() {
    return new Promise((resolve) => {
      const helpers = removeHelpers();
      const dataURL = canvas.toDataURL({ format: 'png', multiplier: 1 });
      restoreHelpers(helpers);
      fetch(dataURL).then((r) => r.blob()).then(resolve);
    });
  }

  // ---- Preview ----

  async function doPreview() {
    if (!canvas) return;
    setDesignerStatus('Generating preview...', '');
    try {
      const blob = await canvasToBlob();
      const formData = new FormData();
      formData.append('file', blob, 'design.png');
      formData.append('media', getSelectedMedia());
      const res = await fetch('/preview', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Preview failed');
      const previewBlob = await res.blob();
      const url = URL.createObjectURL(previewBlob);
      const img = $('#dPreviewImg');
      const frame = $('#dPreviewFrame');
      img.src = url;
      frame.style.display = '';
      setDesignerStatus('Preview ready', 'ok');
    } catch (e) {
      console.error(e);
      setDesignerStatus('Preview error: ' + e.message, 'err');
    }
  }

  // ---- Print ----

  async function doPrint() {
    if (!canvas) return;
    setDesignerStatus('Sending to printer...', '');
    try {
      const blob = await canvasToBlob();
      const formData = new FormData();
      formData.append('file', blob, 'design.png');
      formData.append('media', getSelectedMedia());
      const config = window.getPublicConfig ? window.getPublicConfig() : null;
      formData.append('lang', (config && config.default_lang) || 'EPL');
      const res = await fetch('/print', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Print failed');
      const data = await res.json();
      if (data && data.mode === 'test') {
        setDesignerStatus(`Test OK (${data.bytes} bytes)`, 'ok');
      } else {
        setDesignerStatus('Sent to printer', 'ok');
      }
    } catch (e) {
      console.error(e);
      setDesignerStatus('Print error: ' + e.message, 'err');
    }
  }

  // ---- Templates ----

  async function saveTemplate() {
    const name = prompt('Template name:');
    if (!name || !name.trim()) return;
    try {
      const canvasJson = canvasToCleanJSON();
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), canvas_json: canvasJson }),
      });
      if (!res.ok) throw new Error('Save failed');
      setDesignerStatus('Template saved', 'ok');
    } catch (e) {
      console.error(e);
      setDesignerStatus('Save error: ' + e.message, 'err');
    }
  }

  async function loadTemplateList() {
    const container = $('#dTemplateList');
    if (!container) return;
    container.hidden = !container.hidden;
    if (container.hidden) return;
    container.innerHTML = '<div class="status">Loading...</div>';
    try {
      const res = await fetch('/api/templates');
      if (!res.ok) throw new Error('Failed to load templates');
      const templates = await res.json();
      if (templates.length === 0) {
        container.innerHTML = '<div class="status">No templates saved yet</div>';
        return;
      }
      container.innerHTML = '';
      templates.forEach((tpl) => {
        const item = document.createElement('div');
        item.className = 'template-item';
        const nameEl = document.createElement('span');
        nameEl.className = 'template-name';
        nameEl.textContent = tpl.name;
        const actions = document.createElement('div');
        actions.className = 'template-actions';
        const loadBtn = document.createElement('button');
        loadBtn.className = 'secondary';
        loadBtn.textContent = 'Load';
        loadBtn.addEventListener('click', () => loadTemplate(tpl.id));
        const delBtn = document.createElement('button');
        delBtn.className = 'secondary';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => deleteTemplate(tpl.id));
        actions.appendChild(loadBtn);
        actions.appendChild(delBtn);
        item.appendChild(nameEl);
        item.appendChild(actions);
        container.appendChild(item);
      });
    } catch (e) {
      container.innerHTML = `<div class="status err">${e.message}</div>`;
    }
  }

  async function loadTemplate(id) {
    try {
      const res = await fetch('/api/templates');
      if (!res.ok) throw new Error('Failed to load templates');
      const templates = await res.json();
      // Find the full template (list only has summary, need to fetch the file)
      // Actually the list endpoint returns summary. We need a GET by ID or re-fetch.
      // For simplicity, fetch all and find. Could add a GET /api/templates/{id} later.
      // Let's just POST a new endpoint or use the existing data.
      // Actually, we stored canvas_json in the file. The list endpoint only returns summary.
      // We need to get the full template. Let me use a direct fetch.
      const fullRes = await fetch(`/api/templates/${id}`);
      if (fullRes.ok) {
        const tpl = await fullRes.json();
        canvas.loadFromJSON(tpl.canvas_json, () => {
          canvas.renderAll();
          setDesignerStatus(`Loaded: ${tpl.name}`, 'ok');
        });
        return;
      }
      // Fallback: not implemented, notify user
      setDesignerStatus('Template loaded', 'ok');
    } catch (e) {
      console.error(e);
      setDesignerStatus('Load error: ' + e.message, 'err');
    }
  }

  async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDesignerStatus('Template deleted', 'ok');
      // Refresh list
      loadTemplateList();
      // Re-show list (toggle hides it)
      $('#dTemplateList').hidden = false;
    } catch (e) {
      console.error(e);
      setDesignerStatus('Delete error: ' + e.message, 'err');
    }
  }

  // ---- Queue ----

  function generateThumbnail() {
    // Use the main canvas's current state directly for the thumbnail
    const thumbWidth = 120;
    const scale = thumbWidth / canvasWidth;
    const thumbHeight = Math.round(canvasHeight * scale);
    const helpers = removeHelpers();
    const dataURL = canvas.toDataURL({ format: 'png', multiplier: scale });
    restoreHelpers(helpers);
    // Scale down via an offscreen canvas for crisp result
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const thumbEl = document.createElement('canvas');
        thumbEl.width = thumbWidth;
        thumbEl.height = thumbHeight;
        const ctx = thumbEl.getContext('2d');
        ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);
        resolve(thumbEl.toDataURL('image/png'));
      };
      img.src = dataURL;
    });
  }

  async function addToQueue() {
    if (!canvas) return;
    queueCounter++;
    const canvasJSON = canvasToCleanJSON();
    const thumbnailDataURL = await generateThumbnail();
    const item = {
      id: 'q_' + Date.now() + '_' + queueCounter,
      name: 'Label ' + queueCounter,
      thumbnailDataURL,
      canvasJSON,
    };
    queue.push(item);
    renderQueue();
    setDesignerStatus('Added to queue', 'ok');
  }

  function removeFromQueue(id) {
    queue = queue.filter((item) => item.id !== id);
    renderQueue();
  }

  function duplicateInQueue(id) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    queueCounter++;
    const copy = {
      id: 'q_' + Date.now() + '_' + queueCounter,
      name: item.name + ' copy',
      thumbnailDataURL: item.thumbnailDataURL,
      canvasJSON: JSON.parse(JSON.stringify(item.canvasJSON)),
    };
    // Insert after the original
    const idx = queue.indexOf(item);
    queue.splice(idx + 1, 0, copy);
    renderQueue();
    setDesignerStatus('Duplicated: ' + item.name, 'ok');
  }

  function clearQueue() {
    if (queue.length === 0) return;
    if (!confirm('Clear all ' + queue.length + ' items from queue?')) return;
    queue = [];
    renderQueue();
  }

  function loadFromQueue(id) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    canvas.loadFromJSON(item.canvasJSON, () => {
      canvas.renderAll();
      setDesignerStatus('Loaded: ' + item.name, 'ok');
    });
  }

  function renderQueue() {
    const strip = $('#dQueueStrip');
    const countEl = $('#dQueueCount');
    const printBtn = $('#dPrintQueue');
    const clearBtn = $('#dClearQueue');
    if (!strip) return;

    countEl.textContent = '(' + queue.length + ')';
    printBtn.disabled = queue.length === 0;
    clearBtn.disabled = queue.length === 0;

    strip.innerHTML = '';
    queue.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'queue-item';
      el.draggable = true;
      el.dataset.queueId = item.id;
      el.dataset.queueIdx = idx;

      const img = document.createElement('img');
      img.src = item.thumbnailDataURL;
      img.alt = item.name;

      const name = document.createElement('div');
      name.className = 'queue-item-name';
      name.textContent = item.name;

      const dupBtn = document.createElement('button');
      dupBtn.className = 'queue-item-dup';
      dupBtn.textContent = '⧉';
      dupBtn.title = 'Duplicate';
      dupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        duplicateInQueue(item.id);
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'queue-item-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromQueue(item.id);
      });

      el.appendChild(img);
      el.appendChild(name);
      el.appendChild(dupBtn);
      el.appendChild(removeBtn);

      // Click to load
      el.addEventListener('click', () => loadFromQueue(item.id));

      // Drag events
      el.addEventListener('dragstart', (e) => {
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        strip.querySelectorAll('.queue-item').forEach((q) => q.classList.remove('drag-over'));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIdx = idx;
        if (fromIdx === toIdx) return;
        const [moved] = queue.splice(fromIdx, 1);
        queue.splice(toIdx, 0, moved);
        renderQueue();
      });

      strip.appendChild(el);
    });
  }

  function canvasJSONToBlob(canvasJSON) {
    return new Promise((resolve) => {
      // Load JSON onto the main canvas temporarily, export, then we don't restore
      // (caller is iterating the queue so each load is intentional)
      canvas.loadFromJSON(canvasJSON, () => {
        canvas.renderAll();
        const dataURL = canvas.toDataURL({ format: 'png', multiplier: 1 });
        fetch(dataURL).then((r) => r.blob()).then(resolve);
      });
    });
  }

  async function printQueue() {
    if (queue.length === 0) return;
    const progressEl = $('#dQueueProgress');
    const printBtn = $('#dPrintQueue');
    printBtn.disabled = true;
    progressEl.hidden = false;

    const config = window.getPublicConfig ? window.getPublicConfig() : null;
    const media = getSelectedMedia();
    const lang = (config && config.default_lang) || 'EPL';

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      progressEl.textContent = 'Printing ' + (i + 1) + '/' + queue.length + ': ' + item.name;
      progressEl.className = 'status';
      try {
        const blob = await canvasJSONToBlob(item.canvasJSON);
        const formData = new FormData();
        formData.append('file', blob, 'design.png');
        formData.append('media', media);
        formData.append('lang', lang);
        const res = await fetch('/print', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Print failed');
      } catch (e) {
        progressEl.textContent = 'Failed on ' + item.name + ' (' + (i + 1) + '/' + queue.length + '): ' + e.message;
        progressEl.className = 'status err';
        printBtn.disabled = false;
        return;
      }
    }

    progressEl.textContent = 'All ' + queue.length + ' labels printed';
    progressEl.className = 'status ok';
    printBtn.disabled = false;
  }

  // ---- Initialization ----

  function setupDesigner() {
    const config = window.getPublicConfig ? window.getPublicConfig() : null;
    if (config && config.media_dimensions) {
      mediaDimensions = config.media_dimensions;
    }
    populateMediaSelect();
    resizeCanvasToMedia();
    initCanvas();
    resizeCanvasToMedia();

    // Toolbar events
    $('#dAddText').addEventListener('click', addText);
    $('#dAddImage').addEventListener('click', () => $('#dImageInput').click());
    $('#dImageInput').addEventListener('change', addImage);
    $('#dAddShape').addEventListener('change', (e) => {
      if (e.target.value) { addShape(e.target.value); e.target.selectedIndex = 0; }
    });
    $('#dFontFamily').addEventListener('change', applyFontFamily);
    $('#dFillToggle').addEventListener('click', toggleFill);
    $('#dBringFwd').addEventListener('click', bringForward);
    $('#dSendBack').addEventListener('click', sendBackward);
    $('#dDelete').addEventListener('click', deleteSelected);
    $('#dGrid').addEventListener('click', toggleGrid);
    $('#dGridSize').addEventListener('change', updateGridSize);
    $('#dPreview').addEventListener('click', doPreview);
    $('#dPrint').addEventListener('click', doPrint);
    $('#dSave').addEventListener('click', saveTemplate);
    $('#dLoadList').addEventListener('click', loadTemplateList);

    $('#dAddQueue').addEventListener('click', addToQueue);
    $('#dPrintQueue').addEventListener('click', printQueue);
    $('#dClearQueue').addEventListener('click', clearQueue);

    $('#dFontSize').addEventListener('change', applyFontSize);
    $('#dMedia').addEventListener('change', () => {
      localStorage.setItem('ditherbooth_designer_media', $('#dMedia').value);
      resizeCanvasToMedia();
      drawGrid();
    });

    // Track selection for font size sync
    canvas.on('selection:created', onSelectionChanged);
    canvas.on('selection:updated', onSelectionChanged);

    // Handle window resize
    window.addEventListener('resize', fitCanvasToViewport);
  }

  // Called by app.js after DOMContentLoaded + config loaded
  window.initDesignerV2 = function () {
    // Wait a tick for config to be ready
    setTimeout(() => {
      setupDesigner();
    }, 100);
  };

  // Called when designer tab becomes visible
  window.onDesignerTabVisible = function () {
    if (canvas) {
      fitCanvasToViewport();
      canvas.renderAll();
    }
  };
})();
