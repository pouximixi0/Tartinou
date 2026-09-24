// Vie du foyer : fil d'activité (qui a fait quoi) et messages du mur.
import { uid, todayISO, money, fmtDate, capitalize } from './utils.js';
import { fmtQte } from './stock.js';

/** Événements récents du foyer, du plus récent au plus ancien. */
export function activityFeed(state, limit = 40) {
  const out = [];
  for (const e of state.expenses) if (e.createdAt) out.push({ at: e.createdAt, date: e.date, auteur: e.auteur, icon: 'list', text: `${e.note || 'Dépense'} · ${money(e.montant)}`, url: '#depenses' });
  const TYPES = { ajout: 'a ajouté', conso: 'a consommé', jete: 'a jeté', retrait: 'a retiré' };
  for (const j of state.stock.journal) if (j.at) out.push({ at: j.at, date: j.date, auteur: j.auteur, icon: j.type === 'jete' ? 'trash' : 'box', text: `${TYPES[j.type] || j.type} ${j.nom} (${fmtQte({ qte: j.qte, unite: j.unite, conditionnement: '' })})`, verb: true, url: '#stock', bad: j.type === 'jete' });
  for (const w of state.menus.weeks) {
    if (w.importedAt) out.push({ at: w.importedAt, date: new Date(w.importedAt).toISOString().slice(0, 10), auteur: null, icon: 'pot', text: `Menu importé pour la semaine du ${fmtDate(w.menu.semaine, { day: 'numeric', month: 'short' })}`, url: '#menus' });
    if (w.validation) out.push({ at: w.validation.expenseAt || Date.parse(w.validation.date), date: w.validation.date, auteur: w.validation.auteur, icon: 'basket', text: `Courses validées · ticket ${money(w.validation.montantReel)}`, url: '#courses' });
    for (const [ref, date] of Object.entries(w.cooked || {})) {
      const [jour, moment] = ref.split(' ');
      const meal = w.menu.jours.find((d) => d.jour === jour)?.[moment];
      if (meal) out.push({ at: Date.parse(date) + 12 * 3600000, date, auteur: null, icon: 'check', text: `${meal.nom} cuisiné (${capitalize(jour)} ${moment})`, url: '#menus' });
    }
  }
  for (const m of state.messages) out.push({ at: m.at, date: m.date, auteur: m.auteur, icon: 'copy', text: m.texte, message: true, url: '#aujourdhui' });
  return out.filter((x) => Number.isFinite(x.at)).sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Mutateur : poste un message sur le mur. */
export function postMessage(s, auteur, texte) {
  const t = String(texte || '').trim().slice(0, 500);
  if (!t) return null;
  const m = { id: uid(), auteur: auteur || null, texte: t, date: todayISO(), at: Date.now(), epingle: false };
  s.messages.push(m);
  if (s.messages.length > 300) s.messages.splice(0, s.messages.length - 300);
  return m;
}
export const relativeTime = (at) => {
  const d = Date.now() - at;
  if (d < 60000) return 'à l’instant';
  if (d < 3600000) return `il y a ${Math.round(d / 60000)} min`;
  if (d < 86400000) return `il y a ${Math.round(d / 3600000)} h`;
  return fmtDate(new Date(at).toISOString().slice(0, 10), { day: 'numeric', month: 'short' });
};
