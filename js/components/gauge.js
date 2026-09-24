// Jauge horizontale. Elle ne s'anime que lors d'un re-rendu déclenché par une
// action (voir motion.js) : au chargement, elle apparaît déjà remplie.
import { h } from '../utils.js';
import { shouldAnimate } from '../motion.js';

const previous = new Map();

/**
 * @param {object} o
 * @param {string} o.id      identifiant stable (pour retrouver la valeur précédente)
 * @param {number} o.value   ce qu'il reste
 * @param {number} o.max     plafond
 * @param {boolean} [o.over] dépassement → jauge pleine en rouge brique
 * @param {string} [o.size]  'large' | 'small'
 * @param {string} o.label   texte accessible
 */
export function gauge({ id, value, max, over = false, size = 'small', label }) {
  const ratio = over ? 1 : max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const width = `${Math.round(ratio * 1000) / 10}%`;
  const fill = h('div', { class: 'gauge-fill' });
  const el = h(
    'div',
    {
      class: `gauge gauge-${size}${over ? ' is-over' : ''}`,
      role: 'meter',
      'aria-label': label,
      'aria-valuemin': '0',
      'aria-valuemax': String(Math.max(0, Math.round(max * 100) / 100)),
      'aria-valuenow': String(Math.max(0, Math.round(value * 100) / 100)),
    },
    fill,
  );
  const from = previous.get(id);
  previous.set(id, width);
  if (shouldAnimate() && from != null && from !== width) {
    fill.style.width = from;
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = width)));
  } else {
    fill.style.width = width;
  }
  return el;
}
