// Petites fonctions partagées : dates locales (jamais d'UTC pour éviter les
// décalages de fuseau), formatage monétaire français, helper DOM `h()`.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const pad2 = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayISO = () => toISO(new Date());
export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
export function mondayOf(iso) {
  const d = fromISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}
/** Lundi à venir (aujourd'hui si on est lundi). */
export function nextMonday(iso) {
  const d = fromISO(iso);
  const wd = (d.getDay() + 6) % 7;
  if (wd !== 0) d.setDate(d.getDate() + 7 - wd);
  return toISO(d);
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const round2 = (n) => Math.round((n || 0) * 100) / 100;
export const money = (n) => eur.format(round2(n));
/** "12,50" sans symbole, pour pré-remplir un champ. */
export const moneyPlain = (n) => round2(n).toFixed(2).replace('.', ',');
export function parseAmount(str) {
  const s = String(str ?? '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? round2(n) : NaN;
}
export const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

export const fmtDate = (iso, opts) => fromISO(iso).toLocaleDateString('fr-FR', opts);
export const dateLong = (iso) => fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
export const dateShort = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export function relativeDay(iso) {
  const today = todayISO();
  if (iso === today) return "Aujourd'hui";
  if (iso === addDays(today, -1)) return 'Hier';
  return capitalize(dateLong(iso));
}

export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Crée un élément : h('button', { class: 'btn', onclick }, 'Texte', enfant…). */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let deferredValue;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') deferredValue = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  pot: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-6zM2 10h20M8 6c0-1 1-1 1-2M12 6c0-1 1-1 1-2M16 6c0-1 1-1 1-2"/>',
  basket: '<path d="M3 10h18l-1.5 9a2 2 0 0 1-2 1.5h-11a2 2 0 0 1-2-1.5L3 10zM8 10l3-6M16 10l-3-6M9 14v3M15 14v3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  backspace: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM18 9l-6 6M12 9l6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  download: '<path d="M12 3v12M6 11l6 6 6-6M4 21h16"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"/><circle cx="12" cy="14" r="3.5"/>',
  box: '<path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>',
  flash: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.3-1.5A4 4 0 0 1 17 18z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2"/>',
};
export function icon(name, cls = '') {
  const span = h('span', { class: `icon ${cls}`.trim(), 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

let toastTimer;
export function toast(message) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.replaceChildren(h('div', { class: 'toast' }, message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.replaceChildren(), 2800);
}
