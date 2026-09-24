// Connexion et inscription. Un foyer regroupe les personnes qui partagent les
// mêmes données ; on le rejoint avec son code d'invitation.
import { h, icon } from '../utils.js';
import { login, register } from '../store.js';
import { api } from '../api.js';

let mode = 'login';
/** #rejoindre=CODE dans l'adresse : on ouvre l'inscription avec le code déjà saisi. */
const inviteFromHash = () => { const m = location.hash.match(/rejoindre=([A-Za-z0-9-]+)/); return m ? decodeURIComponent(m[1]).toUpperCase() : ''; };
if (inviteFromHash()) mode = 'register';

export function renderLogin() {
  const root = h('section', { class: 'screen screen-onboarding' });
  const body = h('div', { class: 'onboarding-body' });
  const seg = h('div', { class: 'segmented', role: 'tablist' },
    [['login', 'Se connecter'], ['register', 'Créer un compte']].map(([id, label]) =>
      h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'auth-mode', value: id, checked: mode === id, onchange: () => { mode = id; draw(); } }), h('span', null, label))));

  const draw = () => body.replaceChildren(mode === 'login' ? loginForm() : registerForm());

  root.append(
    h('div', { class: 'onboarding-head' },
      h('img', { src: 'icons/icon-192.png', width: '72', height: '72', alt: '', class: 'login-logo' }),
      h('p', { class: 'brand-big' }, 'Tartinou'),
      h('p', { class: 'muted' }, 'Dépenses, menus et stock, partagés avec ton foyer.')),
    seg,
    body,
  );
  draw();
  return root;
}

function field(id, label, input) { return h('div', { class: 'field' }, h('label', { for: id }, label), input); }

function loginForm() {
  const user = h('input', { type: 'text', id: 'lg-login', class: 'input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ton identifiant' });
  const pass = h('input', { type: 'password', id: 'lg-pass', class: 'input', autocomplete: 'current-password', placeholder: '••••••••' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: submit }, 'Se connecter');
  async function submit() {
    err.hidden = true;
    if (!user.value.trim() || !pass.value) { err.textContent = 'Identifiant et mot de passe sont nécessaires.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      const s = await login(user.value.trim(), pass.value);
      if (s.status === 'auth') throw new Error(s.message || 'Connexion refusée.');
    } catch (e) {
      err.textContent = e.message || 'Connexion impossible.';
      err.hidden = false;
      btn.disabled = false;
      pass.focus(); pass.select();
    }
  }
  const form = h('form', { onsubmit: (ev) => { ev.preventDefault(); submit(); } },
    h('div', { class: 'stack' },
      field('lg-login', 'Identifiant', user),
      field('lg-pass', 'Mot de passe', pass),
      err,
      btn,
      h('p', { class: 'muted small' }, 'Pas encore de compte ? Choisis « Créer un compte » ci-dessus.')));
  setTimeout(() => user.focus(), 50);
  return form;
}

function registerForm() {
  const nom = h('input', { type: 'text', id: 'rg-nom', class: 'input', autocomplete: 'name', placeholder: 'Ex. Julie', maxlength: '40' });
  const user = h('input', { type: 'text', id: 'rg-login', class: 'input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'lettres, chiffres, point, tiret', maxlength: '32' });
  const pass = h('input', { type: 'password', id: 'rg-pass', class: 'input', autocomplete: 'new-password', placeholder: '8 caractères minimum' });
  const pass2 = h('input', { type: 'password', id: 'rg-pass2', class: 'input', autocomplete: 'new-password', placeholder: 'le même' });
  const invit = h('input', { type: 'text', id: 'rg-invit', class: 'input', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX', maxlength: '9', value: inviteFromHash() });
  const nomFoyer = h('input', { type: 'text', id: 'rg-foyer', class: 'input', placeholder: 'Ex. Maison Dupont', maxlength: '60' });
  const codeServeur = h('input', { type: 'password', id: 'rg-serveur', class: 'input', autocomplete: 'off', placeholder: 'donné par la personne qui héberge' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: submit }, 'Créer mon compte');
  let join = true;
  const joinSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Foyer' },
    [[true, 'Rejoindre un foyer'], [false, 'Créer un foyer']].map(([v, label]) =>
      h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'rg-join', checked: join === v, onchange: () => { join = v; drawFoyer(); } }), h('span', null, label))));
  const foyerBox = h('div', { class: 'stack' });
  const serverHint = h('p', { class: 'muted small' }, 'Le premier compte du serveur crée son foyer librement. Ensuite, créer un nouveau foyer demande le code serveur.');
  function drawFoyer() {
    foyerBox.replaceChildren(...(join
      ? [field('rg-invit', 'Code d’invitation du foyer', invit), h('p', { class: 'muted small' }, 'Il est affiché dans Réglages → Compte et foyer de la personne qui t’invite.')]
      : [field('rg-foyer', 'Nom du foyer', nomFoyer), field('rg-serveur', 'Code serveur (si demandé)', codeServeur), serverHint]));
  }
  api('GET', '/health').then((hlt) => {
    if (hlt.premierCompte && !inviteFromHash()) { join = false; joinSeg.querySelectorAll('input')[1].checked = true; drawFoyer(); serverHint.textContent = 'Premier compte de ce serveur : tu crées ton foyer, sans code.'; }
    else if (hlt.inscription === 'ouverte') serverHint.textContent = 'Les inscriptions sont ouvertes : aucun code serveur nécessaire.';
  }).catch(() => {});
  drawFoyer();

  async function submit() {
    err.hidden = true;
    const show = (m) => { err.textContent = m; err.hidden = false; };
    if (!user.value.trim()) return show('Choisis un identifiant.');
    if (pass.value.length < 8) return show('Le mot de passe fait au moins 8 caractères.');
    if (pass.value !== pass2.value) return show('Les deux mots de passe ne correspondent pas.');
    if (join && !invit.value.trim()) return show('Saisis le code d’invitation du foyer à rejoindre.');
    btn.disabled = true;
    try {
      const s = await register({ login: user.value.trim(), nom: nom.value.trim(), password: pass.value, codeInvitation: join ? invit.value.trim() : '', nomFoyer: join ? '' : nomFoyer.value.trim(), codeServeur: join ? '' : codeServeur.value });
      if (s.status === 'auth') throw new Error(s.message || 'Inscription refusée.');
    } catch (e) {
      show(e.message || 'Inscription impossible.');
      btn.disabled = false;
    }
  }
  const form = h('form', { onsubmit: (ev) => { ev.preventDefault(); submit(); } },
    h('div', { class: 'stack' },
      field('rg-nom', 'Prénom (affiché aux autres membres)', nom),
      field('rg-login', 'Identifiant', user),
      h('div', { class: 'field-row' }, field('rg-pass', 'Mot de passe', pass), field('rg-pass2', 'Confirmation', pass2)),
      joinSeg,
      foyerBox,
      err,
      btn));
  setTimeout(() => nom.focus(), 50);
  return form;
}
