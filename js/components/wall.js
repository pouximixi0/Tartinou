// Aperçu du flux du foyer sur l'écran Aujourd'hui : épinglés et dernières
// publications, saisie rapide, lien vers l'onglet Foyer.
import { h, icon, toast } from '../utils.js';
import { update, currentUser, syncStatus } from '../store.js';
import { createPost, sortedPosts, relativeTime, splitMentions, reactionCount } from '../social.js';
import { avatarEl } from '../avatar.js';

export function wallZone(state) {
  const posts = sortedPosts(state.posts).slice(0, 3);
  const me = currentUser();
  const input = h('input', { type: 'text', class: 'input', placeholder: 'Un mot pour le foyer…', maxlength: '1000', 'aria-label': 'Nouvelle publication' });
  const send = () => {
    const t = input.value.trim();
    if (!t) return;
    update((s) => createPost(s, { type: 'message', auteur: me?.nom || null, texte: t }));
    input.value = '';
    toast((syncStatus().foyer?.membres?.length || 1) > 1 ? 'Publié pour le foyer' : 'Publié');
  };
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); send(); } });
  return h('section', { class: 'zone zone-open wall' },
    h('h2', { class: 'zone-title' }, 'Foyer', h('span', { class: 'zone-tools' }, h('a', { class: 'link small', href: '#foyer' }, 'Voir le flux'))),
    h('div', { class: 'zone-body' },
      posts.length
        ? h('ul', { class: 'wall-list' }, posts.map((p) => h('li', { class: `wall-msg${p.epingle ? ' is-pinned' : ''}` },
            h('div', { class: 'wall-head' }, avatarEl(p.auteur, 'avatar-sm'), h('span', { class: 'wall-author' }, p.auteur || 'Quelqu’un'), h('span', { class: 'muted small' }, relativeTime(p.at)), p.epingle ? h('span', { class: 'tag-stock' }, 'épinglé') : null),
            h('p', { class: 'wall-text' }, p.type === 'recette' ? [icon('pot'), ' ', p.texte] : splitMentions(p.texte).map((part) => (part.mention ? h('span', { class: 'mention' }, part.text) : part.text))),
            reactionCount(p) || (p.commentaires || []).length ? h('p', { class: 'muted small' }, [reactionCount(p) ? `${reactionCount(p)} réaction${reactionCount(p) > 1 ? 's' : ''}` : null, (p.commentaires || []).length ? `${p.commentaires.length} commentaire${p.commentaires.length > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')) : null)))
        : h('p', { class: 'muted small' }, 'Écris un mot, partage une recette ou le menu : le foyer le voit ici et reçoit une notification.'),
      h('div', { class: 'wall-composer' }, input, h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Publier', onclick: send }, icon('message'), 'Publier'))),
  );
}
