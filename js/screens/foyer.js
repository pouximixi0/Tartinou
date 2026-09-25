// Écran Foyer : le flux social. Deux portées : « Tout le monde » (tous les
// utilisateurs du serveur, via l'API communauté) et « Mon foyer » (les membres,
// dans l'état du foyer). Publier un mot, partager une recette, le menu ou la
// liste ; réagir, commenter, mentionner, épingler ; activité automatique.
import { h, icon, toast, uid, todayISO, capitalize, DAYS, fmtDate } from '../utils.js';
import { getState, update, currentUser, currentWeek } from '../store.js';
import { REACTIONS, createPost, toggleReaction, addComment, removeComment, removePost, togglePin, sortedPosts, splitMentions, activityFeed, relativeTime } from '../social.js';
import { communityPosts, loadCommunity, onCommunity, postCommunity, reactCommunity, commentCommunity, deleteCommunityComment, deleteCommunityPost, loadMembers } from '../community.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { openFavoriteRecipe } from '../components/recipe.js';
import { shareText, menuText, shoppingListText, recipeText } from '../share.js';
import { putMealInWeek, todayDayName } from '../planning.js';
import { isOn } from '../modules.js';
import { avatarEl } from '../avatar.js';
import { openProductSheet } from '../components/product-sheet.js';
import { fmtQte, emplacementById } from '../stock.js';

const ui = { portee: 'tous', filtre: 'tout', openComments: new Set(), draft: '', commentDrafts: new Map() };
export const LAST_SEEN_KEY = 'foyer:flux-vu';
export const markFeedSeen = () => { try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch {} };
export const lastSeen = () => { try { return Number(localStorage.getItem(LAST_SEEN_KEY)) || 0; } catch { return 0; } };

export function renderFoyer() {
  const state = getState();
  const me = currentUser();
  const root = h('section', { class: 'screen screen-foyer' });
  markFeedSeen();

  const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Portée' },
    [['tous', 'Tout le monde'], ['foyer', 'Mon foyer']].map(([id, label]) => h('label', { class: 'seg' },
      h('input', { type: 'radio', name: 'portee', value: id, checked: ui.portee === id, onchange: () => { ui.portee = id; draw(); startLiveFeed(); } }), h('span', null, label))));
  const body = h('div', { class: 'feed-body' });
  // Bouton « Membres » dans la barre du haut, à côté des réglages.
  const membersBtn = h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Membres de l’application', title: 'Membres', onclick: () => openMembers(me, (nom) => { ui.draft = `${ui.draft.trim()} @${nom} `.trimStart(); draw(); body.querySelector('textarea')?.focus(); }) }, icon('users'));
  document.getElementById('topbar-actions')?.replaceChildren(membersBtn);
  root.append(seg, body);

  let unsub = null, timer = null, deferred = false;
  function stopLiveFeed() { if (unsub) { unsub(); unsub = null; } if (timer) { clearInterval(timer); timer = null; } }
  function draw() {
    // Quelqu'un tape un message ou un commentaire : on redessine après, pour ne pas lui couper la saisie.
    const active = document.activeElement;
    if (active && body.contains(active) && /^(TEXTAREA|INPUT)$/.test(active.tagName) && active.value.trim()) {
      if (!deferred) { deferred = true; active.addEventListener('blur', () => { deferred = false; if (root.isConnected) draw(); }, { once: true }); }
      return;
    }
    body.replaceChildren(...(ui.portee === 'tous' ? communityView(me, draw) : foyerView(state, me)));
  }
  /** Temps réel : événement SSE du serveur, plus un sondage de secours toutes les 30 s tant que l'écran est ouvert. */
  function startLiveFeed() {
    stopLiveFeed();
    if (ui.portee !== 'tous') return;
    unsub = onCommunity(() => { if (root.isConnected) draw(); else stopLiveFeed(); });
    timer = setInterval(() => { if (!root.isConnected) return stopLiveFeed(); if (document.visibilityState === 'visible') loadCommunity().catch(() => {}); }, 30000);
    loadCommunity().catch((e) => toast(e.message || 'Communauté injoignable'));
  }
  draw();
  startLiveFeed();
  return root;
}

/* ---------- Annuaire : tous les comptes du serveur, groupés par foyer ---------- */
function openMembers(me, onMention) {
  const list = h('div', { class: 'members-list' }, h('p', { class: 'muted small' }, 'Chargement…'));
  const dlg = openDialog({ title: 'Membres de Tartinou', cls: 'sheet-compact', content: list });
  loadMembers().then((membres) => {
    // Tous les comptes du serveur, mon foyer en premier.
    const groups = new Map();
    for (const m of [...membres].sort((a, b) => Number(b.monFoyer) - Number(a.monFoyer))) (groups.get(m.foyer) || groups.set(m.foyer, []).get(m.foyer)).push(m);
    const enLigne = membres.filter((m) => m.enLigne).length;
    list.replaceChildren(
      h('p', { class: 'muted small' }, `${membres.length} membre${membres.length > 1 ? 's' : ''} sur ce serveur, ${groups.size} foyer${groups.size > 1 ? 's' : ''} · ${enLigne} en ligne`),
      ...[...groups].map(([foyer, ms]) => h('section', null,
        h('h3', { class: 'h-small' }, foyer, ms.some((m) => m.monFoyer) ? h('span', { class: 'muted' }, ' · mon foyer') : null),
        h('ul', { class: 'rows' }, ms.map((m) => h('li', { class: 'row-item member-row' },
          h('span', { class: `avatar-wrap${m.enLigne ? ' is-online' : ''}` }, avatarEl(m.nom, '', m.avatar)),
          h('span', { class: 'row-text' }, m.nom, m.moi ? h('span', { class: 'muted' }, ' (moi)') : null,
            h('span', { class: 'muted small block' }, [m.role === 'admin' ? 'Administrateur' : 'Membre', m.enLigne ? 'en ligne' : null, `depuis le ${fmtDate(new Date(m.depuis || Date.now()).toISOString().slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}`].filter(Boolean).join(' · '))),
          !m.moi ? h('button', { type: 'button', class: 'btn-icon btn-icon-sm', 'aria-label': `Mentionner ${m.nom}`, title: 'Mentionner dans un message', onclick: () => { dlg.close(); onMention(m.nom); } }, icon('message')) : null))))));
  }).catch((e) => list.replaceChildren(h('p', { class: 'muted small' }, e.message || 'Liste indisponible')));
}

/* ---------- Portée « Tout le monde » ---------- */
function communityView(me, refresh) {
  const posts = communityPosts();
  const ops = {
    kind: 'community',
    react: (p, emo) => reactCommunity(p.id, emo).catch((e) => toast(e.message)),
    comment: (p, t) => commentCommunity(p.id, t).catch((e) => toast(e.message)),
    removeComment: (p, cid) => deleteCommunityComment(p.id, cid).catch((e) => toast(e.message)),
    remove: (p) => deleteCommunityPost(p.id).catch((e) => toast(e.message)),
    pin: null,
    canRemove: (p) => p.mine,
    canRemoveComment: (p, c) => c.mine || p.mine,
    isActive: (p, emo) => me && ((p.reactions || {})[emo] || []).includes(me.nom) && true,
  };
  return [
    composer(me, { onPost: (data) => postCommunity(data).then(() => toast('Publié pour tout le monde')).catch((e) => toast(e.message)) }),
    h('p', { class: 'muted small' }, 'Visible par tous les utilisateurs de ce serveur, quel que soit leur foyer.'),
    posts.length
      ? h('ul', { class: 'feed-list' }, posts.map((p) => postCard(p, me, ops)))
      : h('div', { class: 'empty' }, h('p', null, 'Personne n’a encore rien publié. Lance-toi : un mot, une recette, ton menu de la semaine.')),
  ];
}

/* ---------- Portée « Mon foyer » ---------- */
function foyerView(state, me) {
  const ops = {
    kind: 'foyer',
    react: (p, emo) => update((s) => toggleReaction(s, p.id, emo, me.nom)),
    comment: (p, t) => update((s) => addComment(s, p.id, me?.nom || null, t)),
    removeComment: (p, cid) => update((s) => removeComment(s, p.id, cid)),
    remove: (p) => update((s) => removePost(s, p.id)),
    pin: (p) => update((s) => togglePin(s, p.id)),
    canRemove: (p) => (me && p.auteur === me.nom) || me?.role === 'admin',
    canRemoveComment: (p, c) => (me && c.auteur === me.nom) || me?.role === 'admin',
  };
  const chips = h('div', { class: 'chips' }, [['tout', 'Tout'], ['posts', 'Publications'], ['activite', 'Activité']].map(([id, label]) =>
    h('button', { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(ui.filtre === id), onclick: () => { ui.filtre = id; update(() => {}); } }, label)));
  const posts = ui.filtre === 'activite' ? [] : sortedPosts(state.posts);
  const acts = ui.filtre === 'posts' || !isOn('activite') ? [] : activityFeed(state, 40);
  const entries = [...posts.map((p) => ({ kind: 'post', at: p.epingle ? Infinity : p.at, post: p })), ...acts.map((a) => ({ kind: 'act', at: a.at, act: a }))].sort((a, b) => b.at - a.at);
  return [
    composer(me, { onPost: (data) => { update((s) => createPost(s, { ...data, auteur: me?.nom || null })); toast('Publié pour le foyer'); } }),
    chips,
    entries.length
      ? h('ul', { class: 'feed-list' }, entries.map((e) => (e.kind === 'post' ? postCard(e.post, me, ops) : activityRow(e.act))))
      : h('div', { class: 'empty' }, h('p', null, 'Rien pour l’instant dans ton foyer. Écris un mot, partage une recette ou le menu de la semaine : les autres membres reçoivent une notification.')),
  ];
}

/* ---------- Composer ---------- */
function composer(me, { onPost }) {
  const state = getState();
  const input = h('textarea', { class: 'input', rows: '2', placeholder: 'Quoi de neuf ? (@prénom pour prévenir quelqu’un)', maxlength: '1000', 'aria-label': 'Nouvelle publication', value: ui.draft, oninput: (ev) => { ui.draft = ev.target.value; } });
  const send = () => { const t = input.value.trim(); if (!t) return; onPost({ type: 'message', texte: t }); input.value = ''; ui.draft = ''; };
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); } });
  const week = currentWeek();
  return h('section', { class: 'zone zone-open composer' },
    h('div', { class: 'zone-body' },
      h('div', { class: 'composer-row' }, avatarEl(me?.nom), input),
      h('div', { class: 'composer-tools' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: send }, icon('message'), 'Publier'),
        isOn('favoris') && state.recettes.length ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => pickRecipe(state, onPost) }, icon('pot'), 'Recette') : null,
        week && isOn('menus') ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => onPost({ type: 'menu', texte: `Menu de la semaine du ${fmtDate(week.menu.semaine, { day: 'numeric', month: 'long' })}`, payload: { texte: menuText(week), semaine: week.menu.semaine } }) }, icon('list'), 'Menu') : null,
        week && isOn('courses') ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { const items = [...week.menu.courses.map((c, i) => ({ key: `c${i}`, ...c })), ...(week.manualItems || []).map((m) => ({ key: `m${m.id}`, rayon: m.rayon || 'Autre', article: m.article, quantite: m.quantite, prix_estime: Number(m.prix_estime) || 0 }))]; onPost({ type: 'liste', texte: 'Liste de courses de la semaine', payload: { texte: shoppingListText(week, items) } }); } }, icon('basket'), 'Liste') : null)));
}

function pickRecipe(state, onPost) {
  const dlg = openDialog({
    title: 'Partager une recette',
    cls: 'sheet-compact',
    content: h('ul', { class: 'rows' }, state.recettes.map((r) => h('li', { class: 'row-item' },
      h('span', { class: 'row-text' }, r.nom, h('span', { class: 'muted small block' }, `${r.temps || '?'} min · ${(r.ingredients || []).length} ingrédients`)),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => {
        const snap = { nom: r.nom, temps: r.temps, tags: r.tags || [], recette: r.recette, ingredients: r.ingredients || [], personnes: r.personnes || 2, lien: r.lien || null };
        onPost({ type: 'recette', texte: `a partagé une recette : ${r.nom}`, payload: snap });
        dlg.close();
      } }, 'Partager')))),
  });
}

/* ---------- Carte d'une publication (commune aux deux portées) ---------- */
function richText(texte) {
  return h('p', { class: 'post-text' }, splitMentions(texte).map((part) => (part.mention ? h('span', { class: 'mention' }, part.text) : part.text)));
}

function postCard(p, me, ops) {
  const li = h('li', { class: `post${p.epingle ? ' is-pinned' : ''} post-${p.type}` });
  const comments = p.commentaires || [];
  const commentsOpen = ui.openComments.has(p.id);

  const reactionBar = h('div', { class: 'reactions' }, REACTIONS.map((emo) => {
    const who = (p.reactions || {})[emo] || [];
    const active = me && who.includes(me.nom);
    return h('button', { type: 'button', class: `reaction${active ? ' is-active' : ''}${who.length ? ' has-count' : ''}`, title: who.length ? who.join(', ') : `Réagir ${emo}`, 'aria-pressed': String(!!active),
      onclick: () => { if (me) ops.react(p, emo); } }, emo, who.length ? h('span', { class: 'num' }, String(who.length)) : null);
  }));

  const commentList = h('ul', { class: 'comments' }, comments.map((c) => h('li', { class: 'comment' },
    avatarEl(c.auteur),
    h('div', { class: 'comment-body' }, h('span', { class: 'comment-head' }, h('strong', null, c.auteur || 'Quelqu’un'), h('span', { class: 'muted small' }, ` · ${relativeTime(c.at)}`)), richText(c.texte)),
    ops.canRemoveComment(p, c) ? h('button', { type: 'button', class: 'btn-icon btn-icon-sm', 'aria-label': 'Supprimer le commentaire', onclick: () => ops.removeComment(p, c.id) }, icon('x')) : null)));
  const cInput = h('input', { type: 'text', class: 'input', placeholder: 'Commenter…', maxlength: '600', 'aria-label': 'Commentaire', value: ui.commentDrafts.get(p.id) || '', oninput: (ev) => { ui.commentDrafts.set(p.id, ev.target.value); } });
  const sendComment = () => { const t = cInput.value.trim(); if (!t) return; ops.comment(p, t); cInput.value = ''; ui.commentDrafts.delete(p.id); };
  cInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); sendComment(); } });
  const commentBox = h('div', { class: 'comment-box', hidden: !commentsOpen }, commentList, h('div', { class: 'wall-composer' }, cInput, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: sendComment }, 'Envoyer')));

  const parts = [
    h('div', { class: 'post-head' },
      avatarEl(p.auteur, '', p.avatar),
      h('div', { class: 'post-meta' }, h('strong', null, p.auteur || 'Quelqu’un'), h('span', { class: 'muted small' }, `${p.foyer && ops.kind === 'community' ? ` · ${p.foyer}` : ''} · ${relativeTime(p.at)}${p.epingle ? ' · épinglé' : ''}`)),
      h('div', { class: 'post-tools' },
        isOn('partage') ? h('button', { type: 'button', class: 'btn-icon btn-icon-sm', 'aria-label': 'Partager', onclick: () => shareText({ title: 'Tartinou', text: p.type === 'recette' && p.payload ? recipeText(p.payload) : p.payload?.texte || p.texte }) }, icon('share')) : null,
        ops.pin ? h('button', { type: 'button', class: 'btn-icon btn-icon-sm', 'aria-label': p.epingle ? 'Désépingler' : 'Épingler', 'aria-pressed': String(!!p.epingle), onclick: () => ops.pin(p) }, icon('flash')) : null,
        ops.canRemove(p) ? h('button', { type: 'button', class: 'btn-icon btn-icon-sm', 'aria-label': 'Supprimer', onclick: async () => { const ok = await confirmDialog({ title: 'Supprimer cette publication ?', message: p.texte, confirmLabel: 'Supprimer', danger: true }); if (ok) ops.remove(p); } }, icon('trash')) : null)),
    p.type === 'recette' && p.payload ? recipeCard(p.payload) : null,
    p.type === 'produit' && p.payload ? productCard(p.payload) : null,
    (p.type === 'menu' || p.type === 'liste') && p.payload?.mot ? richText(p.payload.mot) : null,
    p.type === 'menu' || p.type === 'liste' ? h('details', { class: 'post-attach' }, h('summary', null, p.texte), h('pre', { class: 'post-pre' }, p.payload?.texte || '')) : richText(p.texte),
    h('div', { class: 'post-actions' },
      reactionBar,
      h('button', { type: 'button', class: 'link small', onclick: () => { if (ui.openComments.has(p.id)) ui.openComments.delete(p.id); else ui.openComments.add(p.id); commentBox.hidden = !ui.openComments.has(p.id); if (!commentBox.hidden) cInput.focus(); } }, icon('message'), comments.length ? `${comments.length} commentaire${comments.length > 1 ? 's' : ''}` : 'Commenter')),
    commentBox,
  ];
  li.append(...parts.filter((x) => x != null));
  return li;
}

function recipeCard(r) {
  function plan() {
    let jour = todayDayName(), moment = new Date().getHours() < 14 ? 'midi' : 'soir';
    const jourSel = h('select', { class: 'input', 'aria-label': 'Jour', value: jour, onchange: (ev) => { jour = ev.target.value; } }, DAYS.map((d) => h('option', { value: d }, capitalize(d))));
    const momentSel = h('select', { class: 'input', 'aria-label': 'Moment', value: moment, onchange: (ev) => { moment = ev.target.value; } }, [['midi', 'Midi'], ['soir', 'Soir']].map(([v, l]) => h('option', { value: v }, l)));
    const dlg = openDialog({ title: `Mettre « ${r.nom} » au menu`, cls: 'sheet-compact', content: h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('label', null, 'Jour'), jourSel), h('div', { class: 'field' }, h('label', null, 'Moment'), momentSel)),
      actions: [h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { update((s) => putMealInWeek(s, { ...r, ingredients: (r.ingredients || []).map((i) => ({ ...i, enStock: false })) }, jour, moment)); dlg.close(); toast(`${r.nom} : ${capitalize(jour)} ${moment}`); } }, 'Mettre au menu')] });
  }
  const already = getState().recettes.some((x) => x.nom.toLowerCase() === r.nom.toLowerCase());
  return h('div', { class: 'recipe-card' },
    h('button', { type: 'button', class: 'recipe-card-main', onclick: () => openFavoriteRecipe(r, { onPlan: isOn('menus') ? () => plan() : null }) },
      icon('pot'),
      h('span', { class: 'recipe-card-text' }, h('strong', null, r.nom), h('span', { class: 'muted small' }, `${r.temps || '?'} min · ${(r.ingredients || []).length} ingrédient${(r.ingredients || []).length > 1 ? 's' : ''} · ${r.personnes || 2} pers.${r.tags?.length ? ` · ${r.tags.slice(0, 3).join(', ')}` : ''}`)),
      icon('chevron')),
    h('div', { class: 'row-actions' },
      isOn('favoris') ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: already, onclick: () => { update((s) => { s.recettes.push({ id: uid(), ...r, ajouteLe: todayISO() }); }); toast('Ajoutée à tes favoris'); } }, icon('check'), already ? 'Dans mes favoris' : 'Garder') : null,
      isOn('menus') ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: plan }, icon('plus'), 'Au menu') : null));
}

/** Produit du stock partagé : fiche résumée, « Au stock » ouvre la feuille produit pré-remplie. */
function productCard(pr) {
  const meta = [];
  if (pr.marque) meta.push(pr.marque);
  if (pr.qte != null) meta.push(fmtQte({ qte: pr.qte, unite: pr.unite }));
  if (pr.emplacement) meta.push(emplacementById(pr.emplacement).nom);
  if (pr.dlc) meta.push(`${pr.ddm ? 'DDM' : 'DLC'} ${fmtDate(pr.dlc, { day: 'numeric', month: 'short' })}`);
  const nutri = isOn('nutriscore') && pr.nutriscore ? h('span', { class: `score-mini score-${pr.nutriscore}`, title: `Nutri-Score ${pr.nutriscore.toUpperCase()}` }, pr.nutriscore.toUpperCase()) : null;
  const thumb = pr.image ? h('img', { class: 'product-card-img', src: pr.image, alt: '', loading: 'lazy', onerror: (ev) => ev.target.replaceWith(icon('box')) }) : icon('box');
  return h('div', { class: 'recipe-card product-card' },
    h('div', { class: 'recipe-card-main' }, thumb,
      h('span', { class: 'recipe-card-text' }, h('strong', null, pr.nom, ' ', nutri), h('span', { class: 'muted small' }, meta.join(' · ')))),
    isOn('stock') ? h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openProductSheet({ code: pr.code || null, defaults: { nom: pr.nom, marque: pr.marque || '', image: pr.image || null, qte: pr.qte ?? 1, unite: pr.unite || 'piece', emplacement: pr.emplacement || 'placard', categorie: pr.categorie || 'Autre' } }) }, icon('plus'), 'Au stock')) : null);
}

function activityRow(a) {
  return h('li', { class: `feed-act${a.bad ? ' is-bad' : ''}` },
    icon(a.icon),
    h('span', { class: 'feed-text' }, a.auteur ? h('strong', null, `${a.auteur} `) : null, a.text),
    h('a', { class: 'muted small feed-time', href: a.url }, relativeTime(a.at)));
}
