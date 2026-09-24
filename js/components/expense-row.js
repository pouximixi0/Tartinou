// Ligne de dépense : toucher pour modifier, bouton ou glissement vers la gauche pour supprimer.
import { h, icon, money, toast } from '../utils.js';
import { categoryById, update, syncStatus } from '../store.js';
import { openExpenseSheet } from './expense-sheet.js';
import { isOn } from '../modules.js';

export function expenseRow(e) {
  const cat = categoryById(e.categorieId);
  const title = e.note || cat.nom;
  const row = h('li', { class: 'expense-row' });
  const inner = h('div', { class: 'expense-inner' },
    h('button', { type: 'button', class: 'expense-main', 'aria-label': `Modifier : ${title}, ${money(e.montant)}`, onclick: () => openExpenseSheet({ expense: e }) },
      h('span', { class: 'chip-dot', style: { '--chip': cat.couleur }, 'aria-hidden': 'true' }),
      h('span', { class: 'expense-text' },
        h('span', { class: 'expense-title' }, title),
        e.note || showAuthor(e) ? h('span', { class: 'expense-cat muted' }, e.note ? cat.nom : null, showAuthor(e) ? [e.note ? ' · ' : '', h('span', { class: 'expense-auteur' }, e.auteur)] : null) : null),
      h('span', { class: 'expense-amount num' }, money(e.montant))),
    h('button', { type: 'button', class: 'btn-icon expense-delete', 'aria-label': `Supprimer ${title}, ${money(e.montant)}`, onclick: () => remove(row, e) }, icon('trash')),
  );
  row.append(inner);
  attachSwipe(row, inner, () => remove(row, e));
  return row;
}

/** Le prénom de l'auteur n'a d'intérêt qu'à plusieurs dans le foyer. */
const showAuthor = (e) => isOn('auteurDepenses') && !!e.auteur && (syncStatus().foyer?.membres?.length || 1) > 1;

export function expenseList(expenses) {
  return h('ul', { class: 'expense-list' }, expenses.map(expenseRow));
}

function remove(row, e) {
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    update((s) => { s.expenses = s.expenses.filter((x) => x.id !== e.id); });
    toast('Dépense supprimée');
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return commit();
  row.classList.add('is-removing');
  row.addEventListener('transitionend', commit, { once: true });
  setTimeout(commit, 350);
}

/** Glissement tactile vers la gauche ; au-delà de 100 px, la ligne est supprimée. */
function attachSwipe(row, inner, onDelete) {
  let startX = 0, startY = 0, dx = 0, active = false, horizontal = null;
  inner.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    startX = ev.clientX; startY = ev.clientY; dx = 0; active = true; horizontal = null;
  });
  inner.addEventListener('pointermove', (ev) => {
    if (!active) return;
    const mx = ev.clientX - startX, my = ev.clientY - startY;
    if (horizontal === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      horizontal = Math.abs(mx) > Math.abs(my);
    }
    if (!horizontal) return;
    dx = Math.min(0, mx);
    inner.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('swipe-ready', dx < -100);
  });
  const end = () => {
    if (!active) return;
    active = false;
    row.classList.remove('swipe-ready');
    if (dx < -100) onDelete();
    else inner.style.transform = '';
  };
  inner.addEventListener('pointerup', end);
  inner.addEventListener('pointercancel', end);
}
