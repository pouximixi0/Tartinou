// Open Prices (Open Food Facts) : prix relevés en magasin par la communauté, pour un
// code-barres. On garde le relevé le plus récent par magasin et on trie par distance
// quand la position est connue (demandée une fois, gardée sur cet appareil).
const API = 'https://prices.openfoodfacts.org/api/v1/prices';
const POS_KEY = 'foyer:position';
const cache = new Map();

async function pages(query, maxPages) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${API}?${query}&size=100&page=${page}&order_by=-date`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) { if (page === 1) throw new Error(`Open Prices répond ${res.status}`); break; }
    const data = await res.json();
    items.push(...(data.items || []));
    if (!data.pages || page >= data.pages) break;
  }
  return items;
}

/**
 * Relevés pour un code-barres. Avec une position : d'abord les magasins dans un rayon de 15 km
 * (puis 60 km s'il y en a peu) grâce au filtre de proximité de l'API, complétés par les relevés
 * récents ; sans position : les 300 relevés les plus récents.
 */
export async function fetchOpenPrices(code, pos = null) {
  const code_ = String(code || '').trim();
  if (!code_) return [];
  const key = pos ? `${code_}@${pos.lat.toFixed(2)},${pos.lon.toFixed(2)}` : code_;
  if (cache.has(key)) return cache.get(key);
  const q = `product_code=${encodeURIComponent(code_)}`;
  const items = [];
  if (pos) {
    const near = (r) => pages(`${q}&lat=${pos.lat}&lon=${pos.lon}&radius_km=${r}`, 2);
    let nearby = await near(15);
    if (new Set(nearby.map((p) => p.location_id)).size < 5) nearby = nearby.concat(await near(60));
    items.push(...nearby);
    try { items.push(...await pages(q, 1)); } catch {}
  } else {
    items.push(...await pages(q, 3));
  }
  const byLoc = new Map();
  for (const p of items) {
    if (p.currency !== 'EUR' || !p.location || p.price == null) continue;
    if (byLoc.has(p.location_id)) continue; // trié par date décroissante : le premier est le plus récent
    const l = p.location;
    byLoc.set(p.location_id, {
      prix: Number(p.price), date: p.date || '', promo: !!p.price_is_discounted,
      magasin: l.osm_brand || l.osm_name || 'Magasin', ville: l.osm_address_city || '',
      lat: typeof l.osm_lat === 'number' ? l.osm_lat : null, lon: typeof l.osm_lon === 'number' ? l.osm_lon : null,
    });
  }
  const list = [...byLoc.values()];
  cache.set(key, list);
  return list;
}

/** Distance à vol d'oiseau, en km. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Position déjà autorisée sur cet appareil ? (sans rien demander) */
export async function positionGranted() {
  try { return navigator.permissions ? (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted' : false; } catch { return false; }
}
export function savedPosition() {
  try { const p = JSON.parse(localStorage.getItem(POS_KEY)); return p && typeof p.lat === 'number' && Date.now() - p.at < 30 * 86400000 ? p : null; } catch { return null; }
}
export function askPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Pas de géolocalisation sur cet appareil.'));
    navigator.geolocation.getCurrentPosition(
      (g) => { const p = { lat: g.coords.latitude, lon: g.coords.longitude, at: Date.now() }; try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {} resolve(p); },
      (e) => reject(new Error(e.code === 1 ? 'Position refusée : autorise la localisation pour trier par distance.' : 'Position indisponible pour le moment.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}
/** Ajoute `km` et trie : du plus proche au plus loin si la position est connue, sinon du plus récent au plus ancien. */
export function sortPrices(list, pos) {
  const withKm = list.map((p) => ({ ...p, km: pos && p.lat != null && p.lon != null ? distanceKm(pos, p) : null }));
  if (!pos) return withKm.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  return withKm.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || (b.date > a.date ? 1 : -1));
}
export const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`);
