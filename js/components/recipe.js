// Fiche recette partagée entre Menus et Courses.
import { h, capitalize, money } from '../utils.js';
import { openDialog } from './dialog.js';

export const mealLabel = (jour, moment) => `${capitalize(jour)} ${moment}`;

export function findMeal(menu, jour, moment) {
  const day = menu.jours.find((j) => j.jour === jour);
  return day ? day[moment] : null;
}

export function openRecipe(week, jour, moment) {
  const menu = week.menu;
  const meal = findMeal(menu, jour, moment);
  if (!meal) return;
  const ref = `${jour} ${moment}`;
  const ingredients = menu.courses.filter((c) => c.pour.includes(ref));
  const steps = meal.recette.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const tags = meal.tags.length ? ` · ${meal.tags.join(', ')}` : '';
  openDialog({
    title: meal.nom,
    cls: 'sheet-compact',
    content: [
      h('p', { class: 'muted' }, `${mealLabel(jour, moment)} · ${meal.temps} min${tags}`),
      ingredients.length
        ? h('section', null,
            h('h3', { class: 'h-small' }, 'Sur la liste de courses'),
            h('ul', { class: 'plain-list' }, ingredients.map((c) =>
              h('li', null, `${c.article} · ${c.quantite}`, h('span', { class: 'num muted' }, ` ${money(c.prix_estime)}`)))))
        : null,
      h('section', null,
        h('h3', { class: 'h-small' }, 'Recette'),
        steps.length > 1
          ? h('ol', { class: 'steps' }, steps.map((s) => h('li', null, s.replace(/^\d+[.)]\s*/, ''))))
          : h('p', null, meal.recette)),
    ],
  });
}
