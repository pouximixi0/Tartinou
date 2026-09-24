// Client HTTP vers l'API du serveur. La session (jeton) est gardée dans localStorage ;
// chaque onglet a un identifiant pour reconnaître ses propres écritures en temps réel.
export const TOKEN_KEY = 'foyer:token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
export const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} };

let clientId = '';
try { clientId = sessionStorage.getItem('foyer:client') || ''; if (!clientId) { clientId = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('foyer:client', clientId); } } catch { clientId = Math.random().toString(36).slice(2, 10); }
export const getClientId = () => clientId;

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** api('GET', '/state') · api('PUT', '/state', { expenses }) — lève ApiError (status 0 = injoignable, 401 = session requise). */
export async function api(method, path, body) {
  const headers = { Accept: 'application/json', 'X-Client-Id': clientId };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`./api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Serveur injoignable');
  }
  let data = null;
  try { data = res.status === 204 ? null : await res.json(); } catch { data = null; }
  if (res.status === 401) throw new ApiError(401, (data && data.error) || 'Connecte-toi pour continuer.');
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Erreur ${res.status}`);
  return data;
}
