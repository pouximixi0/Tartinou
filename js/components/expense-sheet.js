// Feuille plein écran de saisie d'une dépense : pavé numérique, catégorie,
// note, date. Trois gestes : montant → catégorie → Enregistrer.
import { h, icon, uid, todayISO, moneyPlain, parseAmount, toast } from '../utils.js';
import { getState, update } from '../store.js';
import { confirmDialog } from './dialog.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];

export function openExpenseSheet({ expense = null, date = todayISO() } = {}) {
  const state = getState();
  let amount = expense ? moneyPlain(expense.montant).replace(/,00$/, '') : '';
  let categorieId = expense?.categorieId || state.categories[0].id;

  const dlg = h('dialog', { class: 'sheet sheet-expense', 'aria-labelledby': 'expense-title' });
  const display = h('output', { class: 'amount-display num', 'aria-live': 'polite', for: 'numpad' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: save }, expense ? 'Enregistrer les modifications' : 'Enregistrer la dépense');
  const noteInput = h('input', { type: 'text', id: 'exp-note', class: 'input', placeholder: 'Ex. boulangerie', value: expense?.note || '', autocomplete: 'off', maxlength: '80' });
  const dateInput = h('input', { type: 'date', id: 'exp-date', class: 'input', value: expense?.date || date, required: true });

  function refresh() {
    display.textContent = `${amount || '0'} €`;
    saveBtn.disabled = !(parseAmount(amount) > 0);
  }
  function press(k) {
    if (k === 'del') amount = amount.slice(0, -1);
    else if (k === ',') { if (!amount.includes(',')) amount = (amount || '0') + ','; }
    else {
      const [int, dec] = amount.split(',');
      if (dec !== undefined) { if (dec.length < 2) amount += k; }
      else if (int === '0') amount = k;
      else if (int.length < 6) amount += k;
    }
    refresh();
  }

  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Catégorie' });
  function renderChips() {
    chips.replaceChildren(
      ...state.categories.map((c) =>
        h('button', {
          type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(c.id === categorieId),
          style: { '--chip': c.couleur },
          onclick: () => { categorieId = c.id; renderChips(); },
        }, h('span', { class: 'chip-dot', 'aria-hidden': 'true' }), c.nom),
      ),
    );
  }
  renderChips();

  const numpad = h('div', { class: 'numpad', id: 'numpad', role: 'group', 'aria-label': 'Pavé numérique' },
    KEYS.map((k) => h('button', {
      type: 'button', class: `key${k === 'del' ? ' key-del' : ''}`,
      'aria-label': k === 'del' ? 'Effacer le dernier chiffre' : k === ',' ? 'Virgule' : k,
      onclick: () => press(k),
    }, k === 'del' ? icon('backspace') : k)),
  );

  function save() {
    const montant = parseAmount(amount);
    if (!(montant > 0)) return;
    if (!dateInput.value) { dateInput.focus(); return; }
    const note = noteInput.value.trim();
    update((s) => {
      if (expense) {
        const e = s.expenses.find((x) => x.id === expense.id);
        if (e) Object.assign(e, { montant, categorieId, note, date: dateInput.value });
      } else {
        s.expenses.push({ id: uid(), montant, categorieId, note, date: dateInput.value, createdAt: Date.now() });
      }
    });
    dlg.close();
    toast(expense ? 'Dépense modifiée' : 'Dépense enregistrée');
  }

  async function remove() {
    const ok = await confirmDialog({ title: 'Supprimer cette dépense ?', message: 'Elle disparaîtra de tes listes et de tes jauges.', confirmLabel: 'Supprimer la dépense', danger: true });
    if (!ok) return;
    update((s) => { s.expenses = s.expenses.filter((x) => x.id !== expense.id); });
    dlg.close();
    toast('Dépense supprimée');
  }

  dlg.append(
    h('header', { class: 'sheet-head' },
      h('h2', { id: 'expense-title', class: 'sheet-title' }, expense ? 'Modifier la dépense' : 'Nouvelle dépense'),
      h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer sans enregistrer', onclick: () => dlg.close() }, icon('x')),
    ),
    h('div', { class: 'sheet-body expense-body' },
      display,
      chips,
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'exp-note' }, 'Note (facultatif)'), noteInput),
        h('div', { class: 'field field-date' }, h('label', { for: 'exp-date' }, 'Date'), dateInput),
      ),
      numpad,
    ),
    h('footer', { class: 'sheet-foot' },
      expense ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: remove }, icon('trash'), 'Supprimer') : null,
      saveBtn,
    ),
  );

  // Clavier physique : chiffres, virgule/point, retour arrière (hors champs texte).
  dlg.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input')) return;
    if (/^[0-9]$/.test(ev.key)) press(ev.key);
    else if (ev.key === ',' || ev.key === '.') press(',');
    else if (ev.key === 'Backspace') press('del');
    else if (ev.key === 'Enter') save();
    else return;
    ev.preventDefault();
  });

  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  refresh();
  dlg.showModal();
  numpad.querySelector('.key')?.focus();
}
