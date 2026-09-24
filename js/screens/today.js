// Écran Aujourd'hui : la jauge du jour, les mini-jauges semaine/mois,
// le bouton d'ajout, les dépenses du jour et la série.
import { h, icon, money, todayISO, dateLong, dateShort, capitalize } from '../utils.js';
import { getState } from '../store.js';
import { computeBudget } from '../budget.js';
import { gauge } from '../components/gauge.js';
import { expenseList } from '../components/expense-row.js';
import { openExpenseSheet } from '../components/expense-sheet.js';
import { stockSummary } from '../stock.js';
import { objectifsStatus } from '../finance.js';
import { wallZone } from '../components/wall.js';
import { isOn } from '../modules.js';

export function renderToday() {
  const state = getState();
  const b = computeBudget(state);
  const today = todayISO();
  const todays = state.expenses.filter((e) => e.date === today).sort((a, z) => (z.createdAt || 0) - (a.createdAt || 0));
  const root = h('section', { class: 'screen screen-today' });

  root.append(h('p', { class: 'date-line muted' }, capitalize(dateLong(today))));

  if (!b.configured) {
    root.append(
      h('div', { class: 'empty' },
        h('p', null, 'Renseigne ton revenu mensuel pour calculer ce que tu peux dépenser chaque jour.'),
        h('a', { class: 'btn btn-primary', href: '#reglages' }, 'Ouvrir les réglages')),
    );
  } else {
    const over = b.resteAujourdhui < 0;
    root.append(
      h('div', { class: `hero${over ? ' is-over' : ''}` },
        h('h1', { class: 'hero-text' },
          over ? 'Tu as dépassé de ' : 'Il te reste ',
          h('span', { class: 'hero-amount num' }, money(Math.abs(b.resteAujourdhui))),
          " aujourd'hui"),
        gauge({ id: 'today', value: b.resteAujourdhui, max: b.maxJour, over, size: 'large', label: 'Budget restant aujourd’hui' }),
        h('p', { class: 'muted small' },
          'Dépensé ', h('span', { class: 'num' }, money(b.depenseAujourdhui)),
          ' sur ', h('span', { class: 'num' }, money(Math.max(0, b.maxJour))),
          state.settings.budgetStrict ? ' (budget strict)' : ` · ${b.joursRestants} jour${b.joursRestants > 1 ? 's' : ''} restant${b.joursRestants > 1 ? 's' : ''} dans le cycle`),
        b.cyclePartiel && !state.settings.budgetStrict
          ? h('p', { class: 'muted small' }, `Cycle suivi depuis le ${dateShort(b.suiviDepuis)} : l'enveloppe est calculée au prorata des jours suivis.`)
          : null,
      ),
      isOn('miniJauges') ? h('div', { class: 'mini-gauges' },
        miniGauge('week', 'Cette semaine', b.semaine),
        miniGauge('month', 'Ce mois', b.mois),
      ) : null,
    );
  }

  const stock = stockSummary(state);
  if (isOn('alerteStock') && isOn('stock') && stock.perimes + stock.urgents + stock.ddm > 0) {
    const bits = [];
    if (stock.perimes) bits.push(`${stock.perimes} produit${stock.perimes > 1 ? 's' : ''} périmé${stock.perimes > 1 ? 's' : ''} (DLC)`);
    if (stock.urgents) bits.push(`${stock.urgents} à consommer vite`);
    if (stock.ddm) bits.push(`${stock.ddm} DDM dépassée${stock.ddm > 1 ? 's' : ''} à vérifier`);
    root.append(h('a', { class: `stock-alert${stock.perimes ? '' : ' is-soft'}`, href: '#stock' }, icon('alert'), h('span', null, `Stock : ${bits.join(' · ')}`), icon('chevron')));
  }
  const objs = objectifsStatus(state, state.expenses.filter((e) => e.date >= b.cycle.start && e.date < b.cycle.end)).filter((o) => o.statut !== 'ok');
  if (objs.length && isOn('alerteObjectifs') && isOn('objectifs')) {
    const worst = objs.sort((a, z) => z.ratio - a.ratio)[0];
    root.append(h('a', { class: `stock-alert${worst.statut === 'depasse' ? '' : ' is-soft'}`, href: '#depenses' }, icon('alert'),
      h('span', null, objs.map((o) => `${o.cat.nom} : ${Math.round(o.ratio * 100)} % de l’objectif`).join(' · ')), icon('chevron')));
  }

  root.append(
    h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: () => openExpenseSheet() }, icon('plus'), 'Ajouter une dépense'),
  );

  if (todays.length) {
    root.append(
      h('h2', { class: 'h-section' }, "Dépenses d'aujourd'hui"),
      expenseList(todays),
    );
  } else {
    root.append(
      h('p', { class: 'empty-line muted' }, "Aucune dépense aujourd'hui. ",
        h('button', { type: 'button', class: 'link', onclick: () => openExpenseSheet() }, 'Ajouter une dépense.')),
    );
  }

  if (isOn('mur')) root.append(wallZone(state));

  if (b.configured && isOn('serie')) {
    root.append(h('p', { class: 'streak muted small' },
      b.streak === 0 ? 'Aucun jour d’affilée sous ton budget pour l’instant.' : `${b.streak} jour${b.streak > 1 ? 's' : ''} d’affilée sous ton budget`));
  }
  return root;
}

function miniGauge(id, label, { reste, plafond }) {
  const over = reste < 0;
  return h('div', { class: `mini${over ? ' is-over' : ''}` },
    h('p', { class: 'mini-label' },
      `${label} : `,
      over ? 'dépassé de ' : 'reste ',
      h('strong', { class: 'num' }, money(Math.abs(reste))),
      ' sur ', h('span', { class: 'num' }, money(Math.max(0, plafond)))),
    gauge({ id, value: reste, max: plafond, over, size: 'small', label }),
  );
}
