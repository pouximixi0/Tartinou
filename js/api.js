// Client HTTP vers l'API du serveur (SQLite). Le code d'accès est gardé dans localStorage.
export const TOKEN_KEY = 'foyer:token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
export const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** api('GET', '/state') · api('PUT', '/state', { expenses }) — lève ApiError (status 0 = injoignable, 401 = code requis). */
export async function api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`./api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Serveur injoignable');
  }
  if (res.status === 401) throw new ApiError(401, 'Code d’accès requis');
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? null : res.json();
}
