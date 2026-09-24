// Boîtes de dialogue génériques basées sur <dialog>.
import { h, icon } from '../utils.js';

/** Ouvre une feuille modale. Retourne l'élément <dialog>. */
export function openDialog({ title, content, actions = [], cls = '', onClose }) {
  const dlg = h('dialog', { class: `sheet ${cls}`.trim(), 'aria-labelledby': 'dlg-title-' + Date.now() });
  const titleId = dlg.getAttribute('aria-labelledby');
  const closeBtn = h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer', onclick: () => dlg.close() }, icon('x'));
  dlg.append(
    h('header', { class: 'sheet-head' }, h('h2', { id: titleId, class: 'sheet-title' }, title), closeBtn),
    h('div', { class: 'sheet-body' }, content),
  );
  if (actions.length) dlg.append(h('footer', { class: 'sheet-foot' }, actions));
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** Confirmation simple. Résout true si confirmé. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    let ok = false;
    const dlg = openDialog({
      title,
      cls: 'sheet-compact',
      content: typeof message === 'string' ? h('p', null, message) : message,
      actions: [
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, cancelLabel),
        h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { ok = true; dlg.close(); } }, confirmLabel),
      ],
      onClose: () => resolve(ok),
    });
  });
}
