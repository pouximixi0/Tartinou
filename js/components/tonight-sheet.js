// « Que cuisiner ce soir ? » : un prompt ciblé sur ce qui périme, puis import
// de la recette obtenue dans le repas du jour (et en favori si on veut).
import { h, icon, toast, capitalize, DAYS, uid, todayISO } from '../utils.js';
import { getState, update, currentWeek } from '../store.js';
import { stockPromptLines } from '../stock.js';
import { buildTonightPrompt, cleanJson, validateRecipe } from '../menu-schema.js';
import { putMealInWeek, todayDayName } from '../planning.js';
import { openDialog } from './dialog.js';

export function openTonightSheet() {
  const state = getState();
  const form = state.promptForm;
  const week = currentWeek();
  const restes = week ? week.menu.restes : [];
  let jour = todayDayName();
  let moment = new Date().getHours() < 14 ? 'midi' : 'soir';
  const quand = () => (jour === todayDayName() ? (moment === 'midi' ? 'ce midi' : 'ce soir') : `${jour} ${moment}`);
  const prompt = () => buildTonightPrompt({ personnes: form.personnes, tempsMax: form.tempsMax, regime: form.regime, allergies: form.allergies }, stockPromptLines(getState()), restes, quand());

  const jourSel = h('select', { class: 'input', 'aria-label': 'Jour', value: jour, onchange: (ev) => { jour = ev.target.value; } }, DAYS.map((d) => h('option', { value: d }, capitalize(d))));
  const momentSel = h('select', { class: 'input', 'aria-label': 'Moment', value: moment, onchange: (ev) => { moment = ev.target.value; } }, [['midi', 'Midi'], ['soir', 'Soir']].map(([v, l]) => h('option', { value: v }, l)));
  const fallback = h('textarea', { class: 'input', rows: '6', readonly: true, hidden: true, 'aria-label': 'Prompt' });
  const ta = h('textarea', { class: 'input', rows: '5', placeholder: 'Colle ici la réponse JSON', 'aria-label': 'Réponse' });
  const favBox = h('input', { type: 'checkbox', checked: true });
  const err = h('div', { class: 'form-error', role: 'alert', hidden: true });

  async function copy() {
    const text = prompt();
    try { await navigator.clipboard.writeText(text); toast('Prompt copié. Colle-le dans Claude.'); fallback.hidden = true; }
    catch { fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select(); }
  }
  function importRecipe() {
    const raw = cleanJson(ta.value);
    if (!raw) { err.textContent = 'Colle la réponse JSON de Claude.'; err.hidden = false; return; }
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { err.textContent = `JSON illisible (${e.message}).`; err.hidden = false; return; }
    const res = validateRecipe(obj);
    if (!res.ok) { err.replaceChildren(h('p', null, 'Recette non importée :'), h('ul', null, res.errors.map((x) => h('li', null, x)))); err.hidden = false; return; }
    update((s) => {
      putMealInWeek(s, res.recipe, jour, moment);
      if (favBox.checked && !s.recettes.some((r) => r.nom.toLowerCase() === res.recipe.nom.toLowerCase())) {
        s.recettes.push({ id: uid(), nom: res.recipe.nom, temps: res.recipe.temps, tags: res.recipe.tags, recette: res.recipe.recette, ingredients: res.recipe.ingredients.map(({ article, quantite, rayon, prix_estime }) => ({ article, quantite, rayon, prix_estime })), personnes: res.recipe.personnes, ajouteLe: todayISO() });
      }
    });
    toast(`${res.recipe.nom} mis au menu de ${quand()}`);
    dlg.close();
  }

  const dlg = openDialog({
    title: 'Que cuisiner ce soir ?',
    content: [
      h('p', { class: 'muted small' }, 'Le prompt reprend ton stock, ce qui périme, les restes du menu et tes contraintes. Colle-le dans Claude, puis colle sa réponse ici.'),
      h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('label', null, 'Jour'), jourSel), h('div', { class: 'field' }, h('label', null, 'Moment'), momentSel)),
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: copy }, icon('copy'), 'Copier le prompt'),
      fallback,
      h('div', { class: 'field' }, h('label', null, 'Réponse de Claude'), ta),
      h('label', { class: 'switch small' }, favBox, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', null, 'Garder la recette dans mes favoris')),
      err,
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: importRecipe }, 'Mettre au menu'),
    ],
  });
}
