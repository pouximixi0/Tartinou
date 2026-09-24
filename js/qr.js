// Étiquettes QR à imprimer (bocaux, portions congelées). Le générateur de QR est
// chargé à la demande depuis jsDelivr et mis en cache par le service worker.
import { h, fmtDate } from './utils.js';
import { emplacementById, fmtQte } from './stock.js';

const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let loading = null;

export const LABEL_PREFIX = 'tartinou:item:';
export const isLabelCode = (raw) => typeof raw === 'string' && raw.startsWith(LABEL_PREFIX);
export const itemIdFromLabel = (raw) => (isLabelCode(raw) ? raw.slice(LABEL_PREFIX.length) : null);

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!loading) loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_URL;
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { loading = null; reject(new Error('Générateur de QR indisponible hors ligne.')); };
    document.head.append(s);
  });
  return loading;
}

/** SVG d'un QR pour `text` (chaîne), en tant que balise. */
export async function qrSvg(text, size = 128) {
  const qrcode = await loadQr();
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / (n + 8);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${(c + 4) * cell},${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Ouvre une page d'impression avec une étiquette par article. */
export async function printLabels(items) {
  const svgs = await Promise.all(items.map((it) => qrSvg(LABEL_PREFIX + it.id, 140)));
  const cards = items.map((it, i) => `
    <div class="label">
      ${svgs[i]}
      <div class="txt">
        <strong>${escapeHtml(it.nom)}</strong>
        <span>${escapeHtml(fmtQte(it))} · ${escapeHtml(emplacementById(it.emplacement).nom)}</span>
        <span>${it.dlc ? `${it.ddm ? 'DDM' : 'DLC'} ${escapeHtml(fmtDate(it.dlc, { day: '2-digit', month: '2-digit', year: 'numeric' }))}` : 'Sans date'}</span>
        <span class="muted">Tartinou · scanne pour retrouver</span>
      </div>
    </div>`).join('');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes Tartinou</title>
  <style>
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 12mm; color: #111; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78mm, 1fr)); gap: 6mm; }
    .label { display: flex; gap: 4mm; align-items: center; border: 1px dashed #999; border-radius: 3mm; padding: 4mm; break-inside: avoid; }
    .label svg { width: 30mm; height: 30mm; flex: none; }
    .txt { display: flex; flex-direction: column; gap: 1mm; font-size: 11pt; }
    .txt strong { font-size: 13pt; }
    .muted { color: #777; font-size: 8pt; }
    .tools { margin-bottom: 8mm; }
    @media print { .tools { display: none; } body { padding: 6mm; } }
  </style></head><body>
  <div class="tools"><button onclick="print()">Imprimer</button> <span>${items.length} étiquette${items.length > 1 ? 's' : ''}</span></div>
  <div class="grid">${cards}</div></body></html>`;
  const w = window.open('', '_blank');
  if (!w) throw new Error('Le navigateur a bloqué la fenêtre d’impression.');
  w.document.open(); w.document.write(html); w.document.close();
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Aperçu d'un QR dans l'app (élément). */
export async function qrElement(text, size = 120) {
  const wrap = h('span', { class: 'qr-preview' });
  wrap.innerHTML = await qrSvg(text, size);
  return wrap;
}
