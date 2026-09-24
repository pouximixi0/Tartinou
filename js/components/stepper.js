// Stepper − / + pour les quantités.
import { h, icon } from '../utils.js';

/**
 * stepper({ value, step, min, max, label, format, onChange })
 * onChange(nouvelleValeur, ancienneValeur). L'élément expose set(v, { silent }) et get().
 */
export function stepper({ value = 1, step = 1, min = 0, max = 99999, label = 'Quantité', format, onChange, size = '' }) {
  let v = value;
  const out = h('output', { class: 'stepper-value num' });
  const minus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Moins (${label})`, onclick: () => set(v - step) }, icon('minus'));
  const plus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Plus (${label})`, onclick: () => set(v + step) }, icon('plus'));
  function draw() {
    out.textContent = format ? format(v) : String(Math.round(v * 100) / 100).replace('.', ',');
    minus.disabled = v <= min;
    plus.disabled = v >= max;
  }
  function set(n, { silent = false } = {}) {
    const prev = v;
    n = Math.round(n * 100) / 100;
    if (n < min) n = min;
    if (n > max) n = max;
    v = n;
    draw();
    if (!silent && n !== prev) onChange?.(v, prev);
  }
  draw();
  const el = h('div', { class: `stepper ${size}`.trim(), role: 'group', 'aria-label': label }, minus, out, plus);
  el.set = set;
  el.get = () => v;
  el.setStep = (s) => { step = s; };
  return el;
}
