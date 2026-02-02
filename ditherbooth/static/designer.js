(() => {
  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#designCanvas');
  const ctx = canvas.getContext('2d');
  const mediaSel = $('#mediaSel');
  const statusEl = $('#designerStatus');
  const editBox = $('#editBox');
  const libModal = document.getElementById('libraryModal');

  const DPR = window.devicePixelRatio || 1;
  let state = {
    media: 'label100x150',
    widthDots: 800,
    heightDots: 1200,
    objects: [],
    selection: null,
    viewScale: 1,
    snapEnabled: !('ontouchstart' in window),
  };
  const undoStack = [];
  const redoStack = [];

  const MEDIA_MAP = {
    label100x150: { w: 800, h: 1200 },
    label55x30:   { w: 440, h: 240 },
    continuous80: { w: 640, h: 400 }, // start with 400 high; we’ll resize to content on export
  };

  const STORAGE_KEYS = {
    list: 'labelDesigner.library',
    design: (id) => `labelDesigner.design.${id}`,
  };

  function pushUndo() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  }
  function setStatus(msg, cls='') {
    statusEl.textContent = msg || '';
    statusEl.className = `status ${cls}`.trim();
  }

  function setMedia(id) {
    state.media = id;
    const m = MEDIA_MAP[id];
    state.widthDots = m.w;
    state.heightDots = m.h;
    resizeCanvasToContainer();
    draw();
  }

  function resizeCanvasToContainer() {
    const wrap = canvas.parentElement;
    const maxW = Math.max(240, wrap.clientWidth - 20);
    const scale = maxW / state.widthDots;
    state.viewScale = scale;
    canvas.style.width = `${Math.round(state.widthDots * scale)}px`;
    canvas.style.height = `${Math.round(state.heightDots * scale)}px`;
    canvas.width = Math.round(state.widthDots * DPR);
    canvas.height = Math.round(state.heightDots * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function addText() {
    pushUndo();
    state.objects.push({ type: 'text', x: 20, y: 30, w: 200, h: 40, text: 'Text', size: 28, align: 'left' });
    draw();
  }
  function addRect() {
    pushUndo();
    state.objects.push({ type: 'rect', x: 20, y: 80, w: 200, h: 100, fill: true });
    draw();
  }
  function addImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        pushUndo();
        const w = Math.min(img.width, state.widthDots / 2);
        const h = Math.round((img.height / img.width) * w);
        state.objects.push({ type: 'image', x: 40, y: 40, w, h, src: reader.result, _img: img });
        draw();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function draw() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, state.widthDots, state.heightDots);
    // safe margin (optional):
    // ctx.strokeStyle = '#e6e6e6'; ctx.strokeRect(10, 10, state.widthDots-20, state.heightDots-20);

    // Draw alignment guides if any
    drawGuides();

    for (const obj of state.objects) {
      drawObject(obj);
      if (state.selection === obj) drawSelection(obj);
    }
  }

  // --- Design (de)serialization ---
  function serializeDesign(overrides={}) {
    return {
      version: 1,
      media: state.media,
      widthDots: state.widthDots,
      heightDots: state.heightDots,
      objects: JSON.parse(JSON.stringify(state.objects)),
      ...overrides,
    };
  }

  function applyDesign(design) {
    const mm = MEDIA_MAP[design.media] || { w: design.widthDots, h: design.heightDots };
    state.media = design.media;
    state.widthDots = mm.w;
    state.heightDots = mm.h;
    state.objects = (design.objects || []).map(o => ({...o}));
    state.selection = null;
    mediaSel.value = state.media;
    resizeCanvasToContainer();
    draw(); syncProps();
  }

  function renderDesignToCanvas(ctxOut, design) {
    const w = design.widthDots || (MEDIA_MAP[design.media]?.w || state.widthDots);
    let h = design.heightDots || (MEDIA_MAP[design.media]?.h || state.heightDots);
    if (design.media === 'continuous80') {
      // determine content bottom
      let bottom = 0;
      for (const o of design.objects) bottom = Math.max(bottom, (o.y||0) + (o.h||0));
      h = Math.max(1, Math.min(4000, Math.round(bottom + 8)));
    }
    ctxOut.imageSmoothingEnabled = false;
    ctxOut.fillStyle = '#fff'; ctxOut.fillRect(0,0,w,h);
    for (const obj of (design.objects||[])) {
      const rot = (obj.rotation || 0) * Math.PI / 180;
      const cx = obj.x + (obj.w||0)/2;
      const cy = obj.y + (obj.h||0)/2;
      ctxOut.save();
      if (rot) { ctxOut.translate(cx, cy); ctxOut.rotate(rot); ctxOut.translate(-cx, -cy); }
      switch (obj.type) {
        case 'text': {
          ctxOut.fillStyle = '#000';
          ctxOut.font = `${obj.bold?'bold ':''}${obj.size||24}px sans-serif`;
          ctxOut.textAlign = obj.align || 'left';
          ctxOut.textBaseline = 'top';
          const tx = obj.x + (obj.align==='center'? (obj.w||0)/2 : obj.align==='right'? (obj.w||0) : 0);
          wrapTextOff(ctxOut, obj.text||'', tx, obj.y, obj.w||200, (obj.size||24)*1.2);
          break;
        }
        case 'rect':
          if (obj.fill) ctxOut.fillRect(obj.x, obj.y, obj.w, obj.h);
          else { ctxOut.strokeStyle='#000'; ctxOut.strokeRect(obj.x, obj.y, obj.w, obj.h); }
          break;
        case 'image':
          if (obj._img) ctxOut.drawImage(obj._img, obj.x, obj.y, obj.w, obj.h);
          break;
      }
      ctxOut.restore();
    }
    return { w, h };
  }

  function drawObject(obj) {
    const rot = (obj.rotation || 0) * Math.PI / 180;
    const cx = obj.x + (obj.w||0)/2;
    const cy = obj.y + (obj.h||0)/2;
    ctx.save();
    if (rot) { ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy); }
    switch (obj.type) {
      case 'text':
        ctx.fillStyle = '#000';
        ctx.font = `${obj.bold?'bold ':''}${obj.size||24}px sans-serif`;
        ctx.textAlign = obj.align || 'left';
        ctx.textBaseline = 'top';
        const x = obj.x + (obj.align==='center'? (obj.w||0)/2 : obj.align==='right'? (obj.w||0) : 0);
        wrapText(obj.text||'', x, obj.y, obj.w||200, (obj.size||24) * 1.2);
        break;
      case 'rect':
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        if (obj.fill) ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
        else ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
        break;
      case 'image':
        if (obj._img) ctx.drawImage(obj._img, obj.x, obj.y, obj.w, obj.h);
        else {
          const img = new Image();
          img.onload = () => { obj._img = img; draw(); };
          img.src = obj.src;
        }
        break;
    }
    ctx.restore();
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    if (!text) return;
    const words = (text+"").split(/\s+/);
    let line = '';
    for (let n=0; n<words.length; n++) {
      const test = line ? line + ' ' + words[n] : words[n];
      const m = ctx.measureText(test);
      if (m.width > maxWidth && n>0) {
        ctx.fillText(line, x, y);
        line = words[n];
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }

  function drawSelection(obj) {
    ctx.save();
    ctx.strokeStyle = '#2f6fed';
    ctx.setLineDash([4,3]);
    ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#2f6fed';
    const hs = 6;
    // corners
    ctx.fillRect(obj.x-hs, obj.y-hs, hs*2, hs*2); // nw
    ctx.fillRect(obj.x+obj.w-hs, obj.y-hs, hs*2, hs*2); // ne
    ctx.fillRect(obj.x-hs, obj.y+obj.h-hs, hs*2, hs*2); // sw
    ctx.fillRect(obj.x+obj.w-hs, obj.y+obj.h-hs, hs*2, hs*2); // se
    // rotation handle: circle above top center
    const rx = obj.x + obj.w/2; const ry = obj.y - 18;
    ctx.beginPath(); ctx.arc(rx, ry, 5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function hitTest(x, y) {
    for (let i=state.objects.length-1; i>=0; i--) {
      const o = state.objects[i];
      if (x>=o.x && y>=o.y && x<=o.x+o.w && y<=o.y+o.h) return o;
    }
    return null;
  }

  function hitHandle(obj, x, y) {
    const hs = 8;
    const corners = [
      {k:'nw', x: obj.x, y: obj.y},
      {k:'ne', x: obj.x+obj.w, y: obj.y},
      {k:'sw', x: obj.x, y: obj.y+obj.h},
      {k:'se', x: obj.x+obj.w, y: obj.y+obj.h},
    ];
    for (const c of corners) {
      if (Math.abs(x - c.x) <= hs && Math.abs(y - c.y) <= hs) return {type:'resize', dir:c.k};
    }
    const rx = obj.x + obj.w/2; const ry = obj.y - 18;
    if (Math.hypot(x - rx, y - ry) <= 10) return {type:'rotate'};
    return null;
  }

  let currentGuides = [];
  function drawGuides() {
    if (!currentGuides.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(47,111,237,0.6)';
    ctx.lineWidth = 1;
    for (const g of currentGuides) {
      if (g.type === 'v') { ctx.beginPath(); ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, state.heightDots); ctx.stroke(); }
      if (g.type === 'h') { ctx.beginPath(); ctx.moveTo(0, g.pos); ctx.lineTo(state.widthDots, g.pos); ctx.stroke(); }
    }
    ctx.restore();
  }

  function syncProps() {
    const o = state.selection;
    $('#propText').value = (o && o.type==='text') ? (o.text||'') : '';
    $('#propSize').value = (o && o.type==='text') ? (o.size||24) : '';
    const pr = $('#propSizeRange'); if (pr) pr.value = $('#propSize').value || '';
    const boldEl = $('#propBold');
    if (boldEl) {
      boldEl.checked = !!(o && o.type==='text' && o.bold);
      boldEl.disabled = !(o && o.type==='text');
    }
    $('#propX').value = o? Math.round(o.x): '';
    $('#propY').value = o? Math.round(o.y): '';
    $('#propW').value = o? Math.round(o.w): '';
    $('#propH').value = o? Math.round(o.h): '';
  }

  function applyProps() {
    const o = state.selection; if (!o) return;
    if (o.type==='text') {
      o.text = $('#propText').value;
      const sz = parseInt($('#propSize').value||o.size,10);
      if (!Number.isNaN(sz)) o.size = Math.max(6, Math.min(240, sz));
      o.bold = !!$('#propBold').checked;
    }
    ['X','Y','W','H'].forEach(k => {
      const v = parseInt($(`#prop${k}`).value || (k==='X'?o.x:k==='Y'?o.y:k==='W'?o.w:o.h), 10);
      if (!Number.isNaN(v)) {
        if (k==='X') o.x = v; else if (k==='Y') o.y = v; else if (k==='W') o.w = Math.max(1,v); else o.h = Math.max(1,v);
      }
    });
    draw();
  }

  // Pointer interactions
  let drag = null; // {obj, dx, dy, mode, dir}
  let lastTapTime = 0; let lastTapObj = null; let movedDuringPress = false;
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.viewScale;
    const y = (e.clientY - rect.top) / state.viewScale;
    movedDuringPress = false;
    // First: if a selection exists, allow hitting its handles even outside bbox
    if (state.selection) {
      const hhSel = hitHandle(state.selection, x, y);
      if (hhSel) {
        pushUndo();
        if (hhSel.type==='resize') {
          const o = state.selection;
          drag = { obj: o, mode: 'resize', dir: hhSel.dir, ox: o.x, oy: o.y, ow: o.w, oh: o.h, startX: x, startY: y };
        } else if (hhSel.type==='rotate') {
          const o = state.selection; const cx = o.x + o.w/2; const cy = o.y + o.h/2;
          drag = { obj: o, mode: 'rotate', cx, cy };
        }
        canvas.setPointerCapture?.(e.pointerId);
        draw();
        return;
      }
    }
    const o = hitTest(x, y);
    if (o) {
      state.selection = o; syncProps();
      const hh = hitHandle(o, x, y);
      pushUndo();
      if (hh && hh.type==='resize') {
        drag = { obj: o, mode: 'resize', dir: hh.dir, ox: o.x, oy: o.y, ow: o.w, oh: o.h, startX: x, startY: y };
      } else if (hh && hh.type==='rotate') {
        const cx = o.x + o.w/2; const cy = o.y + o.h/2;
        drag = { obj: o, mode: 'rotate', cx, cy };
      } else {
        drag = { obj: o, dx: x - o.x, dy: y - o.y, mode: 'move' };
      }
    } else {
      state.selection = null; syncProps();
    }
    canvas.setPointerCapture?.(e.pointerId);
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    movedDuringPress = true;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.viewScale;
    const y = (e.clientY - rect.top) / state.viewScale;
    if (drag.mode==='move') {
      drag.obj.x = Math.round(x - drag.dx);
      drag.obj.y = Math.round(y - drag.dy);
      if (state.snapEnabled) {
        const tol = 4;
        const candV = [state.widthDots/2];
        const candH = [state.heightDots/2];
        for (const o of state.objects) {
          if (o === drag.obj) continue;
          candV.push(o.x, o.x + o.w/2, o.x + o.w);
          candH.push(o.y, o.y + o.h/2, o.y + o.h);
        }
        let guides = [];
        const L = drag.obj.x, Cx = drag.obj.x + drag.obj.w/2, R = drag.obj.x + drag.obj.w;
        const T = drag.obj.y, Cy = drag.obj.y + drag.obj.h/2, B = drag.obj.y + drag.obj.h;
        let bestDx = 0, bestDy = 0, bestAx = tol+1, bestAy = tol+1, snapX=null, snapY=null;
        for (const v of candV) {
          for (const a of [L, Cx, R]) {
            const d = Math.abs(a - v);
            if (d < bestAx && d <= tol) { bestAx = d; bestDx = v - a; snapX = v; }
          }
        }
        for (const h of candH) {
          for (const a of [T, Cy, B]) {
            const d = Math.abs(a - h);
            if (d < bestAy && d <= tol) { bestAy = d; bestDy = h - a; snapY = h; }
          }
        }
        if (bestAx <= tol) drag.obj.x += Math.round(bestDx);
        if (bestAy <= tol) drag.obj.y += Math.round(bestDy);
        guides = [];
        if (snapX != null) guides.push({type:'v', pos: snapX});
        if (snapY != null) guides.push({type:'h', pos: snapY});
        currentGuides = guides;
      } else {
        currentGuides = [];
      }
      draw(); syncProps();
    } else if (drag.mode==='resize') {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      let {ox, oy, ow, oh} = drag;
      if (drag.dir==='se') { drag.obj.w = Math.max(1, Math.round(ow + dx)); drag.obj.h = Math.max(1, Math.round(oh + dy)); }
      if (drag.dir==='sw') { drag.obj.x = Math.round(ox + dx); drag.obj.w = Math.max(1, Math.round(ow - dx)); drag.obj.h = Math.max(1, Math.round(oh + dy)); }
      if (drag.dir==='ne') { drag.obj.y = Math.round(oy + dy); drag.obj.h = Math.max(1, Math.round(oh - dy)); drag.obj.w = Math.max(1, Math.round(ow + dx)); }
      if (drag.dir==='nw') { drag.obj.x = Math.round(ox + dx); drag.obj.y = Math.round(oy + dy); drag.obj.w = Math.max(1, Math.round(ow - dx)); drag.obj.h = Math.max(1, Math.round(oh - dy)); }
      currentGuides = [];
      draw(); syncProps();
    } else if (drag.mode==='rotate') {
      const ang = Math.atan2(y - drag.cy, x - drag.cx);
      drag.obj.rotation = Math.round((ang * 180 / Math.PI));
      currentGuides = [];
      draw();
    }
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', (e)=>{
    const now = Date.now();
    const wasDrag = movedDuringPress;
    currentGuides=[]; canvas.releasePointerCapture?.(e.pointerId); endDrag(); draw();
    // Double-tap to edit text
    if (!wasDrag && state.selection && state.selection.type==='text') {
      if (lastTapObj === state.selection && (now - lastTapTime) < 300) {
        startTextEdit(state.selection);
        lastTapTime = 0; lastTapObj = null;
        return;
      }
      lastTapTime = now; lastTapObj = state.selection;
    }
  });
  canvas.addEventListener('pointercancel', (e)=>{ currentGuides=[]; canvas.releasePointerCapture?.(e.pointerId); endDrag(); draw(); });

  function startTextEdit(obj) {
    // Position edit box over the text object's box in viewport coordinates
    const canvasRect = canvas.getBoundingClientRect();
    const vv = window.visualViewport;
    const scale = state.viewScale;
    const vvOffX = vv ? vv.offsetLeft : 0;
    const vvOffY = vv ? vv.offsetTop  : 0;
    const left = (canvasRect.left - vvOffX) + obj.x * scale;
    const top  = (canvasRect.top  - vvOffY) + obj.y * scale;

    editBox.style.display = 'block';
    editBox.style.left = `${Math.round(left)}px`;
    editBox.style.top = `${Math.round(top)}px`;
    editBox.style.width = `${Math.round((obj.w||200) * scale)}px`;
    const lineH = (obj.size||24) * 1.4;
    const boxH = Math.max(obj.h||lineH*2, lineH*2);
    editBox.style.height = `${Math.round(boxH * scale)}px`;
    editBox.style.fontWeight = obj.bold ? '700' : '400';
    editBox.style.fontSize = `${Math.max(16, Math.round((obj.size||24) * scale))}px`;
    editBox.style.lineHeight = `${Math.round(lineH * scale)}px`;
    editBox.value = obj.text || '';

    try { editBox.focus({ preventScroll: true }); } catch (_) { editBox.focus(); }
    editBox.setSelectionRange(editBox.value.length, editBox.value.length);

    // Reposition on viewport (keyboard) changes
    const relayout = () => {
      const cr = canvas.getBoundingClientRect();
      const offX = vv ? vv.offsetLeft : 0;
      const offY = vv ? vv.offsetTop  : 0;
      let l = (cr.left - offX) + obj.x * scale;
      let t = (cr.top  - offY) + obj.y * scale;
      // Keep within visible viewport height to avoid being hidden by keyboard
      const ebH = editBox.getBoundingClientRect().height || parseFloat(editBox.style.height)||44;
      const maxY = (vv ? vv.height : window.innerHeight) - 8 - ebH;
      if (t > maxY) t = Math.max(8, maxY);
      editBox.style.left = `${Math.round(l)}px`;
      editBox.style.top = `${Math.round(t)}px`;
    };
    if (vv) {
      vv.addEventListener('resize', relayout);
      vv.addEventListener('scroll', relayout);
    }
    const finish = () => {
      obj.text = editBox.value;
      editBox.style.display = 'none';
      if (vv) {
        vv.removeEventListener('resize', relayout);
        vv.removeEventListener('scroll', relayout);
      }
      editBox.removeEventListener('blur', finish);
      editBox.removeEventListener('keydown', onKey);
      draw(); syncProps();
    };
    const onKey = (ev) => {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); finish(); }
    };
    editBox.addEventListener('blur', finish);
    editBox.addEventListener('keydown', onKey);
  }

  // Toolbar events
  $('#addText').addEventListener('click', addText);
  $('#addRect').addEventListener('click', addRect);
  $('#addImage').addEventListener('click', () => $('#imgInput').click());
  $('#imgInput').addEventListener('change', (e) => { const f=e.target.files&&e.target.files[0]; if (f) addImageFromFile(f); e.target.value=''; });
  mediaSel.addEventListener('change', () => setMedia(mediaSel.value));

  $('#undoBtn').addEventListener('click', () => {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    state = JSON.parse(undoStack.pop());
    resizeCanvasToContainer();
    draw(); syncProps();
  });
  $('#redoBtn').addEventListener('click', () => {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    state = JSON.parse(redoStack.pop());
    resizeCanvasToContainer();
    draw(); syncProps();
  });
  $('#clearBtn').addEventListener('click', () => { pushUndo(); state.objects = []; state.selection = null; draw(); syncProps(); });

  // Properties
  ['propText','propSize','propX','propY','propW','propH'].forEach(id => {
    $(`#${id}`).addEventListener('input', () => applyProps());
  });
  const boldEl = $('#propBold'); if (boldEl) boldEl.addEventListener('change', applyProps);
  const sizeRange2 = $('#propSizeRange'); if (sizeRange2) sizeRange2.addEventListener('input', (e)=>{ $('#propSize').value=e.target.value; applyProps(); });

  // Snap toggle
  const snapToggle = $('#snapToggle');
  if (snapToggle) { snapToggle.checked = !!state.snapEnabled; snapToggle.addEventListener('change', ()=>{ state.snapEnabled = !!snapToggle.checked; currentGuides=[]; draw(); }); }
  const sizeRange = $('#propSizeRange'); if (sizeRange) sizeRange.addEventListener('input', (e)=>{ const v=e.target.value; $('#propSize').value=v; applyProps(); });

  async function exportToBlob() {
    // For continuous80, extend height to content bottom
    let heightDots = state.heightDots;
    if (state.media === 'continuous80') {
      let bottom = 0;
      for (const o of state.objects) bottom = Math.max(bottom, o.y + o.h);
      heightDots = Math.max(1, Math.min(4000, Math.round(bottom + 8))); // add tiny margin
    }
    const off = document.createElement('canvas');
    off.width = state.widthDots;
    off.height = heightDots;
    const oc = off.getContext('2d');
    renderDesignToCanvas(oc, serializeDesign());
    return new Promise((resolve) => off.toBlob((b)=>resolve(b), 'image/png'));
  }
  function wrapTextOff(oc, text, x, y, maxWidth, lineHeight) {
    if (!text) return;
    const words = (text+"").split(/\s+/);
    let line = '';
    for (let n=0; n<words.length; n++) {
      const test = line ? line + ' ' + words[n] : words[n];
      const m = oc.measureText(test);
      if (m.width > maxWidth && n>0) {
        oc.fillText(line, x, y);
        line = words[n];
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) oc.fillText(line, x, y);
  }

  async function doPreview() {
    try {
      setStatus('Generating preview…');
      const blob = await exportToBlob();
      const fd = new FormData();
      fd.append('file', blob, 'design.png');
      fd.append('media', state.media);
      const res = await fetch('/preview', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Preview failed');
      const out = await res.blob();
      const url = URL.createObjectURL(out);
      const img = $('#previewImg');
      img.src = url; img.style.display = '';
      setStatus('Preview updated', 'ok');
    } catch (e) {
      console.error(e);
      setStatus('Error: '+e.message, 'err');
    }
  }
  async function doPrint() {
    try {
      setStatus('Sending to printer…');
      const blob = await exportToBlob();
      const fd = new FormData();
      fd.append('file', blob, 'design.png');
      fd.append('media', state.media);
      fd.append('lang', 'EPL');
      const res = await fetch('/print', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text() || 'Print failed');
      const data = await res.json().catch(()=>({status:'ok'}));
      setStatus(data && data.mode==='test' ? `Test OK` : 'Printed', 'ok');
    } catch (e) {
      console.error(e);
      setStatus('Error: '+e.message, 'err');
    }
  }

  $('#previewBtn').addEventListener('click', doPreview);
  $('#printBtn').addEventListener('click', doPrint);

  // --- Library (LocalStorage) ---
  function loadLibraryList() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.list) || '[]'); } catch { return []; }
  }
  function saveLibraryList(list) {
    localStorage.setItem(STORAGE_KEYS.list, JSON.stringify(list));
  }
  function loadDesignById(id) {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.design(id)) || 'null'); } catch { return null; }
  }
  function saveDesignById(id, design) {
    localStorage.setItem(STORAGE_KEYS.design(id), JSON.stringify(design));
  }

  let currentDesignId = null;

  function openLibrary() {
    libModal.style.display = 'block'; libModal.setAttribute('aria-hidden','false');
    renderLibraryList();
  }
  function closeLibrary() {
    libModal.style.display = 'none'; libModal.setAttribute('aria-hidden','true');
  }
  function renderLibraryList() {
    const list = loadLibraryList();
    const box = document.getElementById('libList');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div style="font-size:13px;color:var(--muted,#999)">No saved designs yet.</div>'; return; }
    for (const item of list) {
      const row = document.createElement('div');
      row.style.display='grid'; row.style.gridTemplateColumns='auto 1fr auto auto'; row.style.gap='8px'; row.style.alignItems='center';
      row.innerHTML = `
        <input type="checkbox" data-id="${item.id}" class="libChk"/>
        <div>
          <div style="font-weight:600; font-size:14px;">${item.name || '(unnamed)'}</div>
          <div style="font-size:12px; color:var(--muted,#888)">${item.media} • ${new Date(item.updated_at).toLocaleString()}</div>
        </div>
        <input type="number" min="1" max="100" value="1" style="width:64px" data-q-id="${item.id}"/>
        <div style="display:flex; gap:6px;">
          <button class="icon-btn" data-open-id="${item.id}">Open</button>
          <button class="icon-btn" data-del-id="${item.id}">Delete</button>
        </div>
      `;
      box.appendChild(row);
    }
    box.querySelectorAll('[data-open-id]').forEach(btn => btn.addEventListener('click', (e)=>{
      const id = e.target.getAttribute('data-open-id');
      const d = loadDesignById(id); if (d) { applyDesign(d); currentDesignId = id; setStatus('Design loaded','ok'); }
    }));
    box.querySelectorAll('[data-del-id]').forEach(btn => btn.addEventListener('click', (e)=>{
      const id = e.target.getAttribute('data-del-id');
      const list2 = loadLibraryList().filter(x => x.id !== id); saveLibraryList(list2);
      localStorage.removeItem(STORAGE_KEYS.design(id)); renderLibraryList();
    }));
  }

  async function exportCurrentJSON() {
    const design = serializeDesign({ id: currentDesignId });
    const blob = new Blob([JSON.stringify(design,null,2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (design.media||'label') + '.json'; a.click();
  }
  function importJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const design = JSON.parse(reader.result);
        const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        const name = design.name || `Imported ${new Date().toLocaleString()}`;
        const meta = { id, name, media: design.media, updated_at: Date.now() };
        const list = loadLibraryList(); list.unshift(meta); saveLibraryList(list);
        saveDesignById(id, design);
        renderLibraryList(); setStatus('Imported','ok');
      } catch (e) { setStatus('Import failed','err'); }
    };
    reader.readAsText(file);
  }

  async function batchPrintSelected() {
    const list = loadLibraryList();
    const checks = Array.from(document.querySelectorAll('.libChk:checked'));
    if (!checks.length) { document.getElementById('libStatus').textContent = 'No designs selected'; return; }
    let total = 0; const items = [];
    for (const chk of checks) {
      const id = chk.getAttribute('data-id');
      const qEl = document.querySelector(`[data-q-id="${id}"]`);
      const qty = Math.max(1, Math.min(100, parseInt(qEl.value||'1',10)||1));
      total += qty; items.push({ id, qty });
    }
    if (total > 100) { document.getElementById('libStatus').textContent = 'Too many labels (max 100)'; return; }
    const status = document.getElementById('libStatus');
    status.textContent = `Printing ${total}…`;
    for (const it of items) {
      const d = loadDesignById(it.id); if (!d) continue;
      for (let i=0;i<it.qty;i++) {
        // Render to blob from design
        const off = document.createElement('canvas');
        const mm = MEDIA_MAP[d.media] || { w: d.widthDots, h: d.heightDots };
        off.width = mm.w; off.height = (d.media==='continuous80')? Math.max(1, Math.min(4000, Math.round((d.objects||[]).reduce((a,o)=>Math.max(a,o.y+o.h),0)+8))) : mm.h;
        const oc = off.getContext('2d');
        renderDesignToCanvas(oc, { ...d, widthDots: off.width, heightDots: off.height });
        const blob = await new Promise((resolve)=> off.toBlob((b)=>resolve(b), 'image/png'));
        const fd = new FormData(); fd.append('file', blob, 'design.png'); fd.append('media', d.media); fd.append('lang','EPL');
        const res = await fetch('/print', { method:'POST', body: fd });
        if (!res.ok) { status.textContent = 'Print failed'; return; }
        await new Promise(r=>setTimeout(r, 120));
      }
    }
    status.textContent = 'Printed';
  }

  // Library UI wiring
  const libBtn = document.getElementById('libraryBtn'); if (libBtn) libBtn.addEventListener('click', openLibrary);
  const libClose = document.getElementById('closeLibrary'); if (libClose) libClose.addEventListener('click', closeLibrary);
  const saveAsBtn = document.getElementById('saveAsBtn'); if (saveAsBtn) saveAsBtn.addEventListener('click', ()=>{
    const name = prompt('Design name?') || 'Label';
    const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    const meta = { id, name, media: state.media, updated_at: Date.now() };
    const list = loadLibraryList(); list.unshift(meta); saveLibraryList(list);
    const design = serializeDesign({ id, name }); saveDesignById(id, design); currentDesignId = id;
    renderLibraryList(); setStatus('Saved','ok');
  });
  const saveBtn = document.getElementById('saveBtn'); if (saveBtn) saveBtn.addEventListener('click', ()=>{
    if (!currentDesignId) return document.getElementById('saveAsBtn').click();
    const list = loadLibraryList();
    const idx = list.findIndex(x => x.id === currentDesignId);
    const name = (idx>=0 ? list[idx].name : 'Label');
    const meta = { id: currentDesignId, name, media: state.media, updated_at: Date.now() };
    if (idx>=0) list[idx] = meta; else list.unshift(meta);
    saveLibraryList(list);
    saveDesignById(currentDesignId, serializeDesign({ id: currentDesignId, name }));
    renderLibraryList(); setStatus('Saved','ok');
  });
  const exportBtn = document.getElementById('exportBtn'); if (exportBtn) exportBtn.addEventListener('click', exportCurrentJSON);
  const importBtn = document.getElementById('importBtn'); if (importBtn) importBtn.addEventListener('click', ()=> document.getElementById('importInput').click());
  const importInput = document.getElementById('importInput'); if (importInput) importInput.addEventListener('change', (e)=>{ const f=e.target.files&&e.target.files[0]; if (f) importJSONFile(f); e.target.value=''; });
  const printSelBtn = document.getElementById('printSelectedBtn'); if (printSelBtn) printSelBtn.addEventListener('click', batchPrintSelected);

  // Init
  function init() {
    setMedia(mediaSel.value);
    resizeCanvasToContainer();
    draw();
    window.addEventListener('resize', () => { resizeCanvasToContainer(); draw(); });
    setStatus('Ready');

    // Templates
    const templates = {
      t_50x30_basic: (w,h) => ([
        { type:'text', x:10, y:10, w:w-20, h:40, text:'Title', size:34, bold:true, align:'left' },
        { type:'text', x:10, y:60, w:w-20, h:30, text:'Subtitle', size:22, bold:false, align:'left' },
      ]),
      t_100x150_basic: (w,h) => ([
        { type:'text', x:40, y:40, w:w-80, h:60, text:'Large Title', size:48, bold:true, align:'center' },
        { type:'rect', x:60, y:120, w:w-120, h:4, fill:true },
      ]),
    };
    const applyBtn = document.querySelector('#applyTemplate');
    if (applyBtn) applyBtn.addEventListener('click', ()=>{
      const key = document.querySelector('#templateSel').value; if (!key) return;
      const tpl = templates[key]; if (!tpl) return;
      pushUndo();
      state.objects = tpl(state.widthDots, state.heightDots);
      state.selection = null;
      draw(); syncProps();
    });
  }
  init();
})();
