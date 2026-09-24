// Capture de `beforeinstallprompt` pour proposer un bouton « Installer l'app ».
let deferred = null;
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((fn) => fn(true));
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((fn) => fn(false));
});

export const canInstall = () => !!deferred;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
export function onInstallable(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((fn) => fn(false));
  return outcome === 'accepted';
}
