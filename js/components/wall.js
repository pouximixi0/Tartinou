// Mur du foyer : petits mots entre membres (« pense au lait », « frigo à vider
// vendredi »), épinglables, avec notification aux autres appareils. Et le fil
// d'activité : qui a fait quoi.
import { h, icon, toast } from '../utils.js';
import { getState, update, currentUser, syncStatus } from '../store.js';
import { postMessage, activityFeed, relativeTime } from '../social.js';
import { openDialog, confirmDialog } from './dialog.js';

function messageRow(m, { compact = false } = {}) {
  const me = currentUser();
  const isAdmin = me?.role === 'admin';
  const mine = me && m.auteur === me.nom;
  return h('li', { class: `wall-msg${m.epingle ? ' is-pinned' : ''}` },
    h('div', { class: 'wall-head' },
      h('span', { class: 'wall-author' }, m.auteur || 'Quelqu’un'),
      h('span', { class: 'muted small' }, relativeTime(m.at)),
      m.epingle ? h('span', { class: 'tag-stock' }, 'épinglé') : null),
    h('p', { class: 'wall-text' }, m.texte),
    compact ? null : h('div', { class: 'wall-actions' },
      h('button', { type: 'button', class: 'link small', onclick: () => update((s) => { const x = s.messages.find((y) => y.id === m.id); if (x) x.epingle = !x.epingle; }) }, m.epingle ? 'Désépingler' : 'Épingler'),
      mine || isAdmin ? h('button', { type: 'button', class: 'link small', onclick: async () => { const ok = await confirmDialog({ title: 'Supprimer ce mot ?', message: m.texte, confirmLabel: 'Supprimer', danger: true }); if (ok) update((s) => { s.messages = s.messages.filter((y) => y.id !== m.id); }); } }, 'Supprimer') : null),
  );
}

function composer(onSent) {
  const input = h('input', { type: 'text', class: 'input', placeholder: 'Un mot pour le foyer… (ex. pense au lait)', maxlength: '500', 'aria-label': 'Nouveau message' });
  const send = () => {
    const t = input.value.trim();
    if (!t) return;
    const me = currentUser();
    update((s) => postMessage(s, me?.nom || null, t));
    input.value = '';
    toast((syncStatus().foyer?.membres?.length || 1) > 1 ? 'Envoyé au foyer' : 'Noté sur le mur');
    onSent?.();
  };
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); send(); } });
  return h('div', { class: 'wall-composer' }, input, h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Envoyer', onclick: send }, icon('message'), 'Envoyer'));
}

/** Zone du mur pour l'écran Aujourd'hui : épinglés + trois derniers mots + saisie. */
export function wallZone(state) {
  const msgs = [...state.messages].sort((a, b) => (b.epingle - a.epingle) || b.at - a.at);
  const shown = msgs.slice(0, 3);
  return h('section', { class: 'zone zone-open wall' },
    h('h2', { class: 'zone-title' }, 'Mur du foyer',
      h('span', { class: 'zone-tools' },
        h('button', { type: 'button', class: 'link small', onclick: openActivity }, 'Activité'),
        msgs.length > 3 ? h('button', { type: 'button', class: 'link small', onclick: openWall }, `Tout voir (${msgs.length})`) : null)),
    h('div', { class: 'zone-body' },
      shown.length ? h('ul', { class: 'wall-list' }, shown.map((m) => messageRow(m, { compact: true }))) : h('p', { class: 'muted small' }, 'Laisse un mot aux autres membres : il s’affiche ici et leur est envoyé en notification.'),
      composer()),
  );
}

export function openWall() {
  const list = h('ul', { class: 'wall-list' });
  const draw = () => { const msgs = [...getState().messages].sort((a, b) => (b.epingle - a.epingle) || b.at - a.at); list.replaceChildren(...(msgs.length ? msgs.map((m) => messageRow(m)) : [h('p', { class: 'muted' }, 'Aucun mot pour l’instant.')])); };
  draw();
  openDialog({ title: 'Mur du foyer', content: [composer(draw), list] });
}

export function openActivity() {
  const feed = activityFeed(getState(), 60);
  openDialog({
    title: 'Activité du foyer',
    content: feed.length
      ? h('ul', { class: 'feed' }, feed.map((e) => h('li', { class: `feed-item${e.bad ? ' is-bad' : ''}` },
          icon(e.icon),
          h('span', { class: 'feed-text' }, e.auteur ? h('strong', null, `${e.auteur} `) : null, e.message ? h('span', { class: 'muted' }, 'a écrit : ') : e.verb ? '' : null, e.text),
          h('span', { class: 'muted small feed-time' }, relativeTime(e.at)))))
      : h('p', { class: 'muted' }, 'Rien encore. Les dépenses, les produits ajoutés ou jetés, les plats cuisinés et les mots du mur apparaîtront ici.'),
  });
}
