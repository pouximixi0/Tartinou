// Notifications push côté client : abonnement de cet appareil auprès du serveur.
import { api } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isStandaloneIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);

function toKey(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function label() {
  const ua = navigator.userAgent;
  const os = /iphone|ipad/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : 'Appareil';
  const nav = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /firefox\//i.test(ua) ? 'Firefox' : /safari\//i.test(ua) ? 'Safari' : 'Navigateur';
  return `${os} · ${nav}`;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Demande la permission et enregistre cet appareil. Lève une erreur lisible en cas de refus. */
export async function subscribeDevice(publicKey) {
  if (!pushSupported()) throw new Error('Ce navigateur ne gère pas les notifications push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées dans le navigateur.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  await api('POST', '/push/subscribe', { subscription: sub.toJSON(), label: label() });
  return sub;
}

export async function unsubscribeDevice() {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await api('DELETE', '/push/subscribe', { endpoint: sub.endpoint }); } catch {}
  await sub.unsubscribe();
}
