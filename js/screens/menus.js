// Écran Menus : générer le prompt, importer le JSON, afficher la semaine.
import { h, icon, money, uid, toast, fmtDate, capitalize, round2, DAYS } from '../utils.js';
import { getState, update, currentWeek } from '../store.js';
import { computeBudget } from '../budget.js';
import { MEAL_OPTIONS, cleanJson, validateMenu, buildPrompt, ecartLineFor, mealCount, coursesTotal } from '../menu-schema.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { openRecipe, mealLabel, openFavoriteRecipe } from '../components/recipe.js';
import { stockPromptLines } from '../stock.js';
import { openTonightSheet } from '../components/tonight-sheet.js';
import { putMealInWeek, todayDayName } from '../planning.js';
import { shareText, menuText, recipeText, recipeUrl, newShareId } from '../share.js';
import { isOn } from '../modules.js';

const ui = { importText: '', importErrors: [] };

export function lastValidatedWeek(state) {
  return [...state.menus.weeks].filter((w) => w.validation).sort((a, z) => (z.validation.date > a.validation.date ? 1 : -1))[0] || null;
}

export function renderMenus() {
  const state = getState();
  const b = computeBudget(state);
  const week = currentWeek();
  const root = h('section', { class: 'screen screen-menus' });

  if (week) root.append(weekHeader(week, b));
  else root.append(h('p', { class: 'empty-line muted' }, 'Pas encore de menu cette semaine. ', h('a', { class: 'link', href: '#prompt-form' }, 'Générer le prompt.')));

  root.append(
    isOn('ceSoir') ? h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: openTonightSheet }, icon('pot'), 'Que cuisiner ce soir ?') : null,
    promptZone(state, b), importZone(state, week));
  if (week) root.append(weekZone(week));
  root.append(h('div', { class: 'row-actions' },
    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openHistory() }, icon('clock'), 'Historique'),
    week && isOn('partage') ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => shareText({ title: 'Menus de la semaine', text: menuText(week) }) }, icon('share'), 'Partager le menu') : null));
  if (isOn('favoris')) root.append(favoritesZone(state));
  return root;
}

/* ---------- a) Générer le prompt ---------- */
function promptZone(state, b) {
  const form = state.promptForm;
  const autoBudget = round2(b.budgetCourses);
  const budgetValue = form.budget === '' ? autoBudget : Number(form.budget);
  const setForm = (k, v) => update((s) => { s.promptForm[k] = v; }, { quiet: true });

  const budgetInput = h('input', { type: 'number', id: 'p-budget', class: 'input', min: '0', step: '0.5', inputmode: 'decimal', value: String(budgetValue),
    onchange: (ev) => setForm('budget', ev.target.value === '' ? '' : ev.target.value) });
  const recalc = h('button', { type: 'button', class: 'link small', onclick: () => { setForm('budget', ''); budgetInput.value = String(round2(computeBudget(getState()).budgetCourses)); } },
    `Recalculer (${money(autoBudget)} = ${state.settings.partCourses} % du budget de la semaine)`);

  const fallback = h('div', { class: 'prompt-fallback', hidden: true });

  async function copy() {
    const sl = stockPromptLines(getState());
    const pf = getState().promptForm;
    const restes = pf.restesDabord ? restesLine(getState()) : null;
    const favs = isOn('favoris') && getState().recettes.length ? `Recettes que j'aime déjà, à réutiliser si elles collent : ${getState().recettes.slice(0, 12).map((r) => r.nom).join(', ')}.` : null;
    const text = buildPrompt(pf, budgetInput.value || autoBudget, ecartLineFor(lastValidatedWeek(getState())), [sl.urgentLine, sl.ddmLine, restes, favs], { liens: isOn('liensRecettes') });
    try {
      await navigator.clipboard.writeText(text);
      toast('Prompt copié. Colle-le dans Claude.');
      fallback.hidden = true;
    } catch {
      const ta = h('textarea', { class: 'input', rows: '8', readonly: true, 'aria-label': 'Prompt à copier' }, text);
      fallback.replaceChildren(h('p', { class: 'form-error' }, 'La copie automatique est bloquée par le navigateur : sélectionne le texte ci-dessous et copie-le.'), ta);
      fallback.hidden = false;
      ta.focus(); ta.select();
    }
  }

  const ecart = ecartLineFor(lastValidatedWeek(state));
  const stockLines = stockPromptLines(state);
  const nStock = state.stock.items.length;
  const placardsTa = h('textarea', { id: 'p-placards', class: 'input', rows: '2', placeholder: 'Ex. riz, pâtes, huile d’olive, épices', onchange: (ev) => setForm('placards', ev.target.value) }, form.placards);
  const placardsField = h('div', { class: 'field' }, h('label', { for: 'p-placards' }, "Ce que j'ai déjà"), placardsTa,
    nStock
      ? h('button', { type: 'button', class: 'link small', onclick: () => { placardsTa.value = stockLines.placards; setForm('placards', stockLines.placards); toast('Champ rempli avec ton stock'); } }, `Remplir avec mon stock (${nStock} produit${nStock > 1 ? 's' : ''})`)
      : h('a', { class: 'link small', href: '#stock' }, 'Remplis ton stock pour le réutiliser ici.'));

  return h('details', { class: 'zone', id: 'prompt-form', open: !currentWeek() },
    h('summary', { class: 'zone-title' }, 'Générer le prompt'),
    h('div', { class: 'zone-body' },
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'p-pers' }, 'Personnes'),
          h('input', { type: 'number', id: 'p-pers', class: 'input', min: '1', max: '20', inputmode: 'numeric', value: String(form.personnes), onchange: (ev) => setForm('personnes', Math.max(1, Number(ev.target.value) || 1)) })),
        h('div', { class: 'field' }, h('label', { for: 'p-temps' }, 'Temps max en semaine (min)'),
          h('input', { type: 'number', id: 'p-temps', class: 'input', min: '5', step: '5', inputmode: 'numeric', value: String(form.tempsMax), onchange: (ev) => setForm('tempsMax', Math.max(5, Number(ev.target.value) || 30)) }))),
      h('div', { class: 'field' }, h('label', { for: 'p-budget' }, 'Budget courses de la semaine (€)'), budgetInput, recalc),
      h('div', { class: 'field' }, h('label', { for: 'p-repas' }, 'Repas à générer'),
        h('select', { id: 'p-repas', class: 'input', value: form.repas, onchange: (ev) => setForm('repas', ev.target.value) },
          MEAL_OPTIONS.map((o) => h('option', { value: o.id }, o.label)))),
      textField('p-regime', 'Régime et contraintes', form.regime, (v) => setForm('regime', v), 'Ex. peu de viande rouge, plats à emporter au bureau'),
      textField('p-allergies', 'Allergies et aversions', form.allergies, (v) => setForm('allergies', v), 'Ex. arachides, pas de coriandre'),
      placardsField,
      h('label', { class: 'switch' },
        h('input', { type: 'checkbox', role: 'switch', checked: !!form.restesDabord, onchange: (ev) => setForm('restesDabord', ev.target.checked) }),
        h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
        h('span', null, 'Restes d’abord', h('span', { class: 'muted small block' }, 'Les trois premiers jours utilisent ce qui périme dans les 3 jours et les restes du menu précédent.'))),
      ecart ? h('p', { class: 'muted small' }, 'Sera ajouté au prompt : « ', ecart, ' »') : null,
      stockLines.urgentLine ? h('p', { class: 'muted small' }, 'Sera ajouté au prompt : « ', stockLines.urgentLine, ' »') : null,
      stockLines.ddmLine ? h('p', { class: 'muted small' }, 'Sera ajouté au prompt : « ', stockLines.ddmLine, ' »') : null,
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: copy }, icon('copy'), 'Copier le prompt'),
      fallback,
    ),
  );
}

function textField(id, label, value, onChange, placeholder) {
  return h('div', { class: 'field' }, h('label', { for: id }, label),
    h('textarea', { id, class: 'input', rows: '2', placeholder, onchange: (ev) => onChange(ev.target.value) }, value));
}

/* ---------- b) Importer le menu ---------- */
function importZone(state, week) {
  const errBox = h('div', { class: 'form-error', role: 'alert', hidden: !ui.importErrors.length },
    ui.importErrors.length ? [h('p', null, 'Le menu n’a pas été importé :'), h('ul', null, ui.importErrors.map((e) => h('li', null, e)))] : null);
  const ta = h('textarea', { id: 'import-json', class: 'input mono-free', rows: '5', placeholder: 'Colle ici la réponse JSON de Claude', 'aria-describedby': 'import-help',
    oninput: (ev) => { ui.importText = ev.target.value; } }, ui.importText);

  async function doImport() {
    const raw = cleanJson(ta.value);
    if (!raw) return showErrors(['le champ est vide : colle la réponse JSON de Claude puis réessaie']);
    let obj;
    try { obj = JSON.parse(raw); }
    catch (err) { return showErrors([`JSON illisible (${err.message}). Vérifie que tu as collé la réponse complète, de la première accolade à la dernière.`]); }
    const res = validateMenu(obj);
    if (!res.ok) return showErrors(res.errors.slice(0, 8).concat(res.errors.length > 8 ? [`… et ${res.errors.length - 8} autres erreurs`] : []));
    if (week && !week.validation) {
      const ok = await confirmDialog({ title: 'Remplacer le menu en cours ?', message: 'Ses courses n’ont pas été validées. Il restera consultable dans l’historique.', confirmLabel: 'Remplacer le menu' });
      if (!ok) return;
    }
    const b = computeBudget(getState());
    const prevu = getState().promptForm.budget === '' ? b.budgetCourses : Number(getState().promptForm.budget);
    ui.importText = ''; ui.importErrors = [];
    update((s) => {
      const w = { id: uid(), menu: res.menu, importedAt: Date.now(), budgetPrevu: round2(prevu), checked: {}, unavailable: {}, manualItems: [], validation: null };
      s.menus.weeks.unshift(w);
      s.menus.currentId = w.id;
    });
    toast('Menu importé pour la semaine');
    window.scrollTo(0, 0);
  }
  function showErrors(list) {
    ui.importErrors = list;
    errBox.hidden = false;
    errBox.replaceChildren(h('p', null, 'Le menu n’a pas été importé :'), h('ul', null, list.map((e) => h('li', null, e))));
    errBox.scrollIntoView({ block: 'nearest' });
  }

  return h('details', { class: 'zone', open: !week || !!ui.importText },
    h('summary', { class: 'zone-title' }, 'Importer le menu'),
    h('div', { class: 'zone-body' },
      h('label', { for: 'import-json' }, 'Réponse de Claude'),
      ta,
      h('p', { id: 'import-help', class: 'muted small' }, 'Les balises ```json sont retirées automatiquement.'),
      errBox,
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: doImport }, 'Importer cette semaine')),
  );
}

/* ---------- c) La semaine ---------- */
function weekHeader(week, b) {
  const menu = week.menu;
  const estime = round2(coursesTotal(menu.courses));
  const prevu = week.budgetPrevu ?? b.budgetCourses;
  const meals = mealCount(menu);
  const perMeal = meals && menu.personnes ? estime / meals / menu.personnes : 0;
  const v = week.validation;
  const over = estime > prevu + 0.005;
  return h('div', { class: 'week-head' },
    h('p', { class: 'muted small' }, `Semaine du ${fmtDate(menu.semaine, { day: 'numeric', month: 'long' })} · ${menu.personnes} personne${menu.personnes > 1 ? 's' : ''}`),
    h('h1', { class: `lead${over ? ' is-over' : ''}` }, 'Budget estimé : ', h('span', { class: 'num' }, money(estime)), ' sur ', h('span', { class: 'num' }, money(prevu)), ' prévus'),
    h('p', { class: 'muted' }, 'Soit ', h('span', { class: 'num' }, money(perMeal)), ' par repas et par personne'),
    v ? h('p', { class: 'validated-line' }, 'Ticket réel : ', h('span', { class: 'num' }, money(v.montantReel)), ' · estimation ', h('span', { class: 'num' }, money(v.estime)),
        v.ecart != null ? [' · écart ', h('span', { class: 'num' }, `${v.ecart > 0 ? '+' : ''}${Math.round(v.ecart * 100)} %`)] : null) : null,
  );
}

function weekZone(week) {
  const menu = week.menu;
  const section = (title, items) => items.length ? h('section', { class: 'tips' }, h('h2', { class: 'h-section' }, title), h('ul', { class: 'plain-list' }, items.map((t) => h('li', null, t)))) : null;
  return h('div', { class: 'week' },
    h('h2', { class: 'h-section' }, 'La semaine'),
    h('div', { class: 'day-cards' }, menu.jours.map((d) => dayCard(week, d))),
    section('Batch cooking', menu.batch_cooking),
    section('Restes', menu.restes),
    section('Conseils', menu.conseils),
  );
}

function dayCard(week, d) {
  return h('article', { class: 'day-card', 'aria-label': capitalize(d.jour) },
    h('h3', { class: 'day-name' }, capitalize(d.jour)),
    mealRow(week, d.jour, 'midi', d.midi),
    mealRow(week, d.jour, 'soir', d.soir),
  );
}

function mealRow(week, jour, moment, meal) {
  if (!meal) return h('div', { class: 'meal meal-empty' }, h('span', { class: 'meal-moment' }, capitalize(moment)), h('span', { class: 'muted' }, 'Pas de repas prévu'));
  return h('button', { type: 'button', class: 'meal', onclick: () => openRecipe(week, jour, moment), 'aria-label': `${mealLabel(jour, moment)} : ${meal.nom}, ouvrir la recette` },
    h('span', { class: 'meal-moment' }, capitalize(moment)),
    h('span', { class: 'meal-body' },
      h('span', { class: 'meal-name' }, meal.nom),
      h('span', { class: 'meal-meta muted small' }, `${meal.temps} min`, meal.tags.length ? ` · ${meal.tags.join(' · ')}` : '', week.cooked?.[`${jour} ${moment}`] ? h('span', { class: 'tag-stock' }, 'cuisiné') : null)),
    icon('chevron', 'meal-chevron'),
  );
}

/* ---------- Historique ---------- */
function openHistory() {
  const state = getState();
  const weeks = state.menus.weeks;
  if (!weeks.length) return openDialog({ title: 'Historique', cls: 'sheet-compact', content: h('p', null, 'Aucune semaine enregistrée pour l’instant. Importe un menu pour commencer.') });
  const dlg = openDialog({
    title: 'Historique',
    content: h('ul', { class: 'history' }, weeks.map((w) => {
      const v = w.validation;
      const isCurrent = w.id === state.menus.currentId;
      return h('li', { class: 'history-item' },
        h('div', null,
          h('strong', null, `Semaine du ${fmtDate(w.menu.semaine, { day: 'numeric', month: 'long', year: 'numeric' })}`, isCurrent ? ' (en cours)' : ''),
          h('p', { class: 'muted small' }, `${w.menu.personnes} pers. · estimation `, h('span', { class: 'num' }, money(coursesTotal(w.menu.courses))),
            v ? [' · ticket ', h('span', { class: 'num' }, money(v.montantReel))] : ' · courses non validées')),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => viewWeek(w) }, 'Voir'),
          isCurrent ? null : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: async () => { if (await redo(w)) dlg.close(); } }, 'Refaire cette semaine')));
    })),
  });
}

function viewWeek(w) {
  openDialog({
    title: `Semaine du ${fmtDate(w.menu.semaine, { day: 'numeric', month: 'long' })}`,
    content: h('div', { class: 'day-cards' }, w.menu.jours.map((d) => dayCard(w, d))),
  });
}

async function redo(w) {
  const cur = currentWeek();
  if (cur && !cur.validation) {
    const ok = await confirmDialog({ title: 'Remplacer le menu en cours ?', message: 'Ses courses n’ont pas été validées. Il restera dans l’historique.', confirmLabel: 'Remplacer le menu' });
    if (!ok) return false;
  }
  const b = computeBudget(getState());
  update((s) => {
    const clone = { id: uid(), menu: JSON.parse(JSON.stringify(w.menu)), importedAt: Date.now(), budgetPrevu: b.budgetCourses, checked: {}, unavailable: {}, manualItems: [], validation: null };
    s.menus.weeks.unshift(clone);
    s.menus.currentId = clone.id;
  });
  toast('Menu réimporté pour cette semaine');
  return true;
}

/* ---------- Restes d'abord ---------- */
/** Phrase forte pour le prompt : ce qui périme sous 3 jours et les restes du menu précédent. */
function restesLine(state) {
  const urgent = stockPromptLines(state).urgentLine;
  const prev = state.menus.weeks.find((w) => w.id === state.menus.currentId) || state.menus.weeks[0];
  const restes = prev?.menu?.restes?.length ? `Restes du menu précédent : ${prev.menu.restes.join(' ; ')}.` : '';
  return `PRIORITÉ ABSOLUE : construis les repas des trois premiers jours autour de ce qui doit être consommé vite. ${urgent || 'Rien ne périme dans les trois jours.'} ${restes}`.trim();
}

/* ---------- Partager une recette : lien public + texte ---------- */
function shareRecipe(r) {
  let shareId = r.partage;
  if (!shareId) {
    shareId = newShareId();
    update((s) => { const x = s.recettes.find((y) => y.id === r.id); if (x) x.partage = shareId; });
  }
  shareText({ title: r.nom, text: recipeText(r), url: recipeUrl(shareId) });
}

/* ---------- Recettes favorites ---------- */
function favoritesZone(state) {
  const list = state.recettes;
  function plan(recipe) {
    let jour = todayDayName();
    let moment = new Date().getHours() < 14 ? 'midi' : 'soir';
    const jourSel = h('select', { class: 'input', 'aria-label': 'Jour', value: jour, onchange: (ev) => { jour = ev.target.value; } }, DAYS.map((d) => h('option', { value: d }, capitalize(d))));
    const momentSel = h('select', { class: 'input', 'aria-label': 'Moment', value: moment, onchange: (ev) => { moment = ev.target.value; } }, [['midi', 'Midi'], ['soir', 'Soir']].map(([v, l]) => h('option', { value: v }, l)));
    const dlg = openDialog({
      title: `Mettre « ${recipe.nom} » au menu`,
      cls: 'sheet-compact',
      content: [h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('label', null, 'Jour'), jourSel), h('div', { class: 'field' }, h('label', null, 'Moment'), momentSel)),
        h('p', { class: 'muted small' }, 'Les ingrédients absents du stock rejoignent la liste de courses de la semaine.')],
      actions: [h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
          update((s) => putMealInWeek(s, { ...recipe, ingredients: (recipe.ingredients || []).map((i) => ({ ...i, enStock: false })) }, jour, moment));
          dlg.close();
          toast(`${recipe.nom} : ${capitalize(jour)} ${moment}`);
        } }, 'Mettre au menu')],
    });
  }
  return h('details', { class: 'zone', open: list.length > 0 && list.length <= 6 },
    h('summary', { class: 'zone-title' }, 'Recettes favorites', list.length ? h('span', { class: 'zone-count num' }, String(list.length)) : null),
    h('div', { class: 'zone-body' },
      list.length
        ? h('ul', { class: 'rows' }, list.map((r) => h('li', { class: 'row-item' },
            h('button', { type: 'button', class: 'row-text link-plain', onclick: () => openFavoriteRecipe(r, { onPlan: plan }) }, r.nom, h('span', { class: 'muted small block' }, `${r.temps || '?'} min · ${(r.ingredients || []).length} ingrédient${(r.ingredients || []).length > 1 ? 's' : ''}${r.tags?.length ? ` · ${r.tags.slice(0, 3).join(', ')}` : ''}`)),
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => plan(r) }, 'Au menu'),
            isOn('partage') ? h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Partager ${r.nom}`, onclick: () => shareRecipe(r) }, icon('share')) : null,
            h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Retirer ${r.nom} des favoris`, onclick: async () => { const ok = await confirmDialog({ title: `Retirer « ${r.nom} » ?`, message: 'La recette disparaît des favoris.', confirmLabel: 'Retirer', danger: true }); if (ok) update((s) => { s.recettes = s.recettes.filter((x) => x.id !== r.id); }); } }, icon('trash')))))
        : h('p', { class: 'muted small' }, 'Depuis une fiche recette, « Favoris » la garde ici pour la remettre au menu en un geste, sans repasser par le prompt.')));
}
