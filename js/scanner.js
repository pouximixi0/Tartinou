// Scanner de codes-barres : caméra + BarcodeDetector natif, repli ZXing (CDN,
// mis en cache par le service worker), photo d'un code-barres, ou saisie au
// clavier. Tout aboutit à onCode(code, api).
import { h, icon, toast } from './utils.js';
import { getState } from './store.js';
import { openDialog } from './components/dialog.js';

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
const CODE_RE = /^\d{8,14}$/;
let zxingModule = null;
let audioCtx = null;

async function loadZxing() {
  if (zxingModule) return zxingModule;
  try { zxingModule = await import(ZXING_URL); } catch { zxingModule = null; }
  return zxingModule;
}

export const cameraAvailable = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 1320;
    gain.gain.value = 0.12;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.09);
  } catch {}
}

/**
 * Ouvre le scanner plein écran.
 * @param {object} o
 * @param {(code: string, api: object) => void} o.onCode
 * @param {Array<{id: string, label: string}>} [o.modes]  segments Ajouter / Retirer
 * @param {string} [o.mode]
 * @param {(mode: string) => void} [o.onModeChange]
 * @param {() => void} [o.onClose]
 * Retourne api = { pause, resume, close, setStatus, mode }.
 */
export function openScanner({ onCode, modes = null, mode = 'ajout', onModeChange, onClose, title = 'Scanner' } = {}) {
  const st = getState().settings.stock;
  let stream = null, detector = null, zxControls = null, timer = null;
  let running = true, paused = false, lastCode = '', lastAt = 0, torchTrack = null, torchOn = false, engine = 'none';
  let currentMode = mode;

  const video = h('video', { class: 'scan-video', autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const status = h('p', { class: 'scan-status', role: 'status' }, '');
  const noCam = h('div', { class: 'scan-nocam', hidden: true }, icon('camera'), h('p', null, ''));
  const frame = h('div', { class: 'scan-frame', 'aria-hidden': 'true' });
  const view = h('div', { class: 'scan-view' }, video, frame, noCam);

  const torchBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', hidden: true, 'aria-pressed': 'false', onclick: toggleTorch }, icon('flash'), 'Lampe');
  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', id: 'scan-file',
    onchange: async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) await decodeFile(f); } });
  const tools = h('div', { class: 'scan-tools' },
    torchBtn,
    fileInput,
    h('label', { for: 'scan-file', class: 'btn btn-secondary btn-sm' }, icon('image'), 'Photo'),
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: manualEntry }, icon('keyboard'), 'Saisir le code'),
  );

  const modeBar = modes
    ? h('div', { class: 'segmented scan-modes', role: 'radiogroup', 'aria-label': 'Mode' }, modes.map((m) =>
        h('label', { class: 'seg' },
          h('input', { type: 'radio', name: 'scan-mode', value: m.id, checked: m.id === currentMode, onchange: () => { currentMode = m.id; onModeChange?.(m.id); setStatus(m.id === 'retrait' ? 'Scanne un produit à retirer' : 'Vise le code-barres'); } }),
          h('span', null, m.label))))
    : null;

  const dlg = h('dialog', { class: 'sheet sheet-scan', 'aria-labelledby': 'scan-title' },
    h('header', { class: 'sheet-head' },
      h('h2', { id: 'scan-title', class: 'sheet-title' }, title),
      h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer le scanner', onclick: close }, icon('x'))),
    h('div', { class: 'sheet-body scan-body' },
      modeBar,
      view,
      status,
      tools,
      h('p', { class: 'muted small' }, 'Code-barres EAN des produits du commerce. Sans caméra : prends-le en photo ou tape les chiffres.')),
  );

  function setStatus(msg) { status.textContent = msg || ''; }
  function showNoCam(msg) {
    video.hidden = true; frame.hidden = true;
    noCam.hidden = false; noCam.querySelector('p').textContent = msg;
    setStatus('');
  }

  async function start() {
    if (!cameraAvailable()) return showNoCam('Ce navigateur ne donne pas accès à la caméra. Prends le code en photo ou saisis-le.');
    setStatus('Démarrage de la caméra…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (err) {
      return showNoCam(err && err.name === 'NotAllowedError'
        ? 'Accès à la caméra refusé. Autorise-la dans les réglages du navigateur, ou saisis le code.'
        : 'Caméra indisponible (elle exige une connexion HTTPS). Prends le code en photo ou saisis-le.');
    }
    if (!running) return stopStream();
    video.srcObject = stream;
    try { await video.play(); } catch {}
    setupTorch();
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = FORMATS.filter((f) => supported.includes(f));
        detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
        engine = 'native';
        setStatus('Vise le code-barres');
        tick();
        return;
      } catch { detector = null; }
    }
    setStatus('Chargement du lecteur…');
    const zx = await loadZxing();
    if (!running) return;
    if (!zx || !zx.BrowserMultiFormatReader) return showNoCam('Lecteur de codes-barres indisponible hors connexion. Saisis le code à la main.');
    try {
      const reader = new zx.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 1200 });
      zxControls = await reader.decodeFromStream(stream, video, (result) => { if (result) handle(result.getText()); });
      engine = 'zxing';
      setStatus('Vise le code-barres');
    } catch (err) {
      console.warn('ZXing', err);
      showNoCam('Le lecteur n’a pas pu démarrer. Saisis le code à la main.');
    }
  }

  async function tick() {
    if (!running) return;
    if (!paused && detector && video.readyState >= 2) {
      try {
        const codes = await detector.detect(video);
        if (codes.length) handle(codes[0].rawValue);
      } catch {}
    }
    timer = setTimeout(tick, 130);
  }

  function handle(raw, { manual = false } = {}) {
    const code = String(raw || '').replace(/\s/g, '');
    if (!CODE_RE.test(code)) { if (manual) toast('Un code-barres comporte 8 à 13 chiffres.'); else setStatus('Code non reconnu, réessaie'); return; }
    if (paused) return;
    const now = Date.now();
    if (!manual && code === lastCode && now - lastAt < 2500) return;
    lastCode = code; lastAt = now;
    if (st.vibration && navigator.vibrate) navigator.vibrate(60);
    if (st.son) beep();
    onCode?.(code, api);
  }

  function setupTorch() {
    const track = stream && stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : null;
    if (caps && caps.torch) { torchTrack = track; torchBtn.hidden = false; }
  }
  async function toggleTorch() {
    if (!torchTrack) return;
    torchOn = !torchOn;
    try { await torchTrack.applyConstraints({ advanced: [{ torch: torchOn }] }); torchBtn.setAttribute('aria-pressed', String(torchOn)); }
    catch { toast('Lampe indisponible sur cet appareil'); }
  }

  async function decodeFile(file) {
    setStatus('Lecture de la photo…');
    try {
      if ('BarcodeDetector' in window) {
        const det = detector || new window.BarcodeDetector();
        const bmp = await createImageBitmap(file);
        const codes = await det.detect(bmp);
        if (bmp.close) bmp.close();
        if (codes.length) return handle(codes[0].rawValue, { manual: true });
      } else {
        const zx = await loadZxing();
        if (zx && zx.BrowserMultiFormatReader) {
          const url = URL.createObjectURL(file);
          try { const res = await new zx.BrowserMultiFormatReader().decodeFromImageUrl(url); if (res) return handle(res.getText(), { manual: true }); }
          finally { URL.revokeObjectURL(url); }
        }
      }
    } catch {}
    toast('Aucun code-barres lisible sur cette photo. Rapproche-toi et évite les reflets.');
    setStatus(engine === 'none' ? '' : 'Vise le code-barres');
  }

  function manualEntry() {
    const input = h('input', { type: 'text', id: 'scan-manual', class: 'input input-big num', inputmode: 'numeric', pattern: '[0-9]*', placeholder: '3017620422003', autocomplete: 'off', maxlength: '14' });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const d = openDialog({
      title: 'Saisir le code-barres',
      cls: 'sheet-compact',
      content: [h('div', { class: 'field' }, h('label', { for: 'scan-manual' }, 'Les chiffres sous les barres'), input), err],
      actions: [
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => d.close() }, 'Annuler'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: ok }, 'Valider'),
      ],
    });
    function ok() {
      const c = input.value.replace(/\D/g, '');
      if (!CODE_RE.test(c)) { err.textContent = 'Le code comporte 8 à 13 chiffres (parfois 14).'; err.hidden = false; input.focus(); return; }
      d.close();
      handle(c, { manual: true });
    }
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } });
    setTimeout(() => input.focus(), 50);
  }

  function stopStream() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  function pause() { paused = true; setStatus('En pause'); }
  function resume() { paused = false; lastAt = Date.now(); setStatus(currentMode === 'retrait' ? 'Scanne un produit à retirer' : 'Vise le code-barres'); }
  function close() {
    if (!running) return;
    running = false;
    clearTimeout(timer);
    try { if (zxControls) zxControls.stop(); } catch {}
    stopStream();
    if (dlg.open) dlg.close();
  }

  const api = { pause, resume, close, setStatus, get mode() { return currentMode; } };

  dlg.addEventListener('close', () => { close(); dlg.remove(); onClose?.(); });
  document.body.append(dlg);
  dlg.showModal();
  start();
  return api;
}

/** Un seul scan : résout le code (ou null si fermé sans rien lire). */
export function scanOnce(title = 'Scanner le code-barres') {
  return new Promise((resolve) => {
    let done = false;
    openScanner({ title, onCode: (code, api) => { done = true; api.close(); resolve(code); }, onClose: () => { if (!done) resolve(null); } });
  });
}
