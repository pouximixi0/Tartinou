// Flux communauté : commun à tous les utilisateurs du serveur, servi par l'API
// (pas dans l'état du foyer). Cache en mémoire, rafraîchi sur événement temps réel.
import { api } from './api.js';

let cache = { posts: [], at: 0 };
const listeners = new Set();
export const communityPosts = () => cache.posts;
export function onCommunity(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((fn) => fn(cache.posts));

export async function loadCommunity() {
  const r = await api('GET', '/community');
  cache = { posts: r.posts || [], at: Date.now() };
  notify();
  return cache.posts;
}
export async function postCommunity(data) { await api('POST', '/community', data); return loadCommunity(); }
export async function reactCommunity(id, emoji) { await api('POST', `/community/${id}/react`, { emoji }); return loadCommunity(); }
export async function commentCommunity(id, texte) { await api('POST', `/community/${id}/comment`, { texte }); return loadCommunity(); }
export async function deleteCommunityComment(id, cid) { await api('DELETE', `/community/${id}/comment/${cid}`); return loadCommunity(); }
export async function deleteCommunityPost(id) { await api('DELETE', `/community/${id}`); return loadCommunity(); }

// Un autre appareil a publié : on recharge si quelqu'un écoute.
window.addEventListener('tartinou:community', () => { if (listeners.size) loadCommunity().catch(() => {}); });
