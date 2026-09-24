// Écran de connexion : le serveur demande un code d'accès (FOYER_TOKEN).
import { h, icon } from '../utils.js';
import { setToken, getToken } from '../api.js';
import { reconnect } from '../store.js';

export function renderLogin() {
  const root = h('section', { class: 'screen screen-onboarding' });
  const input = h('input', { type: 'password', id: 'login-token', class: 'input input-big', autocomplete: 'current-password', placeholder: '••••••••', value: getToken() });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: submit }, 'Se connecter');

  async function submit() {
    const t = input.value.trim();
    if (!t) { err.textContent = 'Saisis le code d’accès du serveur.'; err.hidden = false; input.focus(); return; }
    btn.disabled = true;
    setToken(t);
    const s = await reconnect();
    if (s.status === 'auth') {
      err.textContent = 'Code refusé. Vérifie FOYER_TOKEN sur le serveur.';
      err.hidden = false;
      btn.disabled = false;
      input.focus();
      input.select();
    }
  }
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });

  root.append(
    h('div', { class: 'onboarding-head' }, h('p', { class: 'brand-big' }, 'Tartinou'), h('p', { class: 'muted' }, 'Tes données vivent sur ton serveur.')),
    h('div', { class: 'onboarding-body' },
      h('div', null,
        h('h1', { class: 'lead' }, 'Code d’accès'),
        h('p', { class: 'muted' }, 'C’est la valeur de FOYER_TOKEN dans /etc/foyer.env sur le serveur. Il est mémorisé sur cet appareil.'),
        h('div', { class: 'field' }, h('label', { for: 'login-token' }, 'Code'), input),
        err,
        btn)),
  );
  setTimeout(() => input.focus(), 50);
  return root;
}
