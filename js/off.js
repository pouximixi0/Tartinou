// Client des bases « Open Facts » : Open Food Facts (alimentation), Open Products Facts
// (produits ménagers et divers), Open Beauty Facts (hygiène, cosmétiques), Open Pet Food
// Facts (animaux). Même API pour les quatre. Un code-barres → nom, marque, image, scores.
// Les produits sont mémorisés dans state.stock.products (donc en base) pour
// fonctionner hors ligne et éviter de rappeler l'API.
import { getState, update } from './store.js';
import { guessCategorie, guessEmplacement } from './stock.js';

/** Bases interrogées, par ordre de priorité quand un même code existe dans plusieurs. */
export const BASES = [
  { id: 'off', host: 'world.openfoodfacts.org', label: 'Open Food Facts', categorie: null },
  { id: 'opf', host: 'world.openproductsfacts.org', label: 'Open Products Facts', categorie: 'Hygiène & entretien' },
  { id: 'obf', host: 'world.openbeautyfacts.org', label: 'Open Beauty Facts', categorie: 'Hygiène & entretien' },
  { id: 'opff', host: 'world.openpetfoodfacts.org', label: 'Open Pet Food Facts', categorie: 'Autre' },
];
export const baseLabel = (id) => (BASES.find((b) => b.id === id) || BASES[0]).label;
const FIELDS = ['code', 'product_name', 'product_name_fr', 'generic_name_fr', 'brands', 'quantity', 'categories', 'categories_tags', 'image_front_small_url', 'image_front_url',
  'nutriscore_grade', 'nova_group', 'ecoscore_grade', 'environmental_score_grade', 'allergens_tags', 'labels_tags', 'ingredients_text_fr', 'ingredients_text', 'nutriments'].join(',');
const CACHE_DAYS = 45;

const ALLERGENES = {
  milk: 'lait', gluten: 'gluten', eggs: 'œufs', nuts: 'fruits à coque', peanuts: 'arachides', soybeans: 'soja', fish: 'poisson', crustaceans: 'crustacés',
  molluscs: 'mollusques', celery: 'céleri', mustard: 'moutarde', 'sesame-seeds': 'sésame', 'sulphur-dioxide-and-sulphites': 'sulfites', lupin: 'lupin',
};
const tagName = (t) => String(t).replace(/^[a-z]{2}:/, '');
const grade = (g) => (typeof g === 'string' && /^[a-e]$/.test(g) ? g : null);

export function normalizeOff(code, p, base = BASES[0]) {
  const nom = (p.product_name_fr || p.product_name || p.generic_name_fr || '').trim();
  const catsText = [p.categories, ...(p.categories_tags || [])].filter(Boolean).join(' ');
  const guessed = guessCategorie(catsText, nom);
  const categorie = base.categorie && guessed === 'Autre' ? base.categorie : guessed;
  const n = p.nutriments || {};
  const pick = (k) => (Number.isFinite(Number(n[k])) ? Math.round(Number(n[k]) * 10) / 10 : null);
  const nutriments = {
    kcal: pick('energy-kcal_100g'), lipides: pick('fat_100g'), satures: pick('saturated-fat_100g'), glucides: pick('carbohydrates_100g'),
    sucres: pick('sugars_100g'), fibres: pick('fiber_100g'), proteines: pick('proteins_100g'), sel: pick('salt_100g'),
  };
  return {
    code, nom, marque: (p.brands || '').split(',')[0].trim(), conditionnement: (p.quantity || '').trim(), categorie,
    emplacement: guessEmplacement(categorie, catsText),
    image: p.image_front_small_url || p.image_front_url || null,
    nutriscore: grade(p.nutriscore_grade), nova: [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null,
    ecoscore: grade(p.ecoscore_grade) || grade(p.environmental_score_grade),
    allergenes: [...new Set((p.allergens_tags || []).map((t) => ALLERGENES[tagName(t)] || tagName(t).replace(/-/g, ' ')))],
    labels: (p.labels_tags || []).map(tagName).filter((l) => /bio|organic|label-rouge|aoc|aop|igp|vegan|vegetarian|fair-trade|equitable|france/.test(l)).slice(0, 5).map((l) => l.replace(/-/g, ' ')),
    ingredients: String(p.ingredients_text_fr || p.ingredients_text || '').slice(0, 600),
    nutriments: Object.values(nutriments).some((v) => v != null) ? nutriments : null,
    source: 'off', base: base.id, fetchedAt: Date.now(),
  };
}

/** Interroge Open Food Facts. Résout null si le produit est inconnu ; lève en cas d'erreur réseau. */
let searchCtrl = null;
const searchCache = new Map(); // requête → produits (Open Food Facts limite la recherche à 10 appels par minute)
/**
 * Recherche par nom (saisie à la main) dans les quatre bases : jusqu'à 12 produits
 * { code, nom, marque, quantite, image, nutriscore, base }. `onUpdate(produits, basesEnAttente)`
 * est appelé à chaque base qui répond, pour afficher sans attendre la plus lente.
 * Retourne null si une recherche plus récente a remplacé celle-ci ; `searchProducts.limited` vaut true
 * quand une base a refusé l'appel (trop de recherches).
 */
export async function searchProducts(query, onUpdate = null) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 3) return [];
  if (searchCache.has(q)) { onUpdate?.(searchCache.get(q), 0); return searchCache.get(q); }
  if (searchCtrl) searchCtrl.abort();
  searchCtrl = new AbortController();
  const ctrl = searchCtrl;
  const timer = setTimeout(() => ctrl.abort(), 9000);
  searchProducts.limited = false;
  try {
    // Les quatre bases en parallèle ; les virgules de `fields` restent telles quelles (le serveur ne décode pas %2C).
    const one = async (base) => {
      const url = `https://${base.host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=6&lc=fr&fields=code,product_name,product_name_fr,brands,quantity,image_front_small_url,nutriscore_grade`;
      // Chaque base a 6 s ; une base lente n'empêche pas les autres de s'afficher.
      const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([ctrl.signal, AbortSignal.timeout(6000)]) : ctrl.signal;
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
        if (res.status === 429) searchProducts.limited = true;
        if (!res.ok) return [];
        const data = await res.json();
        return (data.products || [])
          .map((p) => ({ code: String(p.code || ''), nom: (p.product_name_fr || p.product_name || '').trim(), marque: (p.brands || '').split(',')[0].trim(), quantite: (p.quantity || '').trim(), image: p.image_front_small_url || null, nutriscore: grade(p.nutriscore_grade), base: base.id }))
          .filter((p) => p.code && p.nom);
      } catch (e) { if (ctrl.signal.aborted) throw e; return []; }
    };
    const byBase = new Map();
    const merged = () => { const seen = new Set(); return BASES.flatMap((b) => byBase.get(b.id) || []).filter((p) => !seen.has(p.code) && seen.add(p.code)).slice(0, 12); };
    let pending = BASES.length;
    await Promise.all(BASES.map(async (base) => {
      const list = await one(base);
      byBase.set(base.id, list);
      pending -= 1;
      if (!ctrl.signal.aborted && pending > 0) onUpdate?.(merged(), pending);
    }));
    if (ctrl.signal.aborted) return null;
    const products = merged();
    onUpdate?.(products, 0);
    searchCache.set(q, products);
    if (searchCache.size > 60) searchCache.delete(searchCache.keys().next().value);
    return products;
  } catch (e) {
    if (e && e.name === 'AbortError') return null; // remplacée par une recherche plus récente
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const one = async (base) => {
      const res = await fetch(`https://${base.host}/api/v2/product/${encodeURIComponent(code)}.json?lc=fr&fields=${FIELDS}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${base.label} répond ${res.status}`);
      const data = await res.json();
      if (data.status !== 1 || !data.product) return null;
      return normalizeOff(code, data.product, base);
    };
    // Les quatre bases en même temps ; on garde la première trouvée dans l'ordre de priorité.
    const results = await Promise.allSettled(BASES.map(one));
    const found = results.find((r) => r.status === 'fulfilled' && r.value);
    if (found) return found.value;
    const failure = results.find((r) => r.status === 'rejected');
    if (failure && results.every((r) => r.status === 'rejected')) throw failure.reason;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cache d'abord, réseau ensuite.
 * Retourne { product, source: 'cache' | 'off', notFound?, error? }.
 */
export async function lookupProduct(code, { force = false } = {}) {
  const cached = getState().stock.products[code] || null;
  const fresh = cached && cached.source !== 'manuel' && Date.now() - (cached.fetchedAt || 0) < CACHE_DAYS * 86400000;
  if (cached && (fresh || cached.source === 'manuel') && !force) return { product: cached, source: 'cache' };
  if (!navigator.onLine && cached) return { product: cached, source: 'cache' };
  try {
    const product = await fetchProduct(code);
    if (product) {
      // Un nom saisi à la main l'emporte sur celui d'Open Food Facts.
      if (cached?.source === 'manuel' && cached.nom) product.nom = cached.nom;
      update((s) => { s.stock.products[code] = product; }, { quiet: true });
      return { product, source: 'off' };
    }
    if (cached) return { product: cached, source: 'cache' };
    return { product: null, source: 'off', notFound: true };
  } catch (err) {
    if (cached) return { product: cached, source: 'cache' };
    return { product: null, source: 'off', error: err };
  }
}

/** Mémorise ce que l'utilisateur a saisi pour un code (produit inconnu ou renommé). */
export function rememberProduct(code, data) {
  if (!code) return;
  update((s) => {
    const prev = s.stock.products[code] || { code, source: 'manuel', fetchedAt: 0, allergenes: [], labels: [], ingredients: '', nutriments: null };
    s.stock.products[code] = { ...prev, nom: data.nom || prev.nom || '', marque: data.marque ?? prev.marque ?? '', conditionnement: data.conditionnement ?? prev.conditionnement ?? '',
      categorie: data.categorie || prev.categorie || 'Autre', emplacement: data.emplacement || prev.emplacement || 'placard', image: prev.image || data.image || null };
  }, { quiet: true });
}
