// « J'ai cuisiné ce plat » : retire du stock les ingrédients utilisés.
// Chaque ingrédient de la recette est rapproché d'un produit du stock par son nom ;
// on coche, on ajuste la quantité retirée, on confirme.
import { h, icon, toast } from '../utils.js';
import { getState, update } from '../store.js';
import { findInStock, uniteById, fmtQte, adjustStockQty } from '../stock.js';
import { stepper } from './stepper.js';

/**
 * ingredients : [{ article, quantite }]
 * Résout le nombre de produits retirés (0 si annulé).
 */
export function openCookDialog({ title = 'J’ai cuisiné ce plat', ingredients = [], onDone } = {}) {
  const items = getState().stock.items;
  const rows = [];
  const seen = new Set();
  for (const ing of ingredients) {
    const hits = findInStock(items, ing.article).sort((a, b) => (b.match.exact ? 1 : 0) - (a.match.exact ? 1 : 0));
    for (const hit of hits.slice(0, 2)) {
      if (seen.has(hit.item.id)) continue;
      seen.add(hit.item.id);
      rows.push({ item: hit.item, ing, exact: hit.match.exact, on: hit.match.exact || hits.length === 1, qte: Math.min(hit.item.qte, uniteById(hit.item.unite).step) });
    }
  }
  const missing = ingredients.filter((ing) => !findInStock(items, ing.article).length);
  const btn = h('button', { type: 'button', class: 'btn btn-primary', onclick: confirm }, '');
  const drawBtn = () => { const n = rows.filter((r) => r.on).length; btn.textContent = n ? `Retirer ${n} produit${n > 1 ? 's' : ''} du stock` : 'Marquer comme cuisiné'; };
  drawBtn();
  const list = h('ul', { class: 'ranger-list' }, rows.map((r, i) => {
    const id = `ck-${i}`;
    const box = h('input', { type: 'checkbox', id, class: 'check', checked: r.on, onchange: (ev) => { r.on = ev.target.checked; li.classList.toggle('is-off', !r.on); drawBtn(); } });
    const st = stepper({ value: r.qte, step: uniteById(r.item.unite).step, min: 0, max: r.item.qte, label: r.item.nom, size: 'stepper-sm', format: (v) => fmtQte({ ...r.item, conditionnement: '', qte: v }), onChange: (v) => { r.qte = v; } });
    const li = h('li', { class: `ranger-row${r.on ? '' : ' is-off'}` },
      h('div', { class: 'shop-main' }, box,
        h('label', { for: id, class: 'shop-label' }, h('span', { class: 'shop-name' }, r.item.nom), h('span', { class: 'muted small' }, ` · pour « ${r.ing.article}${r.ing.quantite ? ` ${r.ing.quantite}` : ''} »${r.exact ? '' : ' (à vérifier)'}`)),
        h('span', { class: 'muted small num' }, `reste ${fmtQte({ ...r.item, conditionnement: '' })}`)),
      h('div', { class: 'ranger-fields' }, h('span', { class: 'label' }, 'Retirer '), st));
    return li;
  }));
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'cook-title' },
    h('header', { class: 'sheet-head' }, h('h2', { id: 'cook-title', class: 'sheet-title' }, title), h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer', onclick: () => dlg.close() }, icon('x'))),
    h('div', { class: 'sheet-body' },
      rows.length ? h('p', { class: 'muted small' }, 'Les produits du stock qui correspondent aux ingrédients. Décoche ce que tu n’as pas utilisé, ajuste ce qui a été retiré.') : h('p', { class: 'muted' }, 'Aucun ingrédient de cette recette n’a été trouvé dans le stock. Le plat sera juste marqué comme cuisiné.'),
      list,
      missing.length ? h('p', { class: 'muted small' }, `Pas dans le stock : ${missing.map((m) => m.article).join(', ')}.`) : null),
    h('footer', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'), btn));
  let result = null;
  function confirm() {
    const chosen = rows.filter((r) => r.on && r.qte > 0);
    update((s) => { for (const r of chosen) adjustStockQty(s, r.item.id, -r.qte, 'conso'); });
    result = chosen.length;
    toast(chosen.length ? `${chosen.length} produit${chosen.length > 1 ? 's' : ''} retiré${chosen.length > 1 ? 's' : ''} du stock` : 'Plat marqué comme cuisiné');
    dlg.close();
  }
  dlg.addEventListener('close', () => { dlg.remove(); onDone?.(result); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
