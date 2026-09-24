// Mode rangement : on fait défiler le stock, produit par produit, et on confirme
// « toujours là ? », on corrige la quantité, ou on retire (consommé / jeté).
import { h, icon, toast, money } from '../utils.js';
import { getState, update } from '../store.js';
import { EMPLACEMENTS, emplacementById, uniteById, dlcInfo, dlcLabel, fmtQte, sortItems, adjustStockQty, removeStockItem, valueOf } from '../stock.js';
import { stepper } from './stepper.js';
import { openWasteDialog } from './waste-dialog.js';

export function openInventorySheet() {
  const state = getState();
  const st = state.settings.stock;
  const order = EMPLACEMENTS.map((e) => e.id);
  const queue = [...state.stock.items].sort((a, b) => order.indexOf(a.emplacement) - order.indexOf(b.emplacement) || a.nom.localeCompare(b.nom, 'fr')).map((it) => it.id);
  if (!queue.length) { toast('Le stock est vide, rien à vérifier.'); return; }
  let index = 0;
  const done = { ok: 0, corrige: 0, retire: 0 };

  const progress = h('div', { class: 'gauge gauge-small', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(queue.length), 'aria-valuenow': '0' }, h('div', { class: 'gauge-fill' }));
  const counter = h('p', { class: 'muted small' });
  const card = h('div', { class: 'inv-card' });
  const foot = h('footer', { class: 'sheet-foot inv-foot' });

  function current() { return getState().stock.items.find((x) => x.id === queue[index]) || null; }
  function next() {
    index++;
    while (index < queue.length && !getState().stock.items.some((x) => x.id === queue[index])) index++;
    draw();
  }
  function draw() {
    progress.querySelector('.gauge-fill').style.width = `${Math.round((index / queue.length) * 100)}%`;
    progress.setAttribute('aria-valuenow', String(index));
    counter.textContent = `${Math.min(index + 1, queue.length)} / ${queue.length}`;
    const item = current();
    if (!item) return finish();
    const info = dlcInfo(item, st.alertDays);
    const product = item.code ? getState().stock.products[item.code] : null;
    const qty = stepper({ value: item.qte, step: uniteById(item.unite).step, min: 0, label: item.nom, format: (v) => fmtQte({ ...item, conditionnement: '', qte: v }) });
    card.replaceChildren(
      h('p', { class: 'h-section' }, emplacementById(item.emplacement).nom),
      item.image ? h('img', { class: 'inv-thumb', src: item.image, alt: '' }) : h('span', { class: 'inv-thumb stock-thumb-empty' }, icon('box')),
      h('h3', { class: 'inv-name' }, item.nom),
      h('p', { class: 'muted' }, [item.marque, item.conditionnement].filter(Boolean).join(' · ')),
      h('span', { class: 'badges' }, product && product.nutriscore ? h('span', { class: `score-mini score-${product.nutriscore}` }, `Nutri-Score ${product.nutriscore.toUpperCase()}`) : null, h('span', { class: `dlc-badge dlc-${info.status}` }, dlcLabel(item, info))),
      h('div', { class: 'inv-qty' }, h('span', { class: 'label' }, 'Quantité constatée'), qty),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => {
          const res = await openWasteDialog(item, { title: `Jeter ${item.nom} ?` });
          if (!res.ok) return;
          update((s) => removeStockItem(s, item.id, 'jete', { prix: res.prix }));
          done.retire++; next();
        } }, icon('trash'), 'Jeté'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { update((s) => removeStockItem(s, item.id, 'conso')); done.retire++; next(); } }, icon('check'), 'Terminé')),
    );
    foot.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: next }, 'Passer'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        const v = qty.get();
        if (v <= 0) { update((s) => removeStockItem(s, item.id, 'conso')); done.retire++; }
        else if (Math.abs(v - item.qte) > 0.001) { update((s) => adjustStockQty(s, item.id, v - item.qte, 'ajuste')); done.corrige++; }
        else done.ok++;
        next();
      } }, 'Toujours là'),
    );
  }
  function finish() {
    card.replaceChildren(
      h('h3', { class: 'inv-name' }, 'Inventaire terminé'),
      h('div', { class: 'stats-row' },
        stat(done.ok, 'confirmés'), stat(done.corrige, 'corrigés'), stat(done.retire, 'retirés')),
      h('p', { class: 'muted small' }, 'Le journal anti-gaspi et la liste « À racheter » sont à jour.'));
    foot.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Fermer'));
    progress.querySelector('.gauge-fill').style.width = '100%';
    counter.textContent = `${queue.length} / ${queue.length}`;
  }
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'inv-title' },
    h('header', { class: 'sheet-head' }, h('h2', { id: 'inv-title', class: 'sheet-title' }, 'Mode rangement'), h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer', onclick: () => dlg.close() }, icon('x'))),
    h('div', { class: 'sheet-body' }, h('div', { class: 'inv-progress' }, progress, counter), card),
    foot);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  draw();
  return dlg;
}
function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value num' }, String(value)), h('span', { class: 'stat-label muted small' }, label));
}
