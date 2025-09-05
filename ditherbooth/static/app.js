(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  // status helper writes to both uploader and output areas

  let selectedFile = null;
  let publicConfig = null;

  function setStatus(msg, cls = '') {
    ['#status', '#outputMsg'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.textContent = msg || '';
      el.className = `status ${cls}`.trim();
    });
  }

  let isPrinting = false;

  function showProgress(on) {
    ['#status', '#outputMsg'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.innerHTML = on ? '<div class="progress"><div class="bar"></div></div>' : '';
      el.className = 'status';
    });
  }

  async function loadPublicConfig() {
    try {
      const res = await fetch('/api/public-config');
      if (!res.ok) throw new Error('Failed to load config');
      publicConfig = await res.json();
      // Apply defaults
      $('#media').value = publicConfig.default_media;
      $('#lang').value = publicConfig.default_lang;
      // Lock controls if requested
      const controls = $('#controls');
      const uploader = $('#uploaderSection');
      const outputActions = $('#outputActions');
      if (publicConfig.lock_controls) {
        controls.style.display = 'none';
        // Hide uploader section for kiosk/phone-first simplicity
        uploader.style.display = 'none';
        // Provide actions in the output card
        ensureOutputActions(outputActions);
      } else {
        controls.style.display = '';
        uploader.style.display = '';
        // Clear output actions if present
        outputActions.innerHTML = '';
      }
    } catch (e) {
      console.error(e);
    }
  }

  function previewFile(file) {
    const preview = $('#preview');
    preview.innerHTML = '';
    if (!file) {
      preview.innerHTML = '<span class="placeholder">Drop an image or click to choose</span>';
      return;
    }
    const img = document.createElement('img');
    img.alt = 'Selected image preview';
    preview.appendChild(img);
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.readAsDataURL(file);
  }

  function setSelectedFile(file) {
    selectedFile = file;
    previewFile(file);
    updatePreviews();
    togglePrintEnabled(true);
  }

  async function fetchSampleFile() {
    const res = await fetch('/static/examples/original.png');
    const blob = await res.blob();
    return new File([blob], 'sample.png', { type: blob.type || 'image/png' });
  }

  async function doPrint() {
    if (isPrinting) return; // prevent double submits
    if (!selectedFile) {
      setStatus('Select an image first', 'err');
      return;
    }
    isPrinting = true;
    togglePrintEnabled(false);
    document.body.setAttribute('aria-busy', 'true');
    showProgress(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    // Always append; the API uses defaults if omitted
    formData.append('media', $('#media').value);
    formData.append('lang', $('#lang').value);
    setStatus('Sending to printer…');
    try {
      const res = await fetch('/print', { method: 'POST', body: formData });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || 'Request failed');
      }
      const data = await res.json();
      if (data && data.mode === 'test') setStatus(`Test OK (${data.bytes} bytes)`, 'ok');
      else setStatus('Sent to printer', 'ok');
    } catch (e) {
      console.error(e);
      setStatus('Error: ' + e.message, 'err');
    } finally {
      isPrinting = false;
      showProgress(false);
      document.body.removeAttribute('aria-busy');
      togglePrintEnabled(!!selectedFile);
    }
  }

  function setupUploader() {
    const drop = $('#dropArea');
    const fileInput = $('#file');
    drop.addEventListener('click', () => fileInput.click());
    $('#chooseBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) setSelectedFile(file);
    });
    ;['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
    ;['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragging'); }));
    drop.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        setSelectedFile(dt.files[0]);
      }
    });
  }

  function setupActions() {
    const printBtn = $('#printBtn');
    printBtn.addEventListener('click', doPrint);
    togglePrintEnabled(true);
    $('#sampleBtn').addEventListener('click', async () => {
      try { setSelectedFile(await fetchSampleFile()); setStatus('Loaded sample image'); } catch (e) { setStatus('Failed to load sample', 'err'); }
    });
  }

  function setupSettings() {
    const modal = $('#settingsModal');
    const open = () => { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); };
    const close = () => { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); };
    $('#settingsBtn').addEventListener('click', open);
    $('#closeModal').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });

    const msg = $('#settingsMsg');
    const form = $('#settingsForm');
    const pwdInput = $('#devPassword');
    const headers = () => ({ 'X-Dev-Password': pwdInput.value || '' });

    async function connect() {
      msg.textContent = '';
      try {
        const res = await fetch('/api/dev/settings', { headers: headers() });
        if (res.status === 401 || res.status === 403) throw new Error('Auth failed');
        if (!res.ok) throw new Error('Failed to load settings');
        const data = await res.json();
        const cfg = data.config || {};
        $('#testMode').checked = !!cfg.test_mode;
        $('#lockControls').checked = !!cfg.lock_controls;
        $('#defMedia').value = cfg.default_media || 'continuous58';
        $('#defLang').value = cfg.default_lang || 'EPL';
        $('#printerName').value = cfg.printer_name || '';
        $('#testDelay').value = (cfg.test_mode_delay_ms ?? 0);
        $('#eplDarkness').value = (cfg.epl_darkness ?? '');
        $('#eplSpeed').value = (cfg.epl_speed ?? '');
        form.hidden = false;
        msg.textContent = 'Connected';
        msg.className = 'status ok';
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'status err';
        form.hidden = true;
      }
    }
    $('#connectSettings').addEventListener('click', connect);

    async function save() {
      msg.textContent = '';
      const body = {
        test_mode: $('#testMode').checked,
        lock_controls: $('#lockControls').checked,
        default_media: $('#defMedia').value,
        default_lang: $('#defLang').value,
        printer_name: $('#printerName').value.trim() || null,
        test_mode_delay_ms: parseInt($('#testDelay').value || '0', 10) || 0,
        epl_darkness: (function(){ const v=$('#eplDarkness').value.trim(); return v === '' ? null : parseInt(v,10); })(),
        epl_speed: (function(){ const v=$('#eplSpeed').value.trim(); return v === '' ? null : parseInt(v,10); })(),
      };
      try {
        const res = await fetch('/api/dev/settings', {
          method: 'PUT',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 401 || res.status === 403) throw new Error('Auth failed');
        if (!res.ok) throw new Error('Save failed');
        await res.json();
        msg.textContent = 'Saved';
        msg.className = 'status ok';
        // Refresh public config to reflect new defaults/locks
        await loadPublicConfig();
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'status err';
      }
    }
    $('#saveSettings').addEventListener('click', save);
  }

  window.addEventListener('DOMContentLoaded', async () => {
    setupUploader();
    setupActions();
    setupSettings();
    await loadPublicConfig();
    $('#media').addEventListener('change', updatePreviews);
    observeOutputResize();
  });

  async function updatePreviews() {
    if (!selectedFile) {
      drawOutput(null);
      return;
    }
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('media', $('#media').value);
    try {
      const res = await fetch('/preview', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Preview failed');
      const blob = await res.blob();
      drawOutput(blob);
    } catch (e) {
      console.error(e);
      setStatus('Preview error: ' + e.message, 'err');
      drawOutput(null);
    }
  }

  async function drawOutput(blob) {
    if (blob !== null) {
      lastBlob = blob;
    }
    const frame = $('#outputFrame');
    const canvas = $('#outputCanvas');
    const msg = $('#outputMsg');
    const media = $('#media').value;

    // Configure frame sizing per media
    // Use container inner width (content box) for responsive sizing
    const cs = getComputedStyle(frame);
    const paddingX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    let widthPx = Math.max(200, (frame.clientWidth || 320) - paddingX);
    if (media === 'label100x150') {
      frame.classList.add('label');
      frame.classList.remove('roll');
    } else {
      frame.classList.add('roll');
      frame.classList.remove('label');
    }

    if (!lastBlob) {
      msg.textContent = 'No preview yet';
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    msg.textContent = '';

    // Load image
    let bmp;
    if ('createImageBitmap' in window) {
      bmp = await createImageBitmap(lastBlob);
    } else {
      bmp = await blobToBitmap(lastBlob);
    }

    // DPI-aware crisp scaling
    const dpr = window.devicePixelRatio || 1;
    const scale = widthPx / bmp.width;
    const displayW = Math.round(bmp.width * scale);
    const displayH = Math.round(bmp.height * scale);
    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayW, displayH);
    ctx.drawImage(bmp, 0, 0, displayW, displayH);
  }

  // Provide actions inside Output card when uploader is hidden
  function ensureOutputActions(container) {
    if (!container || container.childElementCount) return;
    const choose = document.createElement('button');
    choose.id = 'chooseBtn2';
    choose.className = 'secondary';
    choose.textContent = 'Choose Image';
    const sample = document.createElement('button');
    sample.id = 'sampleBtn2';
    sample.className = 'secondary';
    sample.textContent = 'Use Sample Image';
    const print = document.createElement('button');
    print.id = 'printBtn2';
    print.className = 'primary';
    print.textContent = 'Print';
    container.appendChild(choose);
    container.appendChild(sample);
    container.appendChild(print);
    choose.addEventListener('click', () => document.querySelector('#file').click());
    sample.addEventListener('click', async () => {
      try { setSelectedFile(await fetchSampleFile()); setStatus('Loaded sample image'); } catch (e) { setStatus('Failed to load sample', 'err'); }
    });
    print.addEventListener('click', doPrint);
  }

  // Keep canvas crisp and responsive to container resize
  let lastBlob = null;
  function observeOutputResize() {
    const frame = document.querySelector('#outputFrame');
    if (!('ResizeObserver' in window) || !frame) return;
    const ro = new ResizeObserver(() => {
      if (lastBlob) drawOutput(lastBlob);
    });
    ro.observe(frame);
  }

  function togglePrintEnabled(on) {
    const btn = document.querySelector('#printBtn');
    if (btn) btn.disabled = !on;
    const btn2 = document.querySelector('#printBtn2');
    if (btn2) btn2.disabled = !on;
  }

  function blobToBitmap(blob) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = URL.createObjectURL(blob);
    });
  }
})();
