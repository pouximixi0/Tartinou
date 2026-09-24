// « Ranger les courses » : les articles achetés entrent dans le stock en une
// fois, avec un emplacement et une date proposés pour chacun.
import { h, icon, toast, round2 } from '../utils.js';
import { update } from '../store.js';
import { EMPLACEMENTS, DATE_TYPES, guessCategorie, guessEmplacement, defaultDlc, defaultDdm, addStockItem } from '../stock.js';

/** "3" → 3 pièces ; "2 x 500 g" → 2 × « 500 g » ; "500 g" → 1 × « 500 g ». */
export function parseQuantite(q) {
  const s = String(q || '').trim();
  if (!s) return { qte: 1, conditionnement: '' };
  if (/^\d+$/.test(s) && Number(s) <= 50) return { qte: Number(s), conditionnement: '' };
  const m = s.match(/^(\d+)\s*[x×*]\s*(.+)$/i);
  if (m && Number(m[1]) <= 50) return { qte: Number(m[1]), conditionnement: m[2].trim() };
  return { qte: 1, conditionnement: s };
}

/**
 * items : [{ article, quantite, rayon, prix_estime }]
 * onDone(s, nombreRangé) est appelé dans la même transaction que les ajouts.
 */
export function openRangerSheet({ items, onDone, title = 'Ranger les courses' }) {
  const rows = items.map((it) => {
    const categorie = guessCategorie(it.rayon, it.article);
    const emplacement = guessEmplacement(categorie, it.rayon, it.article);
    const { qte, conditionnement } = parseQuantite(it.quantite);
    return { it, on: true, categorie, emplacement, dlc: defaultDlc(emplacement), dlcTouched: false, ddm: defaultDdm(categorie, emplacement), ddmTouched: false, qte, conditionnement };
  });
  const btn = h('button', { type: 'button', class: 'btn btn-primary', onclick: confirm }, '');
  const count = () => rows.filter((r) => r.on).length;
  const drawBtn = () => { const n = count(); btn.textContent = n ? `Ranger ${n} article${n > 1 ? 's' : ''}` : 'Rien à ranger'; btn.disabled = !n; };
  drawBtn();

  const list = h('ul', { class: 'ranger-list' }, rows.map((r, i) => {
    const id = `rg-${i}`;
    const date = h('input', { type: 'date', class: 'input', 'aria-label': `Date limite pour ${r.it.article}`, value: r.dlc || '', onchange: (ev) => { r.dlc = ev.target.value || null; r.dlcTouched = true; } });
    const type = h('select', { class: 'input input-type', 'aria-label': `Type de date pour ${r.it.article}`, value: r.ddm ? 'ddm' : 'dlc', onchange: (ev) => { r.ddm = ev.target.value === 'ddm'; r.ddmTouched = true; } },
      DATE_TYPES.map((t) => h('option', { value: t.id, title: t.long }, t.label)));
    const emp = h('select', { class: 'input', 'aria-label': `Emplacement pour ${r.it.article}`, value: r.emplacement, onchange: (ev) => {
      r.emplacement = ev.target.value;
      if (!r.dlcTouched) { r.dlc = defaultDlc(r.emplacement); date.value = r.dlc || ''; }
      if (!r.ddmTouched) { r.ddm = defaultDdm(r.categorie, r.emplacement); type.value = r.ddm ? 'ddm' : 'dlc'; }
    } }, EMPLACEMENTS.map((e) => h('option', { value: e.id }, e.nom)));
    const box = h('input', { type: 'checkbox', id, class: 'check', checked: true, onchange: (ev) => { r.on = ev.target.checked; li.classList.toggle('is-off', !r.on); drawBtn(); } });
    const li = h('li', { class: 'ranger-row' },
      h('div', { class: 'shop-main' }, box,
        h('label', { for: id, class: 'shop-label' }, h('span', { class: 'shop-name' }, r.it.article), r.it.quantite ? h('span', { class: 'muted small' }, ` · ${r.it.quantite}`) : null)),
      h('div', { class: 'field-row ranger-fields' }, emp, date, type));
    return li;
  }));

  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'ranger-title' },
    h('header', { class: 'sheet-head' },
      h('h2', { id: 'ranger-title', class: 'sheet-title' }, title),
      h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer', onclick: () => dlg.close() }, icon('x'))),
    h('div', { class: 'sheet-body' },
      h('p', { class: 'muted small' }, 'Emplacement et date limite sont proposés d’après le rayon ; corrige ce qui ne va pas, décoche ce que tu ne ranges pas.'),
      list),
    h('footer', { class: 'sheet-foot' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Plus tard'),
      btn),
  );

  function confirm() {
    const n = count();
    if (!n) return;
    update((s) => {
      for (const r of rows) {
        if (!r.on) continue;
        const prixLigne = Number(r.it.prix_estime) || 0;
        addStockItem(s, { nom: r.it.article, qte: r.qte, unite: 'piece', conditionnement: r.conditionnement, emplacement: r.emplacement, categorie: r.categorie, dlc: r.dlc, ddm: r.ddm, prix: prixLigne > 0 ? round2(prixLigne / r.qte) : null });
      }
      onDone?.(s, n);
    });
    toast(`${n} article${n > 1 ? 's' : ''} rangé${n > 1 ? 's' : ''} dans le stock`);
    dlg.close();
  }

  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
