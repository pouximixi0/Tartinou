// Feuille « Publier » : envoie un élément de l'app (recette, liste, menu,
// produit du stock) dans le fil, pour tout le monde ou pour le foyer seulement.
import { h, icon, toast } from '../utils.js';
import { openDialog } from './dialog.js';
import { update, currentUser } from '../store.js';
import { createPost } from '../social.js';
import { postCommunity } from '../community.js';

const LABELS = { recette: 'Recette', liste: 'Liste de courses', menu: 'Menu', produit: 'Produit' };

/**
 * `type` : recette | liste | menu | produit ; `texte` : phrase par défaut ;
 * `payload` : l'objet partagé ; `apercu` : ligne affichée dans la feuille.
 */
export function openPublishSheet({ type, texte, payload, apercu = '' }) {
  const me = currentUser();
  const input = h('textarea', { class: 'input', rows: '2', placeholder: 'Un mot pour accompagner ? (facultatif)', maxlength: '600', 'aria-label': 'Message' });
  let busy = false;
  const dlg = openDialog({
    title: 'Publier dans le fil',
    cls: 'sheet-compact',
    content: [
      h('p', { class: 'publish-preview' }, icon(type === 'produit' ? 'box' : type === 'liste' ? 'basket' : type === 'menu' ? 'list' : 'pot'), h('span', null, h('strong', null, LABELS[type] || 'Élément'), apercu ? h('span', { class: 'muted' }, ` · ${apercu}`) : null)),
      h('div', { class: 'field' }, input),
      h('p', { class: 'muted small' }, '« Tout le monde » : visible par tous les utilisateurs du serveur. « Mon foyer » : seulement les membres de ton foyer.'),
    ],
    actions: [
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => send('foyer') }, 'Mon foyer'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => send('tous') }, icon('message'), 'Tout le monde'),
    ],
  });
  async function send(portee) {
    if (busy) return;
    busy = true;
    const mot = input.value.trim();
    // Recette et produit : le mot remplace la phrase par défaut. Liste et menu : la phrase reste
    // le titre du bloc replié, le mot s'affiche au-dessus.
    const keepTitle = type === 'liste' || type === 'menu';
    const data = { type, texte: keepTitle || !mot ? texte : mot, payload: keepTitle && mot ? { ...payload, mot } : payload };
    try {
      if (portee === 'tous') await postCommunity(data);
      else update((s) => { createPost(s, { ...data, auteur: me?.nom || null }); });
      dlg.close();
      toast(portee === 'tous' ? 'Publié pour tout le monde' : 'Publié pour ton foyer');
    } catch (e) {
      busy = false;
      toast(e.message || 'Publication impossible');
    }
  }
}
