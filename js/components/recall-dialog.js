// Feuille « Rappels de produits » : les fiches RappelConso qui concernent le stock.
import { h, icon, fmtDate } from '../utils.js';
import { openDialog } from './dialog.js';

/** Bloc d'un rappel (utilisé dans la feuille et dans la fiche produit). */
export function recallBlock(r, items = []) {
  return h('div', { class: 'recall-box' },
    h('p', { class: 'recall-title' }, icon('alert'), h('strong', null, r.libelle || 'Produit rappelé'), r.marque ? h('span', { class: 'muted' }, ` · ${r.marque}`) : null),
    items.length ? h('p', { class: 'small' }, 'Dans ton stock : ', items.map((it) => it.nom).join(', ')) : null,
    r.motif ? h('p', { class: 'small' }, h('strong', null, 'Motif : '), r.motif) : null,
    r.risques ? h('p', { class: 'small' }, h('strong', null, 'Risques : '), r.risques) : null,
    r.conduite.length ? h('ul', { class: 'small recall-steps' }, r.conduite.map((c) => h('li', null, c))) : null,
    h('p', { class: 'muted small' }, `Publié le ${r.date ? fmtDate(r.date, { day: 'numeric', month: 'long', year: 'numeric' }) : '?'}${r.fin ? ` · procédure jusqu’au ${fmtDate(r.fin, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}${r.distributeurs.length ? ` · ${r.distributeurs.slice(0, 4).join(', ')}` : ''}`),
    r.lien ? h('a', { class: 'source-link', href: r.lien, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), 'Voir la fiche sur rappel.conso.gouv.fr') : null);
}

export function openRecallsDialog(recalls, items) {
  const sameCode = (a, b) => Number(String(a).replace(/\D/g, '')) === Number(String(b).replace(/\D/g, ''));
  openDialog({
    title: `Rappel${recalls.length > 1 ? 's' : ''} de produit${recalls.length > 1 ? 's' : ''}`,
    cls: 'sheet-compact',
    content: [
      h('p', { class: 'muted small' }, 'Source : RappelConso, le site officiel des rappels de produits (DGCCRF). Vérifie le lot et la date sur ta fiche avant de jeter.'),
      ...recalls.map((r) => recallBlock(r, items.filter((it) => it.code && sameCode(it.code, r.gtin)))),
    ],
  });
}
