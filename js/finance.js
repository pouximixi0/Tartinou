// Budget avancé : dépenses récurrentes, objectifs par catégorie, relevés bancaires CSV.
import { normalizeText } from './stock.js';
import { fromISO, toISO, round2, daysBetween } from './utils.js';

/* ---------- Dépenses récurrentes ---------- */
/**
 * Repère les dépenses qui reviennent chaque mois (même note, même montant, jour proche)
 * et qui ne sont pas déjà des charges fixes. Retourne [{ nom, montant, jourDuMois, occurrences }].
 */
export function detectRecurring(expenses, chargesFixes = []) {
  const groups = new Map();
  for (const e of expenses) {
    const note = normalizeText(e.note).replace(/\s+/g, ' ').trim();
    if (!note || !(e.montant > 0)) continue;
    const key = `${note}|${Math.round(e.montant * 100)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(e);
  }
  const existing = chargesFixes.map((c) => ({ nom: normalizeText(c.nom), montant: Math.round(c.montant * 100) }));
  const out = [];
  for (const list of groups.values()) {
    const months = new Set(list.map((e) => e.date.slice(0, 7)));
    if (months.size < 2) continue;
    const days = list.map((e) => Number(e.date.slice(8, 10))).sort((a, b) => a - b);
    const spread = days[days.length - 1] - days[0];
    if (spread > 6 && spread < 25) continue; // pas le même jour du mois
    const montant = list[0].montant;
    const nom = list[0].note.trim();
    const cents = Math.round(montant * 100);
    if (existing.some((c) => c.montant === cents || c.nom === normalizeText(nom))) continue;
    out.push({ nom, montant, jourDuMois: days[Math.floor(days.length / 2)], occurrences: months.size, ids: list.map((e) => e.id) });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences || b.montant - a.montant);
}

/* ---------- Objectifs par catégorie ---------- */
/** Pour chaque catégorie avec objectif : { cat, objectif, depense, ratio, statut: 'ok' | 'alerte' | 'depasse' }. */
export function objectifsStatus(state, expensesInCycle) {
  const out = [];
  for (const cat of state.categories) {
    const objectif = Number((state.settings.objectifs || {})[cat.id]);
    if (!(objectif > 0)) continue;
    const depense = expensesInCycle.filter((e) => e.categorieId === cat.id).reduce((a, e) => a + e.montant, 0);
    const ratio = depense / objectif;
    out.push({ cat, objectif, depense: round2(depense), ratio, statut: ratio >= 1 ? 'depasse' : ratio >= 0.8 ? 'alerte' : 'ok' });
  }
  return out;
}

/* ---------- Relevé bancaire CSV ---------- */
function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
function parseNumber(s) {
  const t = String(s || '').replace(/\s|€|EUR/g, '').replace(/−/g, '-');
  if (!t) return null;
  // "1.234,56" ou "1234.56" ou "1234,56"
  const norm = t.includes(',') && t.includes('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.');
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lit un relevé CSV (banques françaises courantes) et retourne les débits :
 * [{ date, libelle, montant (positif = dépensé) }]. Colonnes repérées par leur en-tête ou par leur contenu.
 */
export function parseBankCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], error: 'Le fichier est vide ou ne contient qu’une ligne.' };
  const sample = lines.slice(0, 5).join('\n');
  const sep = [';', ',', '\t'].map((s) => [s, (sample.match(new RegExp(s === '\t' ? '\t' : `\\${s}`, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  // En-tête : première ligne sans date exploitable.
  const first = splitCsvLine(lines[0], sep);
  const hasHeader = !first.some((c) => parseDate(c));
  const header = hasHeader ? first.map((c) => normalizeText(c)) : [];
  const body = hasHeader ? lines.slice(1) : lines;
  const rows = body.map((l) => splitCsvLine(l, sep));
  const findCol = (...keys) => header.findIndex((hh) => keys.some((k) => hh.includes(k)));
  let iDate = findCol('date operation', 'date de l', 'date');
  let iLib = findCol('libelle', 'label', 'description', 'motif', 'details', 'nom');
  let iDebit = findCol('debit');
  let iCredit = findCol('credit');
  let iMontant = findCol('montant', 'amount', 'somme');
  // Sans en-tête utile : on devine.
  if (iDate < 0) iDate = rows[0].findIndex((c) => parseDate(c));
  if (iMontant < 0 && iDebit < 0) {
    const numeric = rows[0].map((c, i) => (i !== iDate && parseNumber(c) != null && /\d/.test(c) ? i : -1)).filter((i) => i >= 0);
    iMontant = numeric.length ? numeric[numeric.length - 1] : -1;
  }
  if (iLib < 0) iLib = rows[0].map((c, i) => (i !== iDate && i !== iMontant && i !== iDebit && i !== iCredit && parseNumber(c) == null ? i : -1)).filter((i) => i >= 0).sort((a, b) => rows[0][b].length - rows[0][a].length)[0] ?? -1;
  if (iDate < 0 || (iMontant < 0 && iDebit < 0)) return { rows: [], error: 'Impossible de repérer les colonnes date et montant. Exporte le relevé en CSV depuis ta banque.' };
  const out = [];
  for (const r of rows) {
    const date = parseDate(r[iDate]);
    if (!date) continue;
    let montant = null;
    if (iDebit >= 0) {
      const d = parseNumber(r[iDebit]);
      if (d != null && d !== 0) montant = Math.abs(d);
      else if (iCredit >= 0 && parseNumber(r[iCredit])) continue; // crédit : ignoré
    } else {
      const m = parseNumber(r[iMontant]);
      if (m == null) continue;
      if (m >= 0) continue; // crédit
      montant = -m;
    }
    if (!(montant > 0)) continue;
    out.push({ date, libelle: (r[iLib] || '').replace(/\s+/g, ' ').trim().slice(0, 80), montant: round2(montant) });
  }
  return { rows: out, error: out.length ? null : 'Aucun débit trouvé dans ce fichier.' };
}

const CAT_KEYWORDS = [
  ['courses', /carrefour|leclerc|lidl|aldi|auchan|intermarche|super u|monoprix|franprix|casino|picard|biocoop|grand frais|boulanger|boucher|primeur|marche/],
  ['transport', /sncf|ratp|tisseo|uber(?! eats)|bolt|total|esso|bp |shell|essence|carburant|peage|vinci|autoroute|parking|blablacar|navigo/],
  ['restaurant', /restau|mcdo|mcdonald|burger|pizza|deliveroo|uber eats|just eat|kebab|sushi|bistro|brasserie|cafe|starbucks/],
  ['sante', /pharma|medecin|docteur|dentiste|hopital|clinique|labo|optique|mutuelle/],
  ['loisirs', /netflix|spotify|disney|canal|cinema|ugc|pathe|fnac|steam|playstation|nintendo|decathlon|sport|salle|concert|theatre/],
  ['maison', /ikea|leroy merlin|castorama|brico|edf|engie|eau |orange|sfr|bouygues|free |assurance|loyer/],
];
export function guessCategoryId(libelle, categories) {
  const t = normalizeText(libelle);
  for (const [id, re] of CAT_KEYWORDS) if (re.test(t) && categories.some((c) => c.id === id)) return id;
  return categories.some((c) => c.id === 'autre') ? 'autre' : categories[0].id;
}

/** Rapproche chaque ligne du relevé d'une dépense saisie (même montant, ±3 jours). */
export function matchBankRows(rows, expenses) {
  const used = new Set();
  return rows.map((r) => {
    const hit = expenses.find((e) => !used.has(e.id) && Math.abs(e.montant - r.montant) < 0.005 && Math.abs(daysBetween(e.date, r.date)) <= 3);
    if (hit) used.add(hit.id);
    return { ...r, expense: hit || null };
  });
}

export const monthLabel = (iso) => fromISO(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
export const isoMonthStart = (iso) => toISO(new Date(fromISO(iso).getFullYear(), fromISO(iso).getMonth(), 1));
