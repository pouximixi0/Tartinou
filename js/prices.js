// Open Prices (Open Food Facts) : prix relevés en magasin par la communauté, pour un
// code-barres. On garde le relevé le plus récent par magasin et on trie par distance
// quand la position est connue (demandée une fois, gardée sur cet appareil).
const API = 'https://prices.openfoodfacts.org/api/v1/prices';
const POS_KEY = 'foyer:position';
const cache = new Map();

export async function fetchOpenPrices(code) {
  const key = String(code || '').trim();
  if (!key) return [];
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`${API}?product_code=${encodeURIComponent(key)}&size=60&order_by=-date`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`Open Prices répond ${res.status}`);
  const data = await res.json();
  const byLoc = new Map();
  for (const p of data.items || []) {
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
