// Écran Stock : ce qu'il y a dans le frigo, le congélateur et les placards.
// Scanner, chercher, filtrer par emplacement, ajuster les quantités,
// « À racheter » et journal anti-gaspi.
import { h, icon, toast, todayISO, money, fmtDate, addDays, uid } from '../utils.js';
import { getState, update, currentWeek } from '../store.js';
import { EMPLACEMENTS, uniteById, dlcInfo, dlcLabel, fmtQte, stockSummary, stockValue, valueOf, sortItems, removeStockItem, journalStats, normalizeText, adjustStockQty, allergenConflicts, wasteStats } from '../stock.js';
import { openInventorySheet } from '../components/inventory-sheet.js';
import { isLabelCode, itemIdFromLabel, printLabels } from '../qr.js';
import { openScanner, cameraAvailable } from '../scanner.js';
import { openProductSheet } from '../components/product-sheet.js';
import { openWasteDialog } from '../components/waste-dialog.js';
import { openDialog } from '../components/dialog.js';
import { stepper } from '../components/stepper.js';
import { isOn } from '../modules.js';
import { loadRecalls, recalls, recalledItems, recallsFor } from '../recalls.js';
import { openRecallsDialog } from '../components/recall-dialog.js';

// Filtres conservés entre deux rendus.
const ui = { q: '', emplacement: 'tous', tri: 'dlc' };

export function renderStock() {
  const state = getState();
  const st = state.settings.stock;
  const items = state.stock.items;
  const sum = stockSummary(state);
  const root = h('section', { class: 'screen screen-stock' });

  /* ---- En-tête ---- */
  const parts = [];
  if (sum.perimes) parts.push(`${sum.perimes} périmé${sum.perimes > 1 ? 's' : ''} (DLC)`);
  if (sum.urgents) parts.push(`${sum.urgents} à consommer vite`);
  if (sum.ddm) parts.push(`${sum.ddm} DDM dépassée${sum.ddm > 1 ? 's' : ''}`);
  const val = stockValue(items);
  root.append(
    h('div', { class: 'stock-head' },
      h('h1', { class: `lead${sum.perimes ? ' is-over' : ''}` }, items.length ? [h('span', { class: 'num' }, String(items.length)), ` produit${items.length > 1 ? 's' : ''} en stock`] : 'Ton stock est vide'),
      h('p', { class: 'muted' }, parts.length ? parts.join(' · ') : items.length ? 'Rien ne presse : aucune date limite proche.' : 'Scanne tes courses en les rangeant, le reste suit.'),
      val.avecPrix && isOn('valeurStock') ? h('p', { class: 'muted small' }, 'Valeur du stock : ', h('strong', { class: 'num' }, money(val.total)), val.sansPrix ? ` (${val.sansPrix} produit${val.sansPrix > 1 ? 's' : ''} sans prix)` : '') : null),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-primary btn-tall', onclick: () => startScan() }, icon('camera'), 'Scanner un produit'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-tall', onclick: () => openProductSheet({}) }, icon('plus'), 'À la main'),
      items.length && isOn('rangement') ? h('button', { type: 'button', class: 'btn btn-secondary btn-tall', onclick: openInventorySheet }, icon('check'), 'Rangement') : null),
  );

  /* ---- Rappels de produits (RappelConso) ---- */
  if (isOn('rappels') && items.some((it) => it.code)) {
    const shown = recalls().length;
    loadRecalls().then((l) => { if (l.length !== shown && root.isConnected) update(() => {}); }).catch(() => {});
    const touched = recalledItems(items);
    if (touched.length) {
      const list = recalls().filter((r) => touched.some((it) => Number(String(it.code).replace(/\D/g, '')) === Number(r.gtin)));
      root.append(h('button', { type: 'button', class: 'stock-alert stock-alert-btn', onclick: () => openRecallsDialog(list, touched) },
        icon('alert'), h('span', null, `Rappel officiel : ${touched.map((it) => it.nom).slice(0, 3).join(', ')}${touched.length > 3 ? ` et ${touched.length - 3} autre${touched.length > 4 ? 's' : ''}` : ''}. Ne consomme pas avant d’avoir lu la fiche.`), icon('chevron')));
    }
  }

  if (!items.length) {
    root.append(h('div', { class: 'empty' },
      h('p', null, 'Le scanner lit le code-barres et remplit le nom, la marque et la photo tout seul. Tu choisis l’emplacement et la date limite, c’est tout.'),
      h('p', { class: 'muted small' }, cameraAvailable() ? 'Astuce : après validation d’un ticket dans Courses, « Ranger les courses » remplit le stock d’un coup.' : 'Sans caméra ici, tu peux saisir le code ou ajouter à la main.')));
  } else {
    /* ---- Recherche, filtres, tri ---- */
    const search = h('input', { type: 'search', id: 'stock-q', class: 'input', placeholder: 'Chercher un produit…', value: ui.q, autocomplete: 'off',
      oninput: (ev) => { ui.q = ev.target.value; drawList(); } });
    const counts = new Map(EMPLACEMENTS.map((e) => [e.id, 0]));
    for (const it of items) counts.set(it.emplacement, (counts.get(it.emplacement) || 0) + 1);
    const chips = h('div', { class: 'chips chips-scroll', role: 'radiogroup', 'aria-label': 'Emplacement' });
    function drawChips() {
      chips.replaceChildren(
        ...[{ id: 'tous', nom: 'Tous', n: items.length }, ...EMPLACEMENTS.map((e) => ({ ...e, n: counts.get(e.id) || 0 }))].filter((e) => e.id === 'tous' || e.n).map((e) =>
          h('button', { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(ui.emplacement === e.id), style: { '--chip': 'var(--green)' }, onclick: () => { ui.emplacement = e.id; drawChips(); drawList(); } },
            e.nom, h('span', { class: 'chip-count num' }, String(e.n)))));
    }
    drawChips();
    const tri = h('select', { class: 'input', 'aria-label': 'Trier', value: ui.tri, onchange: (ev) => { ui.tri = ev.target.value; drawList(); } },
      h('option', { value: 'dlc' }, 'Date limite'), h('option', { value: 'nom' }, 'Nom'), h('option', { value: 'recent' }, 'Ajout récent'));
    root.append(h('div', { class: 'stock-filters' }, h('div', { class: 'field' }, h('label', { for: 'stock-q', class: 'visually-hidden' }, 'Chercher'), search), tri), chips);

    /* ---- Liste ---- */
    const listRoot = h('div', { class: 'stock-groups' });
    function drawList() {
      const q = normalizeText(ui.q.trim());
      let list = items.filter((it) => (ui.emplacement === 'tous' || it.emplacement === ui.emplacement) && (!q || normalizeText(`${it.nom} ${it.marque} ${it.categorie} ${it.notes}`).includes(q)));
      list = sortItems(list, ui.tri);
      listRoot.replaceChildren();
      if (!list.length) { listRoot.append(h('p', { class: 'empty-line muted' }, 'Aucun produit ne correspond.')); return; }
      if (ui.emplacement === 'tous' && !q) {
        const urgent = list.filter((it) => ['perime', 'urgent'].includes(dlcInfo(it, st.alertDays).status));
        if (urgent.length) listRoot.append(group('À consommer vite', sortItems(urgent, 'dlc'), 'is-urgent'));
        const ddm = list.filter((it) => dlcInfo(it, st.alertDays).status === 'ddm');
        if (ddm.length) listRoot.append(group('DDM dépassée : à vérifier', sortItems(ddm, 'dlc'), 'is-ddm', 'Souvent encore bon : regarde l’aspect et l’odeur avant de jeter.'));
        const rest = list.filter((it) => !urgent.includes(it) && !ddm.includes(it));
        for (const e of EMPLACEMENTS) {
          const sub = rest.filter((it) => it.emplacement === e.id);
          if (sub.length) listRoot.append(group(e.nom, sub));
        }
      } else {
        listRoot.append(h('ul', { class: 'stock-list' }, list.map((it) => itemRow(it, st))));
      }
    }
    function group(title, list, cls = '', hint = '') {
      return h('section', { class: `stock-group ${cls}`.trim(), 'aria-label': title },
        h('h2', { class: 'h-section' }, title, ' ', h('span', { class: 'muted small num' }, `(${list.length})`)),
        hint ? h('p', { class: 'muted small' }, hint) : null,
        h('ul', { class: 'stock-list' }, list.map((it) => itemRow(it, st))));
    }
    drawList();
    root.append(listRoot);
  }

  if (isOn('aRacheter')) root.append(aRacheterZone(state));
  if (isOn('antiGaspi')) root.append(antiGaspiZone(state));
  return root;
}

/* ---------- Ligne produit ---------- */
function itemRow(item, st) {
  const info = dlcInfo(item, st.alertDays);
  const li = h('li', { class: `stock-item dlc-${info.status}` });
  const thumb = item.image
    ? h('img', { class: 'stock-thumb', src: item.image, alt: '', loading: 'lazy', onerror: (ev) => ev.target.replaceWith(h('span', { class: 'stock-thumb stock-thumb-empty' }, icon('box'))) })
    : h('span', { class: 'stock-thumb stock-thumb-empty' }, icon('box'));
  const meta = [item.marque, item.conditionnement && item.unite === 'piece' ? item.conditionnement : '', item.ouvertLe ? 'ouvert' : '', isOn('portions') && item.portions != null ? `${item.portions} portion${item.portions > 1 ? 's' : ''}` : '', isOn('prixHistorique') ? item.magasin || '' : ''].filter(Boolean).join(' · ');
  const product = item.code ? getState().stock.products[item.code] : null;
  const conflicts = isOn('allergenes') ? allergenConflicts(getState(), product) : [];
  const nutri = isOn('nutriscore') && product && product.nutriscore ? h('span', { class: `score-mini score-${product.nutriscore}`, title: `Nutri-Score ${product.nutriscore.toUpperCase()}` }, product.nutriscore.toUpperCase()) : null;
  const step = stepper({
    value: item.qte, step: uniteById(item.unite).step, min: 0, label: item.nom, size: 'stepper-sm',
    format: (v) => fmtQte({ ...item, conditionnement: '', qte: v }),
    onChange: (v, prev) => {
      if (v <= 0) return askLast(item, step, prev);
      update((s) => adjustStockQty(s, item.id, v - prev, v > prev ? 'ajout' : 'conso'));
    },
  });
  li.append(
    h('button', { type: 'button', class: 'stock-main', 'aria-label': `${item.nom}, ${fmtQte(item)}, ${dlcLabel(item, info)}. Ouvrir la fiche`, onclick: () => openProductSheet({ item }) },
      thumb,
      h('span', { class: 'stock-text' },
        h('span', { class: 'stock-name' }, item.nom),
        meta ? h('span', { class: 'stock-meta muted small' }, meta) : null,
        h('span', { class: 'badges' }, isOn('rappels') && recallsFor(item.code).length ? h('span', { class: 'tag-allergene tag-rappel', title: 'Produit rappelé (RappelConso)' }, icon('alert'), 'Rappelé') : null, nutri, h('span', { class: `dlc-badge dlc-${info.status}` }, dlcLabel(item, info)), conflicts.length ? h('span', { class: 'tag-allergene', title: `Contient : ${conflicts.join(', ')}` }, icon('alert'), conflicts[0]) : null))),
    step,
  );
  return li;
}

/** Dernière unité retirée : consommée ou jetée ? Jetée → on demande le prix si on ne l'a pas, pour chiffrer le gaspillage. */
function askLast(item, step, prev) {
  const box = h('input', { type: 'checkbox', checked: item.seuilMin > 0 });
  let chosen = null;
  const dlg = openDialog({
    title: `${item.nom} : c’était le dernier`,
    cls: 'sheet-compact',
    content: [
      h('p', null, 'Qu’est-ce qu’il est devenu ? Le journal anti-gaspi compte les produits jetés, en euros quand le prix est connu.'),
      h('label', { class: 'switch' }, box, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', null, 'Le mettre dans « À racheter »')),
    ],
    actions: [
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'),
      h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => { chosen = 'jete'; dlg.close(); } }, 'Jeté'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { chosen = 'conso'; dlg.close(); } }, 'Consommé'),
    ],
    onClose: async () => {
      if (!chosen) { step.set(prev, { silent: true }); return; }
      if (chosen === 'conso') {
        update((s) => removeStockItem(s, item.id, 'conso', { aRacheter: box.checked }));
        toast(`${item.nom} : terminé`);
        return;
      }
      const res = await openWasteDialog({ ...item, qte: prev });
      if (!res.ok) { step.set(prev, { silent: true }); return; }
      update((s) => removeStockItem(s, item.id, 'jete', { aRacheter: box.checked, prix: res.prix }));
      const v = valueOf(res.prix, prev, item.unite);
      toast(v != null ? `${item.nom} : jeté, ${money(v)} gaspillés` : `${item.nom} : jeté`);
    },
  });
}

/* ---------- Scanner ---------- */
export function startScan(initialMode = 'ajout') {
  let mode = initialMode;
  openScanner({
    mode,
    modes: [{ id: 'ajout', label: 'Ajouter' }, { id: 'retrait', label: 'Retirer' }],
    onModeChange: (m) => { mode = m; },
    onCode: (code, api) => {
      if (isLabelCode(code)) {
        const item = getState().stock.items.find((x) => x.id === itemIdFromLabel(code));
        if (!item) { api.setStatus('Étiquette inconnue : le produit n’est plus en stock'); return; }
        if (mode === 'retrait') {
          const step = uniteById(item.unite).step;
          update((s) => adjustStockQty(s, item.id, -step, 'conso'));
          api.setStatus(item.qte - step > 0 ? `${item.nom} : −${step}` : `${item.nom} : plus en stock`);
          return;
        }
        api.pause();
        openProductSheet({ item, onClose: () => api.resume() });
        return;
      }
      if (mode === 'retrait') return retirerParCode(code, api);
      api.pause();
      const st = getState().settings.stock;
      openProductSheet({ code, onClose: (saved) => {
        if (st.scanContinu) { api.resume(); api.setStatus(saved ? 'Ajouté · scanne le suivant' : 'Vise le code-barres'); }
        else api.close();
      } });
    },
  });
}

function retirerParCode(code, api) {
  const lines = getState().stock.items.filter((x) => x.code === code);
  if (!lines.length) { api.setStatus('Ce produit n’est pas dans ton stock'); toast('Produit absent du stock : passe en mode Ajouter pour l’enregistrer.'); return; }
  // Première sortie : la ligne dont la date limite est la plus proche.
  const target = sortItems(lines, 'dlc')[0];
  const step = uniteById(target.unite).step;
  update((s) => adjustStockQty(s, target.id, -step, 'conso'));
  const remaining = getState().stock.items.filter((x) => x.code === code).reduce((a, x) => a + x.qte, 0);
  api.setStatus(remaining > 0 ? `${target.nom} : −${step}, reste ${fmtQte({ ...target, conditionnement: '', qte: remaining })}` : `${target.nom} : plus en stock`);
}

/* ---------- À racheter ---------- */
export function aRacheterZone(state) {
  const list = state.stock.aRacheter;
  const week = currentWeek();
  const canPush = week && !week.validation;
  function pushAll() {
    update((s) => {
      const w = s.menus.weeks.find((x) => x.id === week.id);
      for (const r of s.stock.aRacheter) w.manualItems.push({ id: uid(), article: r.nom, quantite: r.qte > 1 ? String(r.qte) : '', prix_estime: 0, rayon: 'À racheter' });
      s.stock.aRacheter = [];
    });
    toast('Ajouté à la liste de courses de la semaine');
  }
  return h('details', { class: 'zone', open: list.length > 0 },
    h('summary', { class: 'zone-title' }, 'À racheter', list.length ? h('span', { class: 'zone-count num' }, String(list.length)) : null),
    h('div', { class: 'zone-body' },
      list.length
        ? h('ul', { class: 'rows' }, list.map((r) =>
            h('li', { class: 'row-item' },
              h('span', { class: 'row-text' }, r.nom, h('span', { class: 'muted small block' }, r.auto ? 'sous le stock minimum' : `ajouté le ${fmtDate(r.ajouteLe, { day: 'numeric', month: 'short' })}`)),
              h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openProductSheet({ code: r.code, defaults: { nom: r.nom, qte: r.qte, unite: r.unite } }) }, 'Ranger'),
              h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Retirer ${r.nom} de la liste`, onclick: () => update((s) => { s.stock.aRacheter = s.stock.aRacheter.filter((x) => x.id !== r.id); }) }, icon('x')))))
        : h('p', { class: 'muted small' }, 'Les produits terminés ou sous leur stock minimum arrivent ici. Tu peux aussi les envoyer dans la liste de courses.'),
      list.length && canPush ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: pushAll }, icon('basket'), 'Mettre tout dans la liste de courses') : null,
      list.length && !canPush ? h('p', { class: 'muted small' }, 'Importe un menu pour envoyer ces produits dans la liste de courses.') : null));
}

/* ---------- Anti-gaspi ---------- */
function antiGaspiZone(state) {
  const today = todayISO();
  const from = today.slice(0, 8) + '01';
  const stats = journalStats(state, from, addDays(today, 1));
  const journal = [...state.stock.journal].reverse().slice(0, 150);
  const TYPES = { ajout: 'ajouté', conso: 'consommé', jete: 'jeté', retrait: 'retiré' };
  function openJournal() {
    openDialog({
      title: 'Journal du stock',
      content: journal.length
        ? h('ul', { class: 'rows' }, journal.map((j) => {
            const v = j.type === 'jete' ? valueOf(j.prix, j.qte, j.unite) : null;
            return h('li', { class: `row-item journal-${j.type}` },
              h('span', { class: 'row-text' }, j.nom, h('span', { class: 'muted small block' }, `${fmtDate(j.date, { day: 'numeric', month: 'short' })} · ${TYPES[j.type] || j.type} · ${fmtQte({ qte: j.qte, unite: j.unite, conditionnement: '' })}`)),
              v != null ? h('span', { class: 'num journal-value' }, `−${money(v)}`) : j.type === 'jete' ? h('span', { class: 'muted small' }, 'prix inconnu') : null);
          }))
        : h('p', { class: 'muted' }, 'Rien pour l’instant.'),
    });
  }
  return h('details', { class: 'zone' },
    h('summary', { class: 'zone-title' }, 'Anti-gaspi ce mois-ci'),
    h('div', { class: 'zone-body' },
      h('div', { class: 'stats-row' },
        stat(stats.conso, 'consommés'),
        stat(stats.jete, 'jetés', stats.jete > 0),
        stat(money(stats.jeteValeur), 'gaspillés', stats.jeteValeur > 0)),
      h('p', { class: 'muted small' }, stats.jete && stats.jeteSansPrix ? `${stats.jeteSansPrix} produit${stats.jeteSansPrix > 1 ? 's' : ''} jeté${stats.jeteSansPrix > 1 ? 's' : ''} sans prix : le montant réel est plus élevé. Renseigne le prix à l’ajout ou au moment de jeter.` : 'Le montant vient des prix renseignés sur les produits jetés.'),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: openJournal }, icon('clock'), 'Journal'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openStats(state) }, icon('list'), 'Statistiques'),
        state.stock.items.length && isOn('etiquettesQR') ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => printLabels(state.stock.items.filter((i) => !i.code)).catch((e) => toast(e.message)) }, icon('image'), 'Étiquettes QR') : null)));
}
/** Statistiques anti-gaspi sur six mois. */
function openStats(state) {
  const w = wasteStats(state);
  const maxJete = Math.max(1, ...w.perMonth.map((m) => m.jete));
  openDialog({
    title: 'Anti-gaspi sur 6 mois',
    content: [
      h('div', { class: 'stats-row' },
        stat(w.tauxAvantDate != null ? `${w.tauxAvantDate} %` : '–', 'consommé avant date'),
        stat(w.jete, 'jetés', w.jete > 0),
        stat(money(w.perMonth.reduce((a, m) => a + m.jeteValeur, 0)), 'gaspillés', w.jete > 0)),
      h('h3', { class: 'h-small' }, 'Par mois'),
      h('ul', { class: 'bars' }, w.perMonth.map((m) => h('li', { class: 'bar-row' },
        h('div', { class: 'bar-head' }, h('span', null, m.label), h('span', { class: 'num' }, `${m.jete} jeté${m.jete > 1 ? 's' : ''}${m.jeteValeur ? ` · ${money(m.jeteValeur)}` : ''} · ${m.conso} consommé${m.conso > 1 ? 's' : ''}`)),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.round((m.jete / maxJete) * 100)}%`, background: 'var(--danger)' } }))))),
      w.byCategory.length ? [h('h3', { class: 'h-small' }, 'Par catégorie'), h('ul', { class: 'plain-list' }, w.byCategory.map((c) => h('li', null, `${c.categorie} : ${c.n} jeté${c.n > 1 ? 's' : ''}${c.valeur ? ` (${money(c.valeur)})` : ''}`)))] : null,
      w.topProducts.length ? [h('h3', { class: 'h-small' }, 'Le plus souvent jetés'), h('ul', { class: 'plain-list' }, w.topProducts.map((p) => h('li', null, `${p.nom} : ${p.n} fois${p.valeur ? ` (${money(p.valeur)})` : ''}`)))] : null,
      !w.jete && !w.conso ? h('p', { class: 'muted' }, 'Pas encore assez d’historique : consomme et jette depuis l’app pour alimenter ces chiffres.') : null,
    ],
  });
}

function stat(value, label, bad = false) {
  return h('div', { class: `stat${bad ? ' is-bad' : ''}` }, h('span', { class: 'stat-value num' }, String(value)), h('span', { class: 'stat-label muted small' }, label));
}
