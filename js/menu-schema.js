// Validation stricte du JSON de menu et assemblage du prompt.
import { DAYS, nextMonday, todayISO, fmtDate, addDays } from './utils.js';

export const SCHEMA_TEXT = `{
  "semaine": "2026-09-07",
  "personnes": 2,
  "budget_estime": 85,
  "jours": [
    {
      "jour": "lundi",
      "midi": { "nom": "Salade de lentilles", "temps": 15, "tags": ["végé", "froid"], "recette": "Étapes courtes…", "lien": "https://www.marmiton.org/recettes/recette_…(page exacte de la recette).aspx" },
      "soir": { "nom": "Poulet au citron, riz", "temps": 35, "tags": [], "recette": "Étapes courtes…", "lien": "https://www.750g.com/…(page exacte de la recette).htm" }
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
export const isUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v.trim());
/** Page de recherche ou de catégorie (pas une recette précise). */
export const isSearchUrl = (v) => typeof v === 'string' && /recherche|\/search|[?&](q|aqt|s|query)=/i.test(v);
export const directLink = (v) => (isUrl(v) && !isSearchUrl(v) ? v.trim() : null);
/** Repas sans lien direct dans un menu importé. */
export const mealsWithoutLink = (menu) => (menu.jours || []).flatMap((d) => [d.midi, d.soir]).filter((m) => m && !m.lien).map((m) => m.nom);
/** Lien de recherche Marmiton pour un plat sans adresse connue. */
export const searchLinkFor = (nom) => `https://www.marmiton.org/recettes/recherche.aspx?aqt=${encodeURIComponent(String(nom || '').trim()).replace(/%20/g, '+')}`;
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
    if (m.lien != null && m.lien !== '' && !isUrl(m.lien)) wrong(`${p}.lien`, 'une adresse https:// ou null');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, menu: normalize(obj) };
}

function normalize(obj) {
  const meal = (m) => (m ? { nom: m.nom.trim(), temps: m.temps, tags: m.tags || [], recette: m.recette, lien: directLink(m.lien) } : null);
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

export const OBJECTIFS = [
  { id: 'equilibre', label: 'Équilibré', phrase: 'des repas équilibrés (légumes à chaque repas, protéines variées, féculents complets quand c\'est possible)' },
  { id: 'economies', label: 'Économies', phrase: 'le coût le plus bas possible : légumineuses, œufs, produits de saison, marques distributeur, gros conditionnements réutilisés sur plusieurs repas' },
  { id: 'rapide', label: 'Rapidité', phrase: 'des repas très rapides en semaine (15 à 20 minutes), avec du batch cooking le week-end' },
  { id: 'antigaspi', label: 'Anti-gaspi', phrase: 'zéro gaspillage : chaque ingrédient acheté est utilisé en entier sur la semaine, les restes sont planifiés' },
  { id: 'decouverte', label: 'Découverte', phrase: 'de la variété : au moins deux plats que je n\'ai probablement jamais cuisinés, d\'inspirations différentes' },
];
export const NIVEAUX = [
  { id: 'debutant', label: 'Débutant', phrase: 'débutant : techniques simples, pas de matériel spécial, étapes très explicites' },
  { id: 'confirme', label: 'À l\'aise', phrase: 'à l\'aise en cuisine : recettes courantes sans détailler les bases' },
  { id: 'expert', label: 'Expérimenté', phrase: 'expérimenté : recettes plus techniques bienvenues le week-end' },
];

const SAISONS = ['hiver', 'hiver', 'printemps', 'printemps', 'printemps', 'été', 'été', 'été', 'automne', 'automne', 'automne', 'hiver'];

/**
 * Assemble le prompt à coller dans Claude. `ecartLine` et `extraLines` sont optionnelles ;
 * opts.liens === false coupe la demande de liens de recettes.
 */
export function buildPrompt(form, budget, ecartLine, extraLines = [], opts = {}) {
  const lundi = nextMonday(todayISO());
  const dateLundi = fmtDate(lundi, { day: 'numeric', month: 'long', year: 'numeric' });
  const option = MEAL_OPTIONS.find((o) => o.id === form.repas) || MEAL_OPTIONS[0];
  const nbJours = option.id.endsWith('-5') ? 5 : 7;
  const moments = option.id.startsWith('midi-soir') ? ['midi', 'soir'] : option.id.startsWith('soir') ? ['soir'] : ['midi'];
  const nbRepas = nbJours * moments.length;
  const or = (v, fallback) => (String(v || '').trim() ? String(v).trim() : fallback);
  const objectif = OBJECTIFS.find((o) => o.id === form.objectif) || OBJECTIFS[0];
  const niveau = NIVEAUX.find((n) => n.id === form.niveau) || NIVEAUX[1];
  const mois = fmtDate(lundi, { month: 'long' });
  const saison = SAISONS[Number(lundi.slice(5, 7)) - 1];
  const parPersonne = budget > 0 && nbRepas ? Math.round((Number(budget) / nbRepas / Math.max(1, form.personnes)) * 100) / 100 : null;
  const jours = DAYS.slice(0, nbJours).map((j, i) => `${j} ${addDays(lundi, i)}`).join(', ');
  const lines = [
    `Tu es un cuisinier français pragmatique qui planifie les repas d'un foyer. Tu connais les prix réels des supermarchés français en ${mois} 2026 et les produits de saison (${saison}).`,
    '',
    '## Le foyer',
    `- ${form.personnes} personne${form.personnes > 1 ? 's' : ''}, niveau en cuisine ${niveau.phrase}.`,
    `- Priorité de la semaine : ${objectif.phrase}.`,
    `- Contraintes et régime : ${or(form.regime, 'aucune')}.`,
    `- Allergies et aversions : ${or(form.allergies, 'aucune')} (jamais dans les recettes, même en trace).`,
    `- Équipement : ${or(form.equipement, 'cuisine classique (plaques, four, poêles, casseroles)')}.`,
    '',
    '## La semaine',
    `- Semaine du ${dateLundi} : ${jours}.`,
    `- Repas à prévoir : ${option.phrase}, soit ${nbRepas} repas. Les moments non demandés restent à null.`,
    `- Temps de préparation maximum en semaine : ${form.tempsMax} minutes (le week-end peut aller jusqu'au double).`,
    `- Budget courses maximum : ${budget} €${parPersonne ? `, soit environ ${String(parPersonne).replace('.', ',')} € par repas et par personne` : ''}. C'est mon budget réel : ne le dépasse pas, et vise 10 % en dessous pour garder une marge.`,
    `- Déjà à la maison (ne pas racheter, à utiliser en priorité) : ${or(form.placards, 'rien de particulier')}.`,
  ];
  if (ecartLine) lines.push(`- ${ecartLine}`);
  for (const l of extraLines) if (l) lines.push(`- ${l}`);
  lines.push(
    '',
    '## Règles',
    '1. Un fil conducteur : les gros ingrédients (un poulet, un chou, un kilo de riz…) servent à 2 ou 3 repas différents dans la semaine, avec les restes planifiés dans "restes".',
    '2. Variété : jamais deux fois la même protéine deux jours de suite, féculents alternés, au moins 2 repas végétariens sur la semaine, pas plus d\'un plat de pâtes.',
    '3. Chaque repas : légumes présents, portions réalistes pour le nombre de personnes, temps annoncé sincère.',
    '4. Liste de courses : uniquement ce qui manque, regroupée par rayon d\'un supermarché (Fruits & légumes, Boucherie-poissonnerie, Crèmerie, Épicerie salée, Épicerie sucrée, Surgelés, Boulangerie, Boissons), quantités concrètes ("500 g", "2", "1 boîte de 400 g"), prix_estime réaliste par article, et "pour" qui liste chaque repas qui l\'utilise.',
    '5. La somme des prix_estime doit rester sous le budget ; si c\'est impossible, simplifie les recettes plutôt que de tricher sur les prix.',
    '6. Recettes courtes : 3 à 6 étapes numérotées, verbes à l\'impératif, sans blabla, avec les temps de cuisson.',
    '7. "batch_cooking" : 2 à 4 préparations à faire le week-end qui font gagner du temps en semaine. "conseils" : 1 à 3 astuces concrètes (conservation, promo probable, substitution).',
    '8. Les tags sont courts et utiles : végé, rapide, froid, à emporter, batch, restes, enfant.',
    opts.liens === false ? '9. Laisse "lien" à null.' : '9. "lien" est obligatoire pour chaque repas, et ce doit être la page d\'une recette précise, jamais une page de recherche ni une page de catégorie. Cherche réellement chaque recette sur le web (Marmiton, 750g, Cuisine AZ, Journal des Femmes, Cuisine Actuelle, Ptitchef, Elle à table…) avec ton outil de recherche si tu en as un, ouvre la page pour vérifier qu\'elle existe et qu\'elle correspond au plat, puis recopie son adresse exacte. Adapte le nom du plat au titre de la recette trouvée si besoin. Interdit : inventer une adresse, donner un lien de recherche (recherche.aspx, /search, ?q=…), ou laisser null.',
    '',
    '## Avant de répondre, vérifie',
    `- ${nbJours} jours exactement, avec les bons noms de jours en minuscules ; ${moments.join(' et ')} rempli${moments.length > 1 ? 's' : ''} pour chaque jour, l'autre moment à null si non demandé.`,
    '- Aucun allergène listé, aucun article déjà à la maison dans la liste, total sous le budget.',
    opts.liens === false ? null : '- Chaque "lien" ouvre la page d\'une recette précise que tu as vérifiée (pas une recherche, pas une adresse devinée).',
    '- JSON strictement valide : guillemets doubles, pas de virgule finale, pas de commentaire.',
    '',
    'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ni après, sans balises markdown, en respectant exactement ce schéma :',
    '',
    SCHEMA_TEXT,
  );
  return lines.filter((l) => l != null).join('\n');
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

/* ---------- Une seule recette (« Que cuisiner ce soir ? ») ---------- */
export const RECIPE_SCHEMA_TEXT = `{
  "nom": "Poêlée de légumes au poulet",
  "temps": 25,
  "tags": ["anti-gaspi", "rapide"],
  "personnes": 2,
  "ingredients": [
    { "article": "Poulet", "quantite": "300 g", "en_stock": true },
    { "article": "Courgettes", "quantite": "2", "en_stock": true },
    { "article": "Crème fraîche", "quantite": "10 cl", "en_stock": false }
  ],
  "recette": "1. Couper les légumes.\n2. Saisir le poulet.\n3. Ajouter les légumes, cuire 10 min.",
  "lien": "https://…(page exacte de la recette, obligatoire)"
}`;

/** Valide une recette seule. Retourne { ok, recipe } ou { ok: false, errors }. */
export function validateRecipe(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['le JSON doit être un objet { … }'] };
  if (!isStr(obj.nom) || !obj.nom.trim()) errors.push('champ nom manquant ou vide');
  if (obj.temps !== undefined && !isNum(obj.temps)) errors.push('champ temps doit être un nombre de minutes');
  if (!isStr(obj.recette) || !obj.recette.trim()) errors.push('champ recette manquant');
  if (obj.ingredients !== undefined && !Array.isArray(obj.ingredients)) errors.push('champ ingredients doit être une liste');
  if (obj.tags !== undefined && (!Array.isArray(obj.tags) || obj.tags.some((t) => !isStr(t)))) errors.push('champ tags doit être une liste de textes');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    recipe: {
      nom: obj.nom.trim(), temps: isNum(obj.temps) ? obj.temps : 30, tags: obj.tags || [], recette: obj.recette, personnes: Number.isInteger(obj.personnes) && obj.personnes > 0 ? obj.personnes : 2, lien: directLink(obj.lien),
      ingredients: (obj.ingredients || []).filter((i) => i && isStr(i.article) && i.article.trim()).map((i) => ({ article: i.article.trim(), quantite: i.quantite == null ? '' : String(i.quantite), rayon: isStr(i.rayon) ? i.rayon : 'Autre', prix_estime: isNum(i.prix_estime) ? i.prix_estime : 0, enStock: !!i.en_stock })),
    },
  };
}

/**
 * Prompt « Que cuisiner ce soir ? » : une recette avec ce qu'il y a, en priorité ce qui périme.
 * `stock` = { placards, urgentLine, ddmLine } (voir stockPromptLines) ; `restes` = restes du menu en cours.
 */
export function buildTonightPrompt({ personnes, tempsMax, regime, allergies }, stock, restes = [], quand = 'ce soir') {
  const or = (v, fallback) => (String(v || '').trim() ? String(v).trim() : fallback);
  const lines = [
    `Tu es mon assistant cuisine. Propose UNE recette pour ${quand}, pour ${personnes} personne${personnes > 1 ? 's' : ''}, prête en ${tempsMax} minutes maximum, en utilisant en priorité ce que j'ai déjà.`,
    '',
    `Ce que j'ai en stock : ${or(stock.placards, 'rien de particulier')}.`,
  ];
  if (stock.urgentLine) lines.push(stock.urgentLine);
  if (stock.ddmLine) lines.push(stock.ddmLine);
  if (restes.length) lines.push(`Restes disponibles : ${restes.join(' ; ')}.`);
  lines.push(
    `Contraintes et régime : ${or(regime, 'aucune')}.`,
    `Allergies et aversions : ${or(allergies, 'aucune')}.`,
    '',
    'Consignes :',
    '- Utilise d\'abord les produits proches de leur date limite, puis le reste du stock ; limite les achats à 3 articles maximum, marqués "en_stock": false.',
    '- Recette courte : 3 à 6 étapes, sans blabla.',
    '- "lien" obligatoire : la page d\'une recette précise trouvée sur le web (Marmiton, 750g, Cuisine AZ, Journal des Femmes…), vérifiée avec ton outil de recherche. Jamais une page de recherche, jamais une adresse inventée, jamais null.',
    '',
    'Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown, selon ce schéma :',
    '',
    RECIPE_SCHEMA_TEXT,
  );
  return lines.join('\n');
}
