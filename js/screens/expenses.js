// Écran Dépenses : bilan du cycle en une phrase, répartition par catégorie,
// puis la liste groupée par jour.
import { h, money, pct, relativeDay, fmtDate, addDays, capitalize } from '../utils.js';
import { getState, categoryById } from '../store.js';
import { computeBudget, recentCycles, sumBetween, dailyMaxFor, trackedEnveloppe } from '../budget.js';
import { expenseList } from '../components/expense-row.js';
import { openExpenseSheet } from '../components/expense-sheet.js';
import { objectifsStatus } from '../finance.js';
import { isOn } from '../modules.js';

// Filtres conservés entre deux rendus.
const filters = { cycle: 0, categorie: 'all' };

function cycleLabel(c, debutMois) {
  if (debutMois === 1) return capitalize(fmtDate(c.start, { month: 'long', year: 'numeric' }));
  return `Du ${fmtDate(c.start, { day: 'numeric', month: 'short' })} au ${fmtDate(addDays(c.end, -1), { day: 'numeric', month: 'short' })}`;
}

export function renderExpenses() {
  const state = getState();
  const b = computeBudget(state);
  const cycles = recentCycles(state.settings.debutMois);
  const cycle = cycles[filters.cycle] || cycles[0];
  const inCycle = state.expenses.filter((e) => e.date >= cycle.start && e.date < cycle.end);
  const totalCycle = sumBetween(inCycle, cycle.start, cycle.end);
  const root = h('section', { class: 'screen screen-expenses' });

  // Bilan en une phrase.
  const byCat = new Map();
  for (const e of inCycle) byCat.set(e.categorieId, (byCat.get(e.categorieId) || 0) + e.montant);
  const sorted = [...byCat.entries()].sort((a, z) => z[1] - a[1]);
  let phrase;
  if (!inCycle.length) phrase = 'Aucune dépense sur cette période.';
  else {
    const top = sorted[0];
    const topTxt = `, dont ${pct(top[1], totalCycle)} % en ${categoryById(top[0]).nom.toLowerCase()}`;
    const enveloppe = trackedEnveloppe(state, cycle);
    phrase = b.configured && enveloppe > 0
      ? `Tu as dépensé ${pct(totalCycle, enveloppe)} % de ton enveloppe${topTxt}.`
      : `Tu as dépensé ${money(totalCycle)}${topTxt}.`;
  }
  root.append(h('h1', { class: 'lead' }, phrase));

  // Filtres.
  root.append(
    h('div', { class: 'filters' },
      h('div', { class: 'field' },
        h('label', { for: 'f-cycle' }, 'Mois'),
        h('select', { id: 'f-cycle', class: 'input', value: String(filters.cycle), onchange: (ev) => { filters.cycle = Number(ev.target.value); rerender(); } },
          cycles.map((c, i) => h('option', { value: String(i) }, cycleLabel(c, state.settings.debutMois))))),
      h('div', { class: 'field' },
        h('label', { for: 'f-cat' }, 'Catégorie'),
        h('select', { id: 'f-cat', class: 'input', value: filters.categorie, onchange: (ev) => { filters.categorie = ev.target.value; rerender(); } },
          h('option', { value: 'all' }, 'Toutes'),
          state.categories.map((c) => h('option', { value: c.id }, c.nom)))),
    ),
  );

  // Répartition par catégorie (barres CSS).
  if (sorted.length) {
    const maxCat = sorted[0][1];
    root.append(
      h('ul', { class: 'bars', 'aria-label': 'Répartition par catégorie' },
        sorted.map(([id, amount]) => {
          const cat = categoryById(id);
          const obj = isOn('objectifs') ? Number((state.settings.objectifs || {})[id]) || 0 : 0;
          const ratio = obj ? amount / obj : 0;
          const cls = obj ? (ratio >= 1 ? ' is-depasse' : ratio >= 0.8 ? ' is-alerte' : '') : '';
          return h('li', { class: `bar-row${cls}` },
            h('div', { class: 'bar-head' },
              h('span', null, cat.nom),
              h('span', { class: 'num' }, `${money(amount)} · ${pct(amount, totalCycle)} %`, obj ? h('span', { class: 'obj' }, ` · objectif ${money(obj)}`) : null)),
            h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${(amount / maxCat) * 100}%`, background: cat.couleur } })));
        })),
    );
  }

  // Liste groupée par jour.
  const shown = filters.categorie === 'all' ? inCycle : inCycle.filter((e) => e.categorieId === filters.categorie);
  if (!shown.length) {
    root.append(h('p', { class: 'empty-line muted' }, 'Aucune dépense ici. ',
      h('button', { type: 'button', class: 'link', onclick: () => openExpenseSheet() }, 'Ajouter une dépense.')));
    return root;
  }
  const days = new Map();
  for (const e of shown) (days.get(e.date) || days.set(e.date, []).get(e.date)).push(e);
  const dates = [...days.keys()].sort().reverse();
  for (const date of dates) {
    const list = days.get(date).sort((a, z) => (z.createdAt || 0) - (a.createdAt || 0));
    const totalDay = sumBetween(state.expenses, date, addDays(date, 1));
    const over = b.configured && totalDay > dailyMaxFor(state, date) + 0.005;
    root.append(
      h('div', { class: `day-head${over ? ' is-over' : ''}` },
        h('h2', { class: 'h-section' }, relativeDay(date)),
        h('span', { class: 'num day-total' }, over ? h('span', { class: 'over-mark' }, 'dépassé · ') : null, money(totalDay))),
      expenseList(list),
    );
  }
  return root;
}

function rerender() {
  const main = document.getElementById('screen');
  const y = window.scrollY;
  main.replaceChildren(renderExpenses());
  window.scrollTo(0, y);
}
