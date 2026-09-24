// Validation stricte du JSON de menu et assemblage du prompt.
import { DAYS, nextMonday, todayISO, fmtDate } from './utils.js';

export const SCHEMA_TEXT = `{
  "semaine": "2026-09-07",
  "personnes": 2,
  "budget_estime": 85,
  "jours": [
    {
      "jour": "lundi",
      "midi": { "nom": "Salade de lentilles", "temps": 15, "tags": ["végé", "froid"], "recette": "Étapes courtes…" },
      "soir": { "nom": "Poulet au citron, riz", "temps": 35, "tags": [], "recette": "Étapes courtes…" }
    }
  ],
  "courses": [
    { "rayon": "Fruits & légumes", "article": "Citrons", "quantite": "3", "prix_estime": 1.5, "pour": ["lundi soir"] }
  ],
  "batch_cooking": ["Dimanche : cuire 500 g de riz pour lundi et mercredi"],
  "restes": ["Le poulet de lundi → wraps mardi midi"],
  "conseils": ["Le saumon est souvent en promo cette semaine"]
}`;

export const MEAL_OPTIONS = [
  { id: 'midi-soir-7', label: 'Midi et soir, 7 jours', phrase: 'midi et soir du lundi au dimanche' },
  { id: 'soir-7', label: 'Soirs seulement, 7 jours', phrase: 'le soir uniquement, du lundi au dimanche' },
  { id: 'midi-soir-5', label: 'Midi et soir, 5 jours', phrase: 'midi et soir du lundi au vendredi' },
  { id: 'soir-5', label: 'Soirs seulement, 5 jours', phrase: 'le soir uniquement, du lundi au vendredi' },
  { id: 'midi-7', label: 'Midis seulement, 7 jours', phrase: 'le midi uniquement, du lundi au dimanche' },
];

/** Retire les balises ```json … ``` et le texte autour de l'objet. */
export function cleanJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first > 0 || (last >= 0 && last < t.length - 1)) t = t.slice(first, last + 1);
  return t;
}

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const POUR_RE = new RegExp(`^(${DAYS.join('|')}) (midi|soir)$`);

/**
 * Valide un menu. Retourne { ok: true, menu } (menu normalisé)
 * ou { ok: false, errors: ['champ courses[3].prix_estime manquant', …] }.
 */
export function validateMenu(obj) {
  const errors = [];
  const missing = (p) => errors.push(`champ ${p} manquant`);
  const wrong = (p, expected) => errors.push(`champ ${p} doit être ${expected}`);

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['le JSON doit être un objet { … }'] };

  if (obj.semaine === undefined) missing('semaine');
  else if (!isStr(obj.semaine) || !/^\d{4}-\d{2}-\d{2}$/.test(obj.semaine)) wrong('semaine', 'une date AAAA-MM-JJ');

  if (obj.personnes === undefined) missing('personnes');
  else if (!Number.isInteger(obj.personnes) || obj.personnes < 1) wrong('personnes', 'un entier ≥ 1');

  if (obj.budget_estime === undefined) missing('budget_estime');
  else if (!isNum(obj.budget_estime) || obj.budget_estime < 0) wrong('budget_estime', 'un nombre en euros');

  if (obj.jours === undefined) missing('jours');
  else if (!Array.isArray(obj.jours) || !obj.jours.length) wrong('jours', 'une liste non vide');
  else {
    obj.jours.forEach((j, i) => {
      const p = `jours[${i}]`;
      if (!j || typeof j !== 'object') return wrong(p, 'un objet');
      if (j.jour === undefined) missing(`${p}.jour`);
      else if (!DAYS.includes(j.jour)) wrong(`${p}.jour`, `l'un de : ${DAYS.join(', ')}`);
      for (const m of ['midi', 'soir']) {
        if (j[m] === undefined) missing(`${p}.${m}`);
        else if (j[m] !== null) checkMeal(j[m], `${p}.${m}`);
      }
    });
  }

  if (obj.courses === undefined) missing('courses');
  else if (!Array.isArray(obj.courses)) wrong('courses', 'une liste');
  else {
    obj.courses.forEach((c, i) => {
      const p = `courses[${i}]`;
      if (!c || typeof c !== 'object') return wrong(p, 'un objet');
      for (const f of ['rayon', 'article']) {
        if (c[f] === undefined) missing(`${p}.${f}`);
        else if (!isStr(c[f]) || !c[f].trim()) wrong(`${p}.${f}`, 'un texte non vide');
      }
      if (c.quantite === undefined) missing(`${p}.quantite`);
      else if (!isStr(c.quantite) && !isNum(c.quantite)) wrong(`${p}.quantite`, 'un texte (ex. "500 g")');
      if (c.prix_estime === undefined) missing(`${p}.prix_estime`);
      else if (!isNum(c.prix_estime) || c.prix_estime < 0) wrong(`${p}.prix_estime`, 'un nombre en euros');
      if (c.pour === undefined) missing(`${p}.pour`);
      else if (!Array.isArray(c.pour)) wrong(`${p}.pour`, 'une liste');
      else c.pour.forEach((r, k) => {
        if (!isStr(r) || !POUR_RE.test(r.trim().toLowerCase())) wrong(`${p}.pour[${k}]`, 'de la forme « jour moment » (ex. « lundi soir »)');
      });
    });
  }

  for (const f of ['batch_cooking', 'restes', 'conseils']) {
    if (obj[f] === undefined) continue; // optionnels : liste vide par défaut
    if (!Array.isArray(obj[f]) || obj[f].some((x) => !isStr(x))) wrong(f, 'une liste de textes');
  }

  function checkMeal(m, p) {
    if (typeof m !== 'object' || Array.isArray(m)) return wrong(p, 'un objet ou null');
    if (m.nom === undefined) missing(`${p}.nom`);
    else if (!isStr(m.nom) || !m.nom.trim()) wrong(`${p}.nom`, 'un texte non vide');
    if (m.temps === undefined) missing(`${p}.temps`);
    else if (!isNum(m.temps) || m.temps < 0) wrong(`${p}.temps`, 'un nombre de minutes');
    if (m.tags !== undefined && (!Array.isArray(m.tags) || m.tags.some((t) => !isStr(t)))) wrong(`${p}.tags`, 'une liste de textes');
    if (m.recette === undefined) missing(`${p}.recette`);
    else if (!isStr(m.recette)) wrong(`${p}.recette`, 'un texte');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, menu: normalize(obj) };
}

function normalize(obj) {
  const meal = (m) => (m ? { nom: m.nom.trim(), temps: m.temps, tags: m.tags || [], recette: m.recette } : null);
  return {
    semaine: obj.semaine,
    personnes: obj.personnes,
    budget_estime: obj.budget_estime,
    jours: [...obj.jours]
      .sort((a, b) => DAYS.indexOf(a.jour) - DAYS.indexOf(b.jour))
      .map((j) => ({ jour: j.jour, midi: meal(j.midi), soir: meal(j.soir) })),
    courses: obj.courses.map((c) => ({
      rayon: c.rayon.trim(),
      article: c.article.trim(),
      quantite: String(c.quantite),
      prix_estime: c.prix_estime,
      pour: c.pour.map((r) => r.trim().toLowerCase()),
    })),
    batch_cooking: obj.batch_cooking || [],
    restes: obj.restes || [],
    conseils: obj.conseils || [],
  };
}

/** Assemble le prompt à coller dans Claude. `ecartLine` est optionnelle. */
export function buildPrompt(form, budget, ecartLine, extraLines = []) {
  const lundi = nextMonday(todayISO());
  const dateLundi = fmtDate(lundi, { day: 'numeric', month: 'long', year: 'numeric' });
  const repas = (MEAL_OPTIONS.find((o) => o.id === form.repas) || MEAL_OPTIONS[0]).phrase;
  const or = (v, fallback) => (String(v || '').trim() ? String(v).trim() : fallback);
  const lines = [
    `Tu es mon assistant cuisine. Génère les menus de la semaine du ${dateLundi} pour ${form.personnes} personnes, avec un budget courses maximum de ${budget} € (ce chiffre vient de mon budget hebdomadaire, ne le dépasse pas).`,
    '',
    `Repas à prévoir : ${repas}.`,
    `Contraintes et régime : ${or(form.regime, 'aucune')}.`,
    `Allergies et aversions : ${or(form.allergies, 'aucune')}.`,
    `Temps de préparation maximum en semaine : ${form.tempsMax} minutes ; le week-end peut être plus long.`,
    `J'ai déjà dans mes placards : ${or(form.placards, 'rien de particulier')} — n'ajoute pas ces articles à la liste de courses.`,
  ];
  if (ecartLine) lines.push(ecartLine);
  for (const l of extraLines) if (l) lines.push(l);
  lines.push(
    '',
    'Consignes :',
    '- Privilégie les produits de saison en France et les prix réalistes des supermarchés français.',
    "- Réutilise les restes d'un repas à l'autre et propose du batch cooking quand c'est pertinent.",
    '- Varie les protéines et les féculents sur la semaine.',
    '- La somme des prix_estime de la liste de courses ne doit pas dépasser le budget.',
    '- Chaque article de la liste de courses indique dans "pour" les repas qui l\'utilisent.',
    '- Les recettes sont courtes : 3 à 6 étapes, sans blabla.',
    '',
    'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ni après, sans balises markdown, en respectant exactement ce schéma :',
    '',
    SCHEMA_TEXT,
  );
  return lines.join('\n');
}

/** Phrase d'écart pour la dernière semaine validée, ou null. */
export function ecartLineFor(week) {
  const v = week?.validation;
  if (!v || !v.estime || v.ecart == null || Math.round(Math.abs(v.ecart) * 100) === 0) return null;
  const x = Math.round(Math.abs(v.ecart) * 100);
  const sens = v.ecart > 0 ? 'en dessous' : 'au-dessus';
  return `La semaine dernière, tes estimations étaient ${x} % ${sens} du prix réel payé ; ajuste en conséquence.`;
}

/** Nombre de repas non nuls d'un menu. */
export const mealCount = (menu) => menu.jours.reduce((n, j) => n + (j.midi ? 1 : 0) + (j.soir ? 1 : 0), 0);
export const coursesTotal = (items) => items.reduce((a, c) => a + (Number(c.prix_estime) || 0), 0);
