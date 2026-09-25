// Rappels de produits (RappelConso) : le serveur vérifie les codes-barres du stock
// du foyer ; ici, un cache en mémoire et des aides pour retrouver les rappels d'un produit.
import { api } from './api.js';

let cache = { list: [], at: 0, loading: null };
export const recalls = () => cache.list;
const sameCode = (a, b) => a && b && Number(String(a).replace(/\D/g, '')) === Number(String(b).replace(/\D/g, ''));
/** Rappels qui concernent ce code-barres. */
export const recallsFor = (code) => (code ? cache.list.filter((r) => sameCode(r.gtin, code)) : []);
/** Articles du stock concernés par au moins un rappel. */
export const recalledItems = (items) => items.filter((it) => it.code && cache.list.some((r) => sameCode(r.gtin, it.code)));

export async function loadRecalls({ force = false } = {}) {
  if (!force && Date.now() - cache.at < 30 * 60000) return cache.list;
  if (cache.loading) return cache.loading;
  cache.loading = api('GET', '/rappels')
    .then((r) => { cache = { list: r.rappels || [], at: Date.now(), loading: null }; return cache.list; })
    .catch((e) => { cache.loading = null; throw e; });
  return cache.loading;
}
