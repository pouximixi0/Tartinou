// Partage vers l'extérieur : Web Share quand le navigateur le propose, sinon
// copie dans le presse-papiers. Et les textes à partager (liste, menu, recette).
import { toast, money, fmtDate, capitalize, DAYS } from './utils.js';

export const canShare = () => typeof navigator.share === 'function';

/** Partage ou copie. Résout 'share' | 'copy' | 'cancel'. */
export async function shareText({ title = 'Tartinou', text = '', url = '' } = {}) {
  if (canShare()) {
    try { await navigator.share({ title, text, url: url || undefined }); return 'share'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  const payload = url ? `${text}\n${url}`.trim() : text;
  try { await navigator.clipboard.writeText(payload); toast('Copié : colle-le où tu veux.'); return 'copy'; }
  catch { toast('Copie impossible dans ce navigateur.'); return 'cancel'; }
}

export const appUrl = () => `${location.origin}${location.pathname}`;
export const inviteUrl = (code) => `${appUrl()}#rejoindre=${encodeURIComponent(code)}`;
export const recipeUrl = (shareId) => `${location.origin}/p/r/${encodeURIComponent(shareId)}`;

/** Liste de courses en texte, par rayon, avec cases à cocher. */
export function shoppingListText(week, items) {
  const groups = new Map();
  for (const it of items) (groups.get(it.rayon) || groups.set(it.rayon, []).get(it.rayon)).push(it);
  const lines = [`Courses · semaine du ${fmtDate(week.menu.semaine, { day: 'numeric', month: 'long' })}`];
  for (const [rayon, list] of groups) {
    lines.push('', rayon.toUpperCase());
    for (const it of list) lines.push(`${week.checked[it.key] ? '☑' : '☐'} ${it.article}${it.quantite ? ` · ${it.quantite}` : ''}${it.prix_estime ? ` (${money(it.prix_estime)})` : ''}`);
  }
  const total = items.reduce((a, it) => a + (Number(it.prix_estime) || 0), 0);
  lines.push('', `Total estimé : ${money(total)}`);
  return lines.join('\n');
}

/** Le menu de la semaine en texte. */
export function menuText(week) {
  const m = week.menu;
  const lines = [`Menus · semaine du ${fmtDate(m.semaine, { day: 'numeric', month: 'long' })} · ${m.personnes} pers.`];
  for (const d of [...m.jours].sort((a, b) => DAYS.indexOf(a.jour) - DAYS.indexOf(b.jour))) {
    lines.push('', capitalize(d.jour));
    if (d.midi) lines.push(`  Midi : ${d.midi.nom} (${d.midi.temps} min)`);
    if (d.soir) lines.push(`  Soir : ${d.soir.nom} (${d.soir.temps} min)`);
  }
  if (m.batch_cooking?.length) lines.push('', 'Batch cooking', ...m.batch_cooking.map((t) => `• ${t}`));
  return lines.join('\n');
}

/** Une recette en texte. */
export function recipeText(r) {
  const lines = [r.nom, `${r.temps || '?'} min · ${r.personnes || 2} pers.${r.tags?.length ? ` · ${r.tags.join(', ')}` : ''}`];
  if (r.ingredients?.length) lines.push('', 'Ingrédients', ...r.ingredients.map((i) => `• ${i.article}${i.quantite ? ` · ${i.quantite}` : ''}`));
  const steps = String(r.recette || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  lines.push('', 'Recette', ...steps.map((s, i) => (/^\d+[.)]/.test(s) ? s : `${i + 1}. ${s}`)));
  return lines.join('\n');
}

export const newShareId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
