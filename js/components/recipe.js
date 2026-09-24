// Fiche recette partagée entre Menus et Courses : ingrédients (ajustables au
// nombre de convives), étapes, « J'ai cuisiné ce plat », favoris.
import { h, icon, capitalize, money, toast, todayISO, uid } from '../utils.js';
import { getState, update } from '../store.js';
import { openDialog } from './dialog.js';
import { openCookDialog } from './cook-dialog.js';
import { stepper } from './stepper.js';
import { isOn } from '../modules.js';

export const mealLabel = (jour, moment) => `${capitalize(jour)} ${moment}`;

/** Lien vers la recette d'origine (Marmiton, 750g…), ouvert dans un nouvel onglet. */
export function sourceLink(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  return h('a', { class: 'source-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), `Voir la recette sur ${host}`);
}

export function findMeal(menu, jour, moment) {
  const day = menu.jours.find((j) => j.jour === jour);
  return day ? day[moment] : null;
}

/** "500 g" pour 2 personnes → "750 g" pour 3. Les quantités sans nombre restent telles quelles. */
export function scaleQuantite(q, from, to) {
  if (!from || !to || from === to) return q;
  return String(q ?? '').replace(/(\d+(?:[.,]\d+)?)/, (m) => {
    const n = parseFloat(m.replace(',', '.')) * (to / from);
    const r = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    return String(r).replace('.', ',');
  });
}

export function openRecipe(week, jour, moment) {
  const menu = week.menu;
  const meal = findMeal(menu, jour, moment);
  if (!meal) return;
  const ref = `${jour} ${moment}`;
  const ingredients = menu.courses.filter((c) => c.pour.includes(ref));
  const steps = meal.recette.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const tags = meal.tags.length ? ` · ${meal.tags.join(', ')}` : '';
  const base = menu.personnes || 2;
  let persons = base;
  const cooked = week.cooked?.[ref];
  const isFav = getState().recettes.some((r) => r.nom.toLowerCase() === meal.nom.toLowerCase());

  const ingList = h('ul', { class: 'plain-list' });
  function drawIngredients() {
    ingList.replaceChildren(...ingredients.map((c) => h('li', null, `${c.article} · ${scaleQuantite(c.quantite, base, persons)}`, persons === base ? h('span', { class: 'num muted' }, ` ${money(c.prix_estime)}`) : null)));
  }
  drawIngredients();
  const pers = stepper({ value: base, step: 1, min: 1, max: 20, label: 'Convives', size: 'stepper-sm', format: (v) => `${v} pers.`, onChange: (v) => { persons = v; drawIngredients(); } });

  let dlg;
  function cook() {
    dlg.close();
    openCookDialog({ title: `${meal.nom} : cuisiné`, ingredients, onDone: () => {
      update((s) => { const w = s.menus.weeks.find((x) => x.id === week.id); if (w) { w.cooked = w.cooked || {}; w.cooked[ref] = todayISO(); } });
    } });
  }
  function favorite() {
    if (isFav) { toast('Déjà dans tes recettes favorites'); return; }
    update((s) => { s.recettes.push({ id: uid(), nom: meal.nom, temps: meal.temps, tags: [...meal.tags], recette: meal.recette, lien: meal.lien || null, ingredients: ingredients.map((c) => ({ article: c.article, quantite: c.quantite, rayon: c.rayon, prix_estime: c.prix_estime })), personnes: base, ajouteLe: todayISO() }); });
    toast('Recette ajoutée aux favoris');
    dlg.close();
  }

  dlg = openDialog({
    title: meal.nom,
    cls: 'sheet-compact',
    content: [
      h('p', { class: 'muted' }, `${mealLabel(jour, moment)} · ${meal.temps} min${tags}`, cooked ? h('span', { class: 'tag-stock' }, 'cuisiné') : null),
      meal.lien && isOn('liensRecettes') ? sourceLink(meal.lien) : null,
      ingredients.length
        ? h('section', null,
            h('div', { class: 'recipe-head' }, h('h3', { class: 'h-small' }, 'Ingrédients'), pers),
            ingList,
            persons !== base ? null : h('p', { class: 'muted small' }, `Quantités pour ${base} personne${base > 1 ? 's' : ''} ; change le nombre de convives pour les recalculer.`))
        : null,
      h('section', null,
        h('h3', { class: 'h-small' }, 'Recette'),
        steps.length > 1
          ? h('ol', { class: 'steps' }, steps.map((s) => h('li', null, s.replace(/^\d+[.)]\s*/, ''))))
          : h('p', null, meal.recette)),
    ],
    actions: [
      isOn('favoris') ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: favorite, disabled: isFav }, icon('check'), isFav ? 'Favori' : 'Favoris') : null,
      isOn('cuisine') ? h('button', { type: 'button', class: 'btn btn-primary', onclick: cook }, icon('pot'), cooked ? 'Cuisiné à nouveau' : 'J’ai cuisiné ce plat') : null,
    ],
  });
}

/** Fiche d'une recette favorite (hors semaine). */
export function openFavoriteRecipe(recipe, { onPlan } = {}) {
  const steps = String(recipe.recette || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const dlg = openDialog({
    title: recipe.nom,
    cls: 'sheet-compact',
    content: [
      h('p', { class: 'muted' }, `${recipe.temps || '?'} min${recipe.tags?.length ? ` · ${recipe.tags.join(', ')}` : ''} · ${recipe.personnes || 2} pers.`),
      recipe.lien && isOn('liensRecettes') ? sourceLink(recipe.lien) : null,
      recipe.ingredients?.length ? h('section', null, h('h3', { class: 'h-small' }, 'Ingrédients'), h('ul', { class: 'plain-list' }, recipe.ingredients.map((c) => h('li', null, `${c.article}${c.quantite ? ` · ${c.quantite}` : ''}`)))) : null,
      h('section', null, h('h3', { class: 'h-small' }, 'Recette'), steps.length > 1 ? h('ol', { class: 'steps' }, steps.map((s) => h('li', null, s.replace(/^\d+[.)]\s*/, '')))) : h('p', null, recipe.recette || '')),
    ],
    actions: [
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { dlg.close(); openCookDialog({ title: `${recipe.nom} : cuisiné`, ingredients: recipe.ingredients || [] }); } }, icon('pot'), 'Cuisiné'),
      onPlan ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { dlg.close(); onPlan(recipe); } }, icon('plus'), 'Mettre au menu') : null,
    ],
  });
}
