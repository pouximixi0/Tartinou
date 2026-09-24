// Placer une recette dans la semaine (menu en cours ou semaine créée à la volée).
import { uid, todayISO, mondayOf, DAYS } from './utils.js';
import { computeBudget } from './budget.js';

const dayOf = (iso) => DAYS[(new Date(iso.slice(0, 4), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay() + 6) % 7];
export const todayDayName = () => dayOf(todayISO());

/** Mutateur : met `recipe` au repas `jour`/`moment` de la semaine en cours (créée si besoin). Retourne la semaine. */
export function putMealInWeek(s, recipe, jour, moment) {
  let w = s.menus.weeks.find((x) => x.id === s.menus.currentId);
  if (!w || w.validation) {
    const b = computeBudget(s);
    w = { id: uid(), menu: { semaine: mondayOf(todayISO()), personnes: recipe.personnes || s.promptForm.personnes || 2, budget_estime: 0, jours: [], courses: [], batch_cooking: [], restes: [], conseils: [] },
      importedAt: Date.now(), budgetPrevu: b.budgetCourses, checked: {}, unavailable: {}, manualItems: [], validation: null, cooked: {} };
    s.menus.weeks.unshift(w);
    s.menus.currentId = w.id;
  }
  let day = w.menu.jours.find((j) => j.jour === jour);
  if (!day) {
    day = { jour, midi: null, soir: null };
    w.menu.jours.push(day);
    w.menu.jours.sort((a, b) => DAYS.indexOf(a.jour) - DAYS.indexOf(b.jour));
  }
  const ref = `${jour} ${moment}`;
  // Anciens ingrédients liés à ce repas : on les détache (ou on les retire s'ils ne servaient qu'à lui).
  w.menu.courses = w.menu.courses.map((c) => ({ ...c, pour: c.pour.filter((p) => p !== ref) })).filter((c) => c.pour.length);
  day[moment] = { nom: recipe.nom, temps: recipe.temps || 30, tags: recipe.tags || [], recette: recipe.recette || '' };
  for (const ing of recipe.ingredients || []) {
    if (ing.enStock) continue;
    const existing = w.menu.courses.find((c) => c.article.toLowerCase() === ing.article.toLowerCase());
    if (existing) { if (!existing.pour.includes(ref)) existing.pour.push(ref); continue; }
    w.menu.courses.push({ rayon: ing.rayon || 'Autre', article: ing.article, quantite: String(ing.quantite || ''), prix_estime: Number(ing.prix_estime) || 0, pour: [ref] });
  }
  return w;
}
