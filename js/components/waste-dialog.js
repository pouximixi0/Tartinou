// « Jeté ? » : confirme la mise au rebut et récupère le prix si on ne le
// connaît pas, pour que le gaspillage soit chiffré en euros.
import { h, money, parseAmount } from '../utils.js';
import { valueOf, fmtQte, prixLabel } from '../stock.js';
import { openDialog } from './dialog.js';

/**
 * Résout { ok: true, prix } (prix unitaire ou null) ou { ok: false }.
 * `qte` : quantité jetée (par défaut toute la ligne).
 */
export function openWasteDialog(item, { qte = item.qte, title } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const input = h('input', { type: 'text', id: 'waste-prix', class: 'input num', inputmode: 'decimal', placeholder: '0,00', value: item.prix != null ? String(item.prix).replace('.', ',') : '', autocomplete: 'off' });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const total = h('p', { class: 'summary' });
    function drawTotal() {
      const p = input.value.trim() ? parseAmount(input.value) : null;
      const v = p != null && !Number.isNaN(p) ? valueOf(p, qte, item.unite) : null;
      total.replaceChildren(v != null ? ['Gaspillage : ', h('strong', { class: 'num' }, money(v))] : 'Indique le prix pour chiffrer le gaspillage (facultatif).');
    }
    input.addEventListener('input', drawTotal);
    drawTotal();
    const dlg = openDialog({
      title: title || `Jeter ${item.nom} ?`,
      cls: 'sheet-compact',
      content: [
        h('p', null, h('span', { class: 'num' }, fmtQte({ ...item, qte })), ' seront comptés dans le gaspillage du mois.'),
        h('div', { class: 'field' }, h('label', { for: 'waste-prix' }, prixLabel(item.unite)), input),
        total,
        err,
      ],
      actions: [
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: confirm }, 'Oui, jeté'),
      ],
      onClose: () => resolve(ok ? { ok: true, prix: readPrix() } : { ok: false }),
    });
    function readPrix() {
      const s = input.value.trim();
      if (!s) return null;
      const p = parseAmount(s);
      return Number.isNaN(p) ? null : p;
    }
    function confirm() {
      const s = input.value.trim();
      if (s && Number.isNaN(parseAmount(s))) { err.textContent = 'Le prix doit être un nombre, par exemple 2,50.'; err.hidden = false; input.focus(); return; }
      ok = true;
      dlg.close();
    }
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); confirm(); } });
    if (item.prix == null) setTimeout(() => input.focus(), 50);
  });
}
