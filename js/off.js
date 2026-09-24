// Client Open Food Facts : un code-barres → nom, marque, image, scores.
// Les produits sont mémorisés dans state.stock.products (donc en base) pour
// fonctionner hors ligne et éviter de rappeler l'API.
import { getState, update } from './store.js';
import { guessCategorie, guessEmplacement } from './stock.js';

const BASE = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = ['code', 'product_name', 'product_name_fr', 'generic_name_fr', 'brands', 'quantity', 'categories', 'categories_tags', 'image_front_small_url', 'image_front_url',
  'nutriscore_grade', 'nova_group', 'ecoscore_grade', 'environmental_score_grade', 'allergens_tags', 'labels_tags', 'ingredients_text_fr', 'ingredients_text', 'nutriments'].join(',');
const CACHE_DAYS = 45;

const ALLERGENES = {
  milk: 'lait', gluten: 'gluten', eggs: 'œufs', nuts: 'fruits à coque', peanuts: 'arachides', soybeans: 'soja', fish: 'poisson', crustaceans: 'crustacés',
  molluscs: 'mollusques', celery: 'céleri', mustard: 'moutarde', 'sesame-seeds': 'sésame', 'sulphur-dioxide-and-sulphites': 'sulfites', lupin: 'lupin',
};
const tagName = (t) => String(t).replace(/^[a-z]{2}:/, '');
const grade = (g) => (typeof g === 'string' && /^[a-e]$/.test(g) ? g : null);

export function normalizeOff(code, p) {
  const nom = (p.product_name_fr || p.product_name || p.generic_name_fr || '').trim();
  const catsText = [p.categories, ...(p.categories_tags || [])].filter(Boolean).join(' ');
  const categorie = guessCategorie(catsText, nom);
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
    source: 'off', fetchedAt: Date.now(),
  };
}

/** Interroge Open Food Facts. Résout null si le produit est inconnu ; lève en cas d'erreur réseau. */
export async function fetchProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${BASE}${encodeURIComponent(code)}.json?lc=fr&fields=${FIELDS}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Open Food Facts répond ${res.status}`);
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    return normalizeOff(code, data.product);
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
