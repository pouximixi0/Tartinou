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
  const root = h('section', { class: 'screen screen-onboarding screen-auth' });
  const card = h('div', { class: 'auth-card' });
  const draw = () => card.replaceChildren(mode === 'login' ? loginForm(switchTo) : registerForm(switchTo));
  function switchTo(m) { mode = m; draw(); }

  root.append(
    h('div', { class: 'onboarding-head' },
      h('img', { src: 'icons/icon-192.png', width: '64', height: '64', alt: '', class: 'login-logo' }),
      h('p', { class: 'brand-big' }, 'Tartinou'),
      h('p', { class: 'muted' }, 'Dépenses, menus, courses et stock, partagés avec ton foyer.')),
    card,
    h('p', { class: 'muted small auth-foot' }, 'Tes données restent sur ce serveur, dans la base de ton foyer.'),
  );
  draw();
  return root;
}

function field(id, label, input, hint = null) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'field-hint muted small' }, hint) : null);
}

/** Champ mot de passe avec bouton « voir ». */
function passwordField(id, label, attrs, hint = null) {
  const input = h('input', { type: 'password', id, class: 'input', ...attrs });
  const toggle = h('button', { type: 'button', class: 'btn-icon pw-toggle', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false', tabindex: '-1', onclick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    input.focus();
  } }, icon('eye'));
  return { input, el: h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'pw-wrap' }, input, toggle), hint ? h('span', { class: 'field-hint muted small' }, hint) : null) };
}

/** Entrée dans un champ : passe au suivant s'il est vide, sinon laisse le formulaire se valider. */
function nextOnEnter(input, next) {
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    if (next && !next.value) { ev.preventDefault(); next.focus(); }
  });
}

function loginForm(switchTo) {
  const user = h('input', { type: 'text', id: 'lg-login', class: 'input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ton identifiant', enterkeyhint: 'next', required: true });
  const pw = passwordField('lg-pass', 'Mot de passe', { autocomplete: 'current-password', placeholder: '••••••••', enterkeyhint: 'go', required: true });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block btn-tall' }, 'Se connecter');
  nextOnEnter(user, pw.input);
  async function submit() {
    err.hidden = true;
    if (!user.value.trim() || !pw.input.value) { err.textContent = 'Identifiant et mot de passe sont nécessaires.'; err.hidden = false; (user.value.trim() ? pw.input : user).focus(); return; }
    btn.disabled = true; btn.textContent = 'Connexion…';
    try {
      const s = await login(user.value.trim(), pw.input.value);
      if (s.status === 'auth') throw new Error(s.message || 'Connexion refusée.');
    } catch (e) {
      err.textContent = e.message || 'Connexion impossible.';
      err.hidden = false;
      btn.disabled = false; btn.textContent = 'Se connecter';
      pw.input.focus(); pw.input.select();
    }
  }
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); submit(); } },
    h('h2', { class: 'auth-title' }, 'Connexion'),
    field('lg-login', 'Identifiant', user),
    pw.el,
    err,
    btn,
    h('p', { class: 'auth-switch muted' }, 'Pas encore de compte ? ', h('button', { type: 'button', class: 'link', onclick: () => switchTo('register') }, 'Créer un compte')));
  setTimeout(() => user.focus(), 50);
  return form;
}

function registerForm(switchTo) {
  const nom = h('input', { type: 'text', id: 'rg-nom', class: 'input', autocomplete: 'given-name', placeholder: 'Ex. Julie', maxlength: '40', enterkeyhint: 'next' });
  const user = h('input', { type: 'text', id: 'rg-login', class: 'input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ex. julie', maxlength: '32', enterkeyhint: 'next' });
  const pw = passwordField('rg-pass', 'Mot de passe', { autocomplete: 'new-password', placeholder: '8 caractères minimum', enterkeyhint: 'next' });
  const pw2 = passwordField('rg-pass2', 'Confirmation', { autocomplete: 'new-password', placeholder: 'le même', enterkeyhint: 'next' });
  const invit = h('input', { type: 'text', id: 'rg-invit', class: 'input input-code', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX', maxlength: '9', enterkeyhint: 'go', value: inviteFromHash(),
    oninput: () => { const raw = invit.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); invit.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw; } });
  const nomFoyer = h('input', { type: 'text', id: 'rg-foyer', class: 'input', placeholder: 'Ex. Maison Dupont', maxlength: '60', enterkeyhint: 'next' });
  const codeServeur = h('input', { type: 'password', id: 'rg-serveur', class: 'input', autocomplete: 'off', placeholder: 'donné par la personne qui héberge', enterkeyhint: 'go' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block btn-tall' }, 'Créer mon compte');
  nextOnEnter(nom, user); nextOnEnter(user, pw.input); nextOnEnter(pw.input, pw2.input);
  nextOnEnter(nomFoyer, codeServeur);

  // Force du mot de passe : longueur et variété, sans prétendre plus.
  const strength = h('div', { class: 'pw-strength', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'));
  const strengthLabel = h('span', { class: 'field-hint muted small' }, '8 caractères minimum');
  pw.input.addEventListener('input', () => {
    const v = pw.input.value;
    const score = v.length >= 8 ? 1 + (v.length >= 12 ? 1 : 0) + (/[A-Z]/.test(v) && /[0-9]/.test(v) ? 1 : 0) : 0;
    strength.dataset.score = String(score);
    strengthLabel.textContent = !v ? '8 caractères minimum' : score === 0 ? `${8 - v.length} caractère${8 - v.length > 1 ? 's' : ''} de plus` : score === 1 ? 'Correct' : score === 2 ? 'Bon' : 'Très bon';
  });
  pw.el.append(strength, strengthLabel);
  pw2.input.addEventListener('input', () => pw2.input.classList.toggle('is-mismatch', pw2.input.value && pw2.input.value !== pw.input.value));

  let join = true;
  const joinSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Foyer' },
    [[true, 'Rejoindre un foyer'], [false, 'Créer un foyer']].map(([v, label]) =>
      h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'rg-join', checked: join === v, onchange: () => { join = v; drawFoyer(); } }), h('span', null, label))));
  const foyerBox = h('div', { class: 'stack' });
  // Le code serveur n'est demandé que si le serveur l'exige (inscriptions sur invitation, après le premier compte).
  let needServerCode = true;
  const serverHint = h('p', { class: 'muted small' }, 'Créer un nouveau foyer demande le code donné par la personne qui héberge Tartinou.');
  function drawFoyer() {
    foyerBox.replaceChildren(...(join
      ? [field('rg-invit', 'Code d’invitation', invit, 'Affiché dans Réglages → Compte et foyer de la personne qui t’invite.')]
      : [field('rg-foyer', 'Nom du foyer', nomFoyer), needServerCode ? field('rg-serveur', 'Code serveur', codeServeur) : null, needServerCode ? serverHint : null]));
  }
  api('GET', '/health').then((hlt) => {
    needServerCode = !hlt.premierCompte && hlt.inscription !== 'ouverte';
    if (hlt.premierCompte && !inviteFromHash()) { join = false; joinSeg.querySelectorAll('input')[1].checked = true; }
    drawFoyer();
  }).catch(() => {});
  drawFoyer();

  async function submit() {
    err.hidden = true;
    const show = (m, el) => { err.textContent = m; err.hidden = false; el?.focus(); };
    if (!nom.value.trim()) return show('Indique ton prénom : c’est lui que les autres verront.', nom);
    if (!user.value.trim()) return show('Choisis un identifiant.', user);
    if (pw.input.value.length < 8) return show('Le mot de passe fait au moins 8 caractères.', pw.input);
    if (pw.input.value !== pw2.input.value) return show('Les deux mots de passe ne correspondent pas.', pw2.input);
    if (join && invit.value.replace('-', '').length < 8) return show('Saisis le code d’invitation du foyer à rejoindre (8 caractères).', invit);
    if (!join && !nomFoyer.value.trim()) return show('Donne un nom à ton foyer.', nomFoyer);
    btn.disabled = true; btn.textContent = 'Création…';
    try {
      const s = await register({ login: user.value.trim(), nom: nom.value.trim(), password: pw.input.value, codeInvitation: join ? invit.value.trim() : '', nomFoyer: join ? '' : nomFoyer.value.trim(), codeServeur: join ? '' : codeServeur.value });
      if (s.status === 'auth') throw new Error(s.message || 'Inscription refusée.');
    } catch (e) {
      show(e.message || 'Inscription impossible.');
      btn.disabled = false; btn.textContent = 'Créer mon compte';
    }
  }
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); submit(); } },
    h('h2', { class: 'auth-title' }, 'Créer un compte'),
    h('p', { class: 'h-section' }, 'Toi'),
    h('div', { class: 'field-row' }, field('rg-nom', 'Prénom', nom), field('rg-login', 'Identifiant', user)),
    pw.el,
    pw2.el,
    h('p', { class: 'h-section' }, 'Ton foyer'),
    joinSeg,
    foyerBox,
    err,
    btn,
    h('p', { class: 'auth-switch muted' }, 'Déjà un compte ? ', h('button', { type: 'button', class: 'link', onclick: () => switchTo('login') }, 'Se connecter')));
  setTimeout(() => (inviteFromHash() ? nom : nom).focus(), 50);
  return form;
}
