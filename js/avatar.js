// Avatar d'un membre : sa photo de profil si elle existe, sinon ses initiales.
import { h } from './utils.js';
import { syncStatus } from './store.js';
import { api } from './api.js';
import { initials } from './social.js';

export function avatarFor(nom) {
  const m = (syncStatus().foyer?.membres || []).find((x) => x.nom === nom);
  return m?.avatar || null;
}
export function avatarEl(nom, cls = '', override = null) {
  const src = override || avatarFor(nom);
  if (src) return h('img', { class: `avatar avatar-img ${cls}`.trim(), src, alt: '', width: '34', height: '34' });
  return h('span', { class: `avatar ${cls}`.trim(), 'aria-hidden': 'true' }, initials(nom));
}

/** Réduit une image en carré de `size` px (JPEG) : léger, stocké en base de données. */
export function fileToAvatar(file, size = 128) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
    img.src = url;
  });
}
export const uploadAvatar = (dataUrl) => api('POST', '/auth/avatar', { image: dataUrl });
export const removeAvatar = () => api('DELETE', '/auth/avatar');
