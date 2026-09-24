// Stock alimentaire : modèle, dates limites, suggestions, journal anti-gaspi.
// Les fonctions `add…/adjust…/remove…` sont des mutateurs à appeler dans update(s => …).
import { uid, todayISO, addDays, daysBetween, fmtDate, round2 } from './utils.js';

export const EMPLACEMENTS = [
  { id: 'frigo', nom: 'Frigo', dlcJours: 7 },
  { id: 'congelateur', nom: 'Congélateur', dlcJours: 90 },
  { id: 'placard', nom: 'Placard', dlcJours: null },
  { id: 'autre', nom: 'Autre', dlcJours: null },
];
export const emplacementById = (id) => EMPLACEMENTS.find((e) => e.id === id) || EMPLACEMENTS[3];

export const CATEGORIES = ['Fruits & légumes', 'Produits laitiers', 'Viande & poisson', 'Épicerie salée', 'Épicerie sucrée', 'Boissons', 'Surgelés', 'Pain & pâtisserie', 'Bébé', 'Hygiène & entretien', 'Autre'];

export const UNITES = [
  { id: 'piece', label: 'pièce(s)', short: '', step: 1 },
  { id: 'g', label: 'g', short: 'g', step: 100 },
  { id: 'kg', label: 'kg', short: 'kg', step: 0.5 },
  { id: 'ml', label: 'ml', short: 'ml', step: 100 },
  { id: 'l', label: 'L', short: 'L', step: 0.5 },
];
export const uniteById = (id) => UNITES.find((u) => u.id === id) || UNITES[0];

export const normalizeText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- Suggestions de catégorie et d'emplacement ---------- */
const CAT_RULES = [
  ['Surgelés', /surgel|frozen|\bglace|ice-cream|sorbet/],
  ['Bébé', /\bbebe|\bbaby|infant/],
  ['Hygiène & entretien', /hygien|lessive|detergent|savon|\bsoap|shampo|dentifrice|toothpaste|papier|toilet|nettoy|\bclean|deodorant|cosmet|rasoir/],
  ['Boissons', /boisson|beverage|\bdrink|\beau\b|\bwater|\bjus\b|\bjuice|\bsoda|\bbiere|\bbeer|\bvin\b|\bwine|\bcafe|coffee|\bthe\b|\btea|\bsirop|\bsyrup|\blait vegetal/],
  ['Produits laitiers', /\blait\b|laitier|laitage|dairy|dairies|fromage|cheese|yaourt|yogurt|yogourt|beurre|butter|\bcreme|\bcream|\boeuf|\begg/],
  ['Viande & poisson', /viande|\bmeat|boeuf|\bbeef|\bporc|\bpork|poulet|chicken|volaille|poultry|jambon|\bham\b|charcut|saucis|poisson|\bfish|seafood|saumon|salmon|\bthon|\btuna|crevette|shrimp|\bsteak|\bhach/],
  ['Fruits & légumes', /\bfruit|legume|vegetable|salade|tomate|tomato|pomme|apple|banane|banana|carotte|carrot|oignon|onion|\bail\b|herbe|champignon|mushroom|citron|lemon|avocat|courgette|poivron|pomme de terre|potato/],
  ['Pain & pâtisserie', /\bpain\b|\bbread|brioche|viennoiserie|patisserie|pastry|biscotte|gateau|\bcake|croissant|\bwrap|tortilla/],
  ['Épicerie sucrée', /sucre|sugar|chocolat|chocolate|confiture|\bjam\b|\bmiel|honey|biscuit|cookie|cereal|bonbon|candy|dessert|compote|pate a tartiner|spread|barre/],
  ['Épicerie salée', /\bpate|pasta|\briz\b|\brice|farine|flour|conserve|canned|huile|\boil\b|sauce|epice|spice|soupe|\bsoup|legumineuse|lentille|lentil|haricot|\bbean|chips|snack|\bsel\b|\bsalt|vinaigre|vinegar|moutarde|mustard|bouillon|semoule|couscous|quinoa|noix|nut/],
];

/** Devine la catégorie Tartinou à partir de textes (catégories Open Food Facts, rayon, nom). */
export function guessCategorie(...texts) {
  const t = normalizeText(texts.filter(Boolean).join(' '));
  if (!t.trim()) return 'Autre';
  for (const [cat, re] of CAT_RULES) if (re.test(t)) return cat;
  return 'Autre';
}

export function guessEmplacement(categorie, ...texts) {
  const t = normalizeText(texts.filter(Boolean).join(' '));
  if (categorie === 'Surgelés' || /surgel|congel|frozen/.test(t)) return 'congelateur';
  if (['Fruits & légumes', 'Produits laitiers', 'Viande & poisson'].includes(categorie) || /frais|fresh|refriger|\bfrigo/.test(t)) return 'frigo';
  if (categorie === 'Hygiène & entretien') return 'autre';
  return 'placard';
}

export function defaultDlc(emplacement, today = todayISO()) {
  const days = emplacementById(emplacement).dlcJours;
  return days ? addDays(today, days) : null;
}

/* ---------- Dates limites : DLC (sanitaire) ou DDM (qualité) ---------- */
export const DATE_TYPES = [
  { id: 'dlc', label: 'DLC', long: 'Date limite de consommation', hint: 'DLC « à consommer jusqu’au » : à ne plus manger après, surtout le frais.' },
  { id: 'ddm', label: 'DDM', long: 'Date de durabilité minimale', hint: 'DDM « à consommer de préférence avant » : souvent encore bon après, on vérifie l’aspect et l’odeur.' },
];
/** Type de date proposé : DLC pour le frigo et le frais, DDM pour le reste (placard, surgelés). */
export function defaultDdm(categorie, emplacement) {
  if (emplacement === 'frigo') return false;
  if (['Viande & poisson', 'Produits laitiers', 'Fruits & légumes', 'Pain & pâtisserie'].includes(categorie)) return false;
  return true;
}

/** { status: 'none' | 'perime' | 'ddm' | 'urgent' | 'ok', jours }. 'ddm' = DDM dépassée (à vérifier, pas jeté d'office). */
export function dlcInfo(item, alertDays = 3, today = todayISO()) {
  if (!item.dlc) return { status: 'none', jours: null };
  const jours = daysBetween(today, item.dlc);
  if (jours < 0) return { status: item.ddm ? 'ddm' : 'perime', jours };
  if (jours <= alertDays) return { status: 'urgent', jours };
  return { status: 'ok', jours };
}

export function dlcLabel(item, info) {
  const { status, jours } = info;
  if (status === 'none') return 'Sans date';
  const since = jours === -1 ? 'hier' : `depuis ${-jours} j`;
  if (status === 'ddm') return jours === -1 ? 'DDM dépassée hier' : `DDM dépassée (${-jours} j)`;
  if (status === 'perime') return `Périmé ${since}`;
  const type = item.ddm ? 'DDM' : 'DLC';
  if (jours === 0) return `${type} aujourd'hui`;
  if (jours === 1) return `${type} demain`;
  if (jours <= 14) return `${type} dans ${jours} j`;
  return `${type} le ${fmtDate(item.dlc, { day: 'numeric', month: 'short' })}`;
}

/* ---------- Quantités ---------- */
export function fmtQte(item) {
  const u = uniteById(item.unite);
  const n = round2(item.qte);
  const nb = String(n).replace('.', ',');
  if (u.id === 'piece') return item.conditionnement ? `${nb} × ${item.conditionnement}` : nb;
  return `${nb} ${u.short}`;
}

/** Valeur estimée d'une quantité : prix par pièce, par kg ou par L. */
export function valueOf(prix, qte, unite) {
  if (prix == null || !(prix >= 0)) return null;
  if (unite === 'g' || unite === 'ml') return round2((prix * qte) / 1000);
  return round2(prix * qte);
}
export const prixLabel = (unite) => (unite === 'g' || unite === 'kg' ? 'Prix (€ / kg)' : unite === 'ml' || unite === 'l' ? 'Prix (€ / L)' : 'Prix (€ / pièce)');
/** Valeur du stock : { total, avecPrix, sansPrix }. */
export function stockValue(items) {
  let total = 0, avecPrix = 0, sansPrix = 0;
  for (const it of items) {
    const v = valueOf(it.prix, it.qte, it.unite);
    if (v == null) sansPrix++;
    else { total += v; avecPrix++; }
  }
  return { total: round2(total), avecPrix, sansPrix };
}

/* ---------- Rapprochement par nom ---------- */
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'au', 'aux', 'en', 'un', 'une', 'pour', 'avec', 'sans', 'bio', 'the', 'and', 'kg', 'cl', 'ml', 'pcs', 'piece', 'paquet', 'sachet', 'bouteille', 'boite', 'lot', 'gros', 'petit', 'frais', 'entier']);
export function tokens(str) {
  return normalizeText(str).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}
/** { exact: true } si les mots significatifs sont les mêmes, { exact: false } si l'un contient l'autre, null sinon. */
export function nameMatch(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return null;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!short.every((w) => long.includes(w))) return null;
  return { exact: ta.length === tb.length };
}
export const findInStock = (items, name) => items.map((it) => ({ item: it, match: nameMatch(it.nom, name) })).filter((x) => x.match);

/* ---------- Résumé et tri ---------- */
export function stockSummary(state, today = todayISO()) {
  const alertDays = state.settings.stock.alertDays;
  let perimes = 0, urgents = 0, ddm = 0;
  for (const it of state.stock.items) {
    const { status } = dlcInfo(it, alertDays, today);
    if (status === 'perime') perimes++;
    else if (status === 'urgent') urgents++;
    else if (status === 'ddm') ddm++;
  }
  return { total: state.stock.items.length, perimes, urgents, ddm };
}

export function sortItems(items, mode = 'dlc') {
  const byName = (a, b) => a.nom.localeCompare(b.nom, 'fr');
  const list = [...items];
  if (mode === 'nom') return list.sort(byName);
  if (mode === 'recent') return list.sort((a, b) => (b.ajouteLe || '').localeCompare(a.ajouteLe || '') || byName(a, b));
  return list.sort((a, b) => {
    if (a.dlc && b.dlc) return a.dlc.localeCompare(b.dlc) || byName(a, b);
    if (a.dlc) return -1;
    if (b.dlc) return 1;
    return byName(a, b);
  });
}

/* ---------- Mutateurs ---------- */
let actor = null;
/** Prénom de la personne connectée, inscrit dans le journal. */
export const setActor = (nom) => { actor = nom || null; };
function journal(s, type, item, qte) {
  s.stock.journal.push({ id: uid(), date: todayISO(), at: Date.now(), type, nom: item.nom, qte: round2(qte), unite: item.unite, prix: item.prix ?? null, code: item.code || null, categorie: item.categorie || null, auteur: actor });
  if (s.stock.journal.length > 1000) s.stock.journal.splice(0, s.stock.journal.length - 1000);
}

const sameProduct = (a, b) => (a.code && b.code ? a.code === b.code : !a.code && !b.code && normalizeText(a.nom) === normalizeText(b.nom));

/** Ajoute un article ; fusionne avec une ligne identique (même produit, emplacement, date, unité). Retourne la ligne. */
export function addStockItem(s, data) {
  const qte = Number(data.qte) > 0 ? round2(Number(data.qte)) : 1;
  const item = {
    id: uid(), code: data.code || null, nom: String(data.nom || '').trim() || 'Produit sans nom', marque: String(data.marque || '').trim(), conditionnement: String(data.conditionnement || '').trim(),
    qte, unite: uniteById(data.unite).id, emplacement: emplacementById(data.emplacement).id, categorie: CATEGORIES.includes(data.categorie) ? data.categorie : 'Autre',
    dlc: data.dlc || null, ddm: !!data.ddm, ouvertLe: data.ouvertLe || null, ajouteLe: todayISO(),
    prix: data.prix === '' || data.prix == null || Number.isNaN(Number(data.prix)) ? null : round2(Number(data.prix)),
    seuilMin: Number(data.seuilMin) > 0 ? round2(Number(data.seuilMin)) : 0, image: data.image || null, notes: String(data.notes || '').trim(),
    magasin: String(data.magasin || '').trim() || null, portions: Number(data.portions) > 0 ? round2(Number(data.portions)) : null,
  };
  if (item.prix != null) recordPrice(s, { code: item.code, nom: item.nom, magasin: item.magasin, prix: item.prix, unite: item.unite });
  const twin = s.stock.items.find((x) => sameProduct(x, item) && x.emplacement === item.emplacement && (x.dlc || null) === (item.dlc || null) && x.unite === item.unite);
  if (twin) {
    twin.qte = round2(twin.qte + item.qte);
    if (item.prix != null) twin.prix = item.prix;
    if (item.magasin) twin.magasin = item.magasin;
    if (!twin.image && item.image) twin.image = item.image;
    if (item.seuilMin) twin.seuilMin = item.seuilMin;
    journal(s, 'ajout', twin, item.qte);
    removeFromARacheter(s, twin);
    return twin;
  }
  s.stock.items.push(item);
  journal(s, 'ajout', item, item.qte);
  removeFromARacheter(s, item);
  return item;
}
/** Mémorise un prix observé (appelé à l'ajout quand un prix est saisi). */
export function recordPrice(s, { code, nom, magasin, prix, unite }) {
  if (!(prix >= 0) || !nom) return;
  s.stock.prixHistorique.push({ id: uid(), code: code || null, nom: String(nom).trim(), magasin: String(magasin || '').trim() || null, prix: round2(prix), unite: unite || 'piece', date: todayISO() });
  if (s.stock.prixHistorique.length > 2000) s.stock.prixHistorique.splice(0, s.stock.prixHistorique.length - 2000);
}
/** Ce qu'on sait du prix d'un produit : dernier prix, écart avec le précédent, meilleur magasin. */
export function priceInsight(state, { code, nom }) {
  const hist = state.stock.prixHistorique.filter((p) => (code && p.code === code) || (!code && nom && normalizeText(p.nom) === normalizeText(nom)) || (code && !p.code && nom && normalizeText(p.nom) === normalizeText(nom)));
  if (!hist.length) return null;
  const sorted = [...hist].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const delta = prev && prev.prix > 0 ? (last.prix - prev.prix) / prev.prix : null;
  const byStore = new Map();
  for (const p of sorted) if (p.magasin) byStore.set(p.magasin, p);
  const stores = [...byStore.values()].sort((a, b) => a.prix - b.prix);
  return { last, prev, delta, stores, count: sorted.length };
}
export const knownStores = (state) => [...new Set([...state.stock.prixHistorique.map((p) => p.magasin), ...state.stock.items.map((i) => i.magasin)].filter(Boolean))].sort();

/** Allergènes du produit qui croisent ceux du foyer. */
export function allergenConflicts(state, product) {
  if (!product || !Array.isArray(product.allergenes)) return [];
  const mine = new Set((state.settings.allergenes || []).map(normalizeText));
  return product.allergenes.filter((a) => mine.has(normalizeText(a)));
}

/** Ajuste la quantité de `delta` ; à zéro la ligne disparaît. `type` : 'ajout' | 'conso' | 'jete' | 'ajuste'. */
export function adjustStockQty(s, id, delta, type = 'ajuste') {
  const item = s.stock.items.find((x) => x.id === id);
  if (!item) return null;
  const next = round2(item.qte + delta);
  if (next <= 0) return removeStockItem(s, id, type === 'ajuste' ? 'conso' : type);
  item.qte = next;
  if (type !== 'ajuste') journal(s, type, item, Math.abs(delta));
  checkReorder(s, item, next);
  return item;
}

/** Retire la ligne entière. `type` : 'conso' | 'jete' | 'retrait'. `prix` : prix unitaire connu au moment du retrait. */
export function removeStockItem(s, id, type = 'retrait', { aRacheter = false, prix } = {}) {
  const item = s.stock.items.find((x) => x.id === id);
  if (!item) return null;
  if (prix !== undefined) item.prix = prix;
  journal(s, type, item, item.qte);
  s.stock.items = s.stock.items.filter((x) => x.id !== id);
  if (aRacheter) addARacheter(s, { nom: item.nom, code: item.code, qte: item.seuilMin || 1, unite: item.unite });
  else checkReorder(s, item, 0);
  return item;
}

function checkReorder(s, item, remaining) {
  if (!(item.seuilMin > 0)) return;
  const total = s.stock.items.filter((x) => sameProduct(x, item)).reduce((a, x) => a + x.qte, 0);
  if (Math.max(total, remaining) < item.seuilMin) addARacheter(s, { nom: item.nom, code: item.code, qte: round2(item.seuilMin - total) || 1, unite: item.unite, auto: true });
}

export function addARacheter(s, { nom, code = null, qte = 1, unite = 'piece', auto = false }) {
  const probe = { nom, code };
  if (s.stock.aRacheter.some((r) => sameProduct(r, probe))) return null;
  const entry = { id: uid(), nom: String(nom || '').trim() || 'Produit', code: code || null, qte: Number(qte) > 0 ? round2(Number(qte)) : 1, unite: uniteById(unite).id, auto: !!auto, ajouteLe: todayISO() };
  s.stock.aRacheter.push(entry);
  return entry;
}
export function removeFromARacheter(s, item) {
  s.stock.aRacheter = s.stock.aRacheter.filter((r) => !sameProduct(r, item));
}

/* ---------- Pour le prompt des menus ---------- */
export function stockPromptLines(state, today = todayISO()) {
  const alertDays = state.settings.stock.alertDays;
  const items = sortItems(state.stock.items, 'nom');
  const placards = items.map((it) => (it.qte > 1 || it.unite !== 'piece' ? `${it.nom} (${fmtQte(it)})` : it.nom)).join(', ');
  const infos = items.map((it) => ({ it, info: dlcInfo(it, Math.max(alertDays, 5), today) }));
  const urgent = infos
    .filter(({ info }) => info.status === 'urgent')
    .sort((a, b) => a.it.dlc.localeCompare(b.it.dlc))
    .map(({ it }) => `${it.nom} (${it.ddm ? 'DDM' : 'DLC'} le ${fmtDate(it.dlc, { day: 'numeric', month: 'long' })})`);
  const ddm = infos.filter(({ info }) => info.status === 'ddm').map(({ it }) => it.nom);
  return {
    placards,
    urgentLine: urgent.length ? `Produits à utiliser en priorité car proches de leur date limite : ${urgent.join(', ')}.` : null,
    ddmLine: ddm.length ? `Produits dont la DDM est dépassée, encore utilisables après vérification : ${ddm.join(', ')}.` : null,
  };
}

/* ---------- Statistiques anti-gaspi détaillées ---------- */
/** Six derniers mois : par mois, par catégorie, produits les plus jetés, taux consommé avant date. */
export function wasteStats(state, months = 6, today = todayISO()) {
  const d = fromISOLocal(today);
  const perMonth = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
    const from = isoOf(start), to = isoOf(end);
    const st = journalStats(state, from, to);
    perMonth.push({ from, label: start.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), ...st });
  }
  const from = perMonth[0].from;
  const byCat = new Map();
  const byProduct = new Map();
  let conso = 0, jete = 0;
  for (const j of state.stock.journal) {
    if (j.date < from) continue;
    if (j.type === 'jete') {
      jete++;
      const v = valueOf(j.prix, j.qte, j.unite) || 0;
      const c = j.categorie || 'Autre';
      byCat.set(c, { n: (byCat.get(c)?.n || 0) + 1, valeur: round2((byCat.get(c)?.valeur || 0) + v) });
      const k = normalizeText(j.nom);
      byProduct.set(k, { nom: j.nom, n: (byProduct.get(k)?.n || 0) + 1, valeur: round2((byProduct.get(k)?.valeur || 0) + v) });
    } else if (j.type === 'conso') conso++;
  }
  return {
    perMonth,
    byCategory: [...byCat.entries()].map(([categorie, v]) => ({ categorie, ...v })).sort((a, b) => b.n - a.n),
    topProducts: [...byProduct.values()].sort((a, b) => b.n - a.n || b.valeur - a.valeur).slice(0, 5),
    tauxAvantDate: conso + jete ? Math.round((conso / (conso + jete)) * 100) : null,
    conso, jete,
  };
}
const fromISOLocal = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const isoOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/* ---------- Statistiques anti-gaspi ---------- */
export function journalStats(state, from, to) {
  const out = { conso: 0, jete: 0, jeteValeur: 0, jeteSansPrix: 0, ajout: 0 };
  for (const j of state.stock.journal) {
    if (j.date < from || j.date >= to) continue;
    if (j.type === 'conso') out.conso++;
    else if (j.type === 'jete') { out.jete++; const v = valueOf(j.prix, j.qte, j.unite); if (v == null) out.jeteSansPrix++; else out.jeteValeur += v; }
    else if (j.type === 'ajout') out.ajout++;
  }
  out.jeteValeur = round2(out.jeteValeur);
  return out;
}
