// Écran Courses : liste de la semaine par rayon, cases à cocher, ajout manuel,
// validation du ticket (le seul bouton qui mélange moutarde et vert).
import { h, icon, money, uid, toast, todayISO, fmtDate, parseAmount, moneyPlain, round2, capitalize } from '../utils.js';
import { getState, update, currentWeek, coursesCategoryId } from '../store.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { openRecipe, findMeal, mealLabel } from '../components/recipe.js';
import { findInStock } from '../stock.js';
import { openRangerSheet } from '../components/ranger-sheet.js';
import { aRacheterZone } from './stock.js';
import { shareText, shoppingListText } from '../share.js';
import { isOn } from '../modules.js';

export function renderShopping() {
  const week = currentWeek();
  const root = h('section', { class: 'screen screen-shopping' });
  if (!week) {
    root.append(h('div', { class: 'empty' },
      h('p', null, 'Pas encore de liste de courses : elle se remplit à partir du menu de la semaine.'),
      h('a', { class: 'btn btn-primary', href: '#menus' }, 'Importer un menu')));
    if (isOn('aRacheter') && isOn('stock')) root.append(aRacheterZone(getState()));
    return root;
  }
  const frozen = !!week.validation;
  const items = allItems(week);
  const checked = items.filter((it) => week.checked[it.key]);
  const totalChecked = round2(checked.reduce((a, it) => a + it.prix_estime, 0));
  const totalAll = round2(items.reduce((a, it) => a + it.prix_estime, 0));

  root.append(
    h('div', { class: 'shop-head' },
      h('p', { class: 'muted small' }, `Semaine du ${fmtDate(week.menu.semaine, { day: 'numeric', month: 'long' })}`),
      h('h1', { class: 'lead' }, h('span', { class: 'num' }, `${checked.length} / ${items.length}`), ' articles'),
      h('p', null, 'Dans le panier : ', h('strong', { class: 'num' }, money(totalChecked)), h('span', { class: 'muted' }, ' · liste complète ', h('span', { class: 'num' }, money(totalAll)))),
      frozen ? h('p', { class: 'validated-line' }, `Courses validées le ${fmtDate(week.validation.date, { day: 'numeric', month: 'long' })} : ticket `, h('span', { class: 'num' }, money(week.validation.montantReel)), ' pour ', h('span', { class: 'num' }, money(week.validation.estime)), ' estimés.') : null),
  );

  if (isOn('partage')) root.append(h('div', { class: 'row-actions' },
    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => shareText({ title: 'Liste de courses', text: shoppingListText(week, items) }) }, icon('share'), 'Partager la liste')));

  if (frozen && !week.rangeAt && isOn('stock')) {
    root.append(h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => rangerCourses(week, items) }, icon('box'), 'Ranger les courses dans le stock'));
  }

  // Groupes par rayon, cochés en bas de leur rayon.
  const groups = new Map();
  for (const it of items) (groups.get(it.rayon) || groups.set(it.rayon, []).get(it.rayon)).push(it);
  for (const [rayon, list] of groups) {
    const ordered = [...list.filter((it) => !week.checked[it.key]), ...list.filter((it) => week.checked[it.key])];
    root.append(
      h('section', { class: 'rayon', 'aria-label': rayon },
        h('h2', { class: 'h-section' }, rayon),
        h('ul', { class: 'shop-list' }, ordered.map((it) => itemRow(week, it, frozen)))),
    );
  }

  if (!frozen) {
    root.append(
      addManualForm(week),
      h('button', { type: 'button', class: 'btn btn-validate btn-block btn-tall', onclick: () => validate(week, totalChecked, items) }, icon('check'), 'Valider les courses'),
    );
  }
  if (isOn('aRacheter') && isOn('stock')) root.append(aRacheterZone(getState()));
  return root;
}

/** Étiquette « en stock » quand un article de la liste ressemble à un produit du stock. */
function stockTag(it) {
  const hits = findInStock(getState().stock.items, it.article);
  if (!hits.length) return null;
  const exact = hits.some((x) => x.match.exact);
  const total = hits.reduce((a, x) => a + x.item.qte, 0);
  return h('span', { class: 'tag-stock', title: hits.map((x) => x.item.nom).join(', ') }, exact ? `en stock : ${String(Math.round(total * 100) / 100).replace('.', ',')}` : 'en stock ?');
}

/** Les articles cochés du ticket entrent dans le stock. */
function rangerCourses(week, items) {
  const bought = items.filter((it) => week.checked[it.key] && !week.unavailable[it.key]);
  if (!bought.length) { toast('Aucun article coché à ranger.'); return; }
  openRangerSheet({ items: bought, onDone: (s) => { const w = s.menus.weeks.find((x) => x.id === week.id); if (w) w.rangeAt = todayISO(); } });
}

function allItems(week) {
  const fromMenu = week.menu.courses.map((c, i) => ({ key: `c${i}`, ...c }));
  const manual = (week.manualItems || []).map((m) => ({ key: `m${m.id}`, rayon: m.rayon || 'Autre', article: m.article, quantite: m.quantite || '', prix_estime: Number(m.prix_estime) || 0, pour: [], manual: true, id: m.id }));
  return [...fromMenu, ...manual];
}

function itemRow(week, it, frozen) {
  const isChecked = !!week.checked[it.key];
  const unavailable = !!week.unavailable[it.key];
  const inputId = `it-${it.key}`;
  const row = h('li', { class: `shop-item${isChecked ? ' is-checked' : ''}${unavailable ? ' is-unavailable' : ''}` });
  const box = h('input', { type: 'checkbox', id: inputId, class: 'check', checked: isChecked, disabled: frozen,
    onchange: (ev) => {
      const on = ev.target.checked;
      row.classList.toggle('is-checked', on);
      // Laisse la ligne se barrer avant de réordonner le rayon.
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260;
      setTimeout(() => update((s) => { const w = s.menus.weeks.find((x) => x.id === week.id); if (on) w.checked[it.key] = true; else delete w.checked[it.key]; }), delay);
    } });
  row.append(
    h('div', { class: 'shop-main' },
      box,
      h('label', { for: inputId, class: 'shop-label' },
        h('span', { class: 'shop-name' }, it.article),
        it.quantite ? h('span', { class: 'muted small' }, ` · ${it.quantite}`) : null,
        unavailable ? h('span', { class: 'tag-unavailable' }, 'introuvable') : null,
        isChecked || !isOn('tagEnStock') || !isOn('stock') ? null : stockTag(it)),
      h('span', { class: 'num shop-price' }, money(it.prix_estime))),
    h('div', { class: 'shop-sub' },
      it.pour.length ? h('button', { type: 'button', class: 'link small', onclick: () => showMeals(week, it) }, `pour : ${it.pour.join(', ')}`) : h('span', { class: 'muted small' }, it.manual ? 'ajouté à la main' : ''),
      frozen ? null : it.manual
        ? h('button', { type: 'button', class: 'link small', onclick: () => update((s) => { const w = s.menus.weeks.find((x) => x.id === week.id); w.manualItems = w.manualItems.filter((m) => m.id !== it.id); delete w.checked[it.key]; }) }, 'Retirer')
        : h('button', { type: 'button', class: 'link small', 'aria-pressed': String(unavailable), onclick: () => markUnavailable(week, it) }, unavailable ? 'Finalement trouvé' : 'Introuvable')),
  );
  return row;
}

function mealsOf(week, it) {
  return it.pour.map((ref) => {
    const [jour, moment] = ref.split(' ');
    return { jour, moment, meal: findMeal(week.menu, jour, moment) };
  });
}

function showMeals(week, it) {
  const dlg = openDialog({
    title: it.article,
    cls: 'sheet-compact',
    content: h('ul', { class: 'plain-list' }, mealsOf(week, it).map(({ jour, moment, meal }) =>
      h('li', null, meal
        ? h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); openRecipe(week, jour, moment); } }, `${mealLabel(jour, moment)} : ${meal.nom}`)
        : `${mealLabel(jour, moment)} : repas absent du menu`))),
  });
}

function markUnavailable(week, it) {
  const now = !week.unavailable[it.key];
  update((s) => { const w = s.menus.weeks.find((x) => x.id === week.id); if (now) w.unavailable[it.key] = true; else delete w.unavailable[it.key]; });
  if (!now) return;
  const touched = mealsOf(week, it).filter((m) => m.meal);
  openDialog({
    title: `${it.article} introuvable`,
    cls: 'sheet-compact',
    content: touched.length
      ? [h('p', null, 'Repas concernés, à adapter ou remplacer :'), h('ul', { class: 'plain-list' }, touched.map(({ jour, moment, meal }) => h('li', null, `${mealLabel(jour, moment)} : ${meal.nom}`)))]
      : h('p', null, 'Cet article n’est lié à aucun repas du menu.'),
  });
}

function addManualForm(week) {
  const article = h('input', { type: 'text', id: 'man-article', class: 'input', placeholder: 'Ex. papier toilette', maxlength: '60', autocomplete: 'off' });
  const qte = h('input', { type: 'text', id: 'man-qte', class: 'input', placeholder: '1', maxlength: '20', autocomplete: 'off' });
  const prix = h('input', { type: 'text', id: 'man-prix', class: 'input', inputmode: 'decimal', placeholder: '0,00' });
  const rayon = h('input', { type: 'text', id: 'man-rayon', class: 'input', placeholder: 'Autre', list: 'rayons-list', maxlength: '40' });
  const rayons = [...new Set(week.menu.courses.map((c) => c.rayon))];
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  function add() {
    const nom = article.value.trim();
    if (!nom) { err.textContent = 'Indique le nom de l’article avant de l’ajouter.'; err.hidden = false; article.focus(); return; }
    const p = prix.value.trim() ? parseAmount(prix.value) : 0;
    if (Number.isNaN(p)) { err.textContent = 'Le prix doit être un nombre, par exemple 2,50.'; err.hidden = false; prix.focus(); return; }
    update((s) => { const w = s.menus.weeks.find((x) => x.id === week.id); w.manualItems.push({ id: uid(), article: nom, quantite: qte.value.trim(), prix_estime: p, rayon: rayon.value.trim() || 'Autre' }); });
    toast('Article ajouté à la liste');
  }
  return h('details', { class: 'zone' },
    h('summary', { class: 'zone-title' }, 'Ajouter un article hors menu'),
    h('div', { class: 'zone-body' },
      h('div', { class: 'field' }, h('label', { for: 'man-article' }, 'Article'), article),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'man-qte' }, 'Quantité'), qte),
        h('div', { class: 'field' }, h('label', { for: 'man-prix' }, 'Prix estimé (€)'), prix)),
      h('div', { class: 'field' }, h('label', { for: 'man-rayon' }, 'Rayon'), rayon, h('datalist', { id: 'rayons-list' }, rayons.map((r) => h('option', { value: r })))),
      err,
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: add }, icon('plus'), 'Ajouter à la liste')),
  );
}

/** Demande le montant du ticket, crée la dépense Courses et fige la liste. */
function validate(week, estime, items) {
  const input = h('input', { type: 'text', id: 'ticket', class: 'input input-big num', inputmode: 'decimal', value: moneyPlain(estime), autocomplete: 'off' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const dlg = openDialog({
    title: 'Valider les courses',
    cls: 'sheet-compact',
    content: [
      h('div', { class: 'field' }, h('label', { for: 'ticket' }, 'Montant réel du ticket (€)'), input),
      h('p', { class: 'muted small' }, 'Pré-rempli avec l’estimation des articles cochés (', h('span', { class: 'num' }, money(estime)), '). Une dépense « Courses » sera créée à la date du jour.'),
      err,
    ],
    actions: [
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'),
      h('button', { type: 'button', class: 'btn btn-validate', onclick: confirm }, 'Enregistrer le ticket'),
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 50);

  function confirm() {
    const reel = parseAmount(input.value);
    if (!(reel >= 0)) { err.textContent = 'Le montant doit être un nombre, par exemple 84,30.'; err.hidden = false; input.focus(); return; }
    const today = todayISO();
    const expenseId = uid();
    update((s) => {
      s.expenses.push({ id: expenseId, montant: reel, categorieId: coursesCategoryId(), note: `Courses · semaine du ${fmtDate(week.menu.semaine, { day: 'numeric', month: 'short' })}`, date: today, createdAt: Date.now() });
      const w = s.menus.weeks.find((x) => x.id === week.id);
      w.validation = { montantReel: reel, estime, ecart: estime > 0 ? round2((reel - estime) / estime) : null, date: today, expenseId };
    });
    dlg.close();
    toast(`Ticket de ${money(reel)} enregistré dans tes dépenses`);
    if (isOn('rangerApresTicket') && isOn('stock')) rangerCourses(week, items);
  }
}
