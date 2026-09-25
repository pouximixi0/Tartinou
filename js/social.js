// Vie du foyer : publications du flux (messages, recettes, menus, listes),
// réactions, commentaires, mentions, et fil d'activité automatique.
import { uid, todayISO, money, fmtDate, capitalize } from './utils.js';
import { fmtQte } from './stock.js';

export const REACTIONS = ['❤️', '👍', '😋', '😂', '👏'];

/* ---------- Publications ---------- */
/**
 * Mutateur : crée une publication.
 * type : 'message' | 'recette' | 'menu' | 'liste' ; payload selon le type (recette : la recette entière).
 */
export function createPost(s, { type = 'message', auteur = null, texte = '', payload = null }) {
  const t = String(texte || '').trim().slice(0, 1000);
  if (!t && !payload) return null;
  const p = { id: uid(), type, auteur, texte: t, payload, date: todayISO(), at: Date.now(), epingle: false, reactions: {}, commentaires: [] };
  s.posts.push(p);
  if (s.posts.length > 500) s.posts.splice(0, s.posts.length - 500);
  return p;
}
export function toggleReaction(s, postId, emoji, nom) {
  const p = s.posts.find((x) => x.id === postId);
  if (!p || !nom) return;
  p.reactions = p.reactions || {};
  const list = p.reactions[emoji] || [];
  p.reactions[emoji] = list.includes(nom) ? list.filter((n) => n !== nom) : [...list, nom];
  if (!p.reactions[emoji].length) delete p.reactions[emoji];
}
export function addComment(s, postId, auteur, texte) {
  const p = s.posts.find((x) => x.id === postId);
  const t = String(texte || '').trim().slice(0, 600);
  if (!p || !t) return null;
  p.commentaires = p.commentaires || [];
  const c = { id: uid(), auteur, texte: t, at: Date.now() };
  p.commentaires.push(c);
  return c;
}
export function removeComment(s, postId, commentId) {
  const p = s.posts.find((x) => x.id === postId);
  if (p) p.commentaires = (p.commentaires || []).filter((c) => c.id !== commentId);
}
export function removePost(s, postId) { s.posts = s.posts.filter((x) => x.id !== postId); }
export function togglePin(s, postId) { const p = s.posts.find((x) => x.id === postId); if (p) p.epingle = !p.epingle; }

export const sortedPosts = (posts) => [...posts].sort((a, b) => (b.epingle - a.epingle) || b.at - a.at);
export const reactionCount = (p) => Object.values(p.reactions || {}).reduce((a, l) => a + l.length, 0);
export const mentionsIn = (texte, membres) => membres.filter((m) => new RegExp(`@${m.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(texte || ''));

/** Découpe un texte en morceaux : les @mentions sont marquées. */
export function splitMentions(texte) {
  const out = [];
  const re = /@([\p{L}\p{N}_.-]{2,30})/gu;
  let last = 0, m;
  while ((m = re.exec(texte))) {
    if (m.index > last) out.push({ text: texte.slice(last, m.index) });
    out.push({ mention: m[1], text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < texte.length) out.push({ text: texte.slice(last) });
  return out;
}

/** Nombre de publications plus récentes que `since` (timestamp) écrites par d'autres. */
export const unreadCount = (posts, since, me) => posts.filter((p) => p.at > since && p.auteur !== me).length;

/* ---------- Activité automatique ---------- */
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
  return out.filter((x) => Number.isFinite(x.at)).sort((a, b) => b.at - a.at).slice(0, limit);
}

export const relativeTime = (at) => {
  const d = Date.now() - at;
  if (d < 60000) return 'à l’instant';
  if (d < 3600000) return `il y a ${Math.round(d / 60000)} min`;
  if (d < 86400000) return `il y a ${Math.round(d / 3600000)} h`;
  return fmtDate(new Date(at).toISOString().slice(0, 10), { day: 'numeric', month: 'short' });
};
export const initials = (nom) => String(nom || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
