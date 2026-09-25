// Feuille produit : ajout au stock (après un scan, depuis les courses ou à la
// main) et modification d'une ligne existante. Les infos Open Food Facts
// arrivent en arrière-plan et ne remplacent jamais ce que l'utilisateur a saisi.
import { h, icon, toast, todayISO, addDays, parseAmount, fmtDate, money } from '../utils.js';
import { getState, update } from '../store.js';
import { EMPLACEMENTS, CATEGORIES, UNITES, DATE_TYPES, uniteById, emplacementById, defaultDlc, defaultDdm, addStockItem, removeStockItem, adjustStockQty, addARacheter, fmtQte, prixLabel, valueOf, priceInsight, knownStores, allergenConflicts } from '../stock.js';
import { printLabels } from '../qr.js';
import { lookupProduct, rememberProduct, searchProducts, baseLabel } from '../off.js';
import { confirmDialog } from './dialog.js';
import { openWasteDialog } from './waste-dialog.js';
import { stepper } from './stepper.js';
import { scanOnce } from '../scanner.js';
import { openPublishSheet } from './publish-sheet.js';
import { recallsFor } from '../recalls.js';
import { recallBlock } from './recall-dialog.js';
import { fetchOpenPrices, sortPrices, savedPosition, askPosition, fmtKm } from '../prices.js';
import { isOn } from '../modules.js';

const DLC_SHORTCUTS = [['Sans', null], ['+3 j', 3], ['+1 sem', 7], ['+1 mois', 30], ['+3 mois', 90], ['+6 mois', 180], ['+1 an', 365]];

/**
 * openProductSheet({ code, product, item, defaults, onClose })
 * - code seul : ajout après scan, recherche Open Food Facts lancée aussitôt.
 * - item : modification.
 * - defaults : pré-remplissage (depuis les courses ou « À racheter »).
 * onClose(ligneEnregistrée | null).
 */
export function openProductSheet({ code = null, product = null, item = null, defaults = {}, onClose } = {}) {
  const state = getState();
  const editing = !!item;
  const touched = new Set();
  let saved = null;
  let closed = false;
  let currentProduct = product || (code ? state.stock.products[code] || null : null) || (item && item.code ? state.stock.products[item.code] || null : null);

  const d = {
    code: (item && item.code) || code || (currentProduct && currentProduct.code) || null,
    nom: item ? item.nom : defaults.nom ?? (currentProduct && currentProduct.nom) ?? '',
    marque: item ? item.marque : defaults.marque ?? (currentProduct && currentProduct.marque) ?? '',
    conditionnement: item ? item.conditionnement : defaults.conditionnement ?? (currentProduct && currentProduct.conditionnement) ?? '',
    qte: item ? item.qte : defaults.qte ?? 1,
    unite: item ? item.unite : defaults.unite ?? 'piece',
    categorie: item ? item.categorie : defaults.categorie ?? (currentProduct && currentProduct.categorie) ?? 'Autre',
    emplacement: item ? item.emplacement : defaults.emplacement ?? (currentProduct && currentProduct.emplacement) ?? 'placard',
    dlc: null, ddm: item ? !!item.ddm : defaults.ddm !== undefined ? !!defaults.ddm : null,
    prix: item ? item.prix : defaults.prix ?? null,
    seuilMin: item ? item.seuilMin || 0 : defaults.seuilMin ?? 0,
    notes: item ? item.notes || '' : '',
    magasin: item ? item.magasin || '' : defaults.magasin ?? '',
    portions: item ? item.portions ?? null : null,
    image: item ? item.image : defaults.image ?? (currentProduct && currentProduct.image) ?? null,
  };
  const existing = !editing && d.code ? state.stock.items.filter((x) => x.code === d.code) : [];
  if (!editing && defaults.emplacement === undefined && existing.length) d.emplacement = existing[0].emplacement;
  d.dlc = item ? item.dlc : defaults.dlc !== undefined ? defaults.dlc : defaultDlc(d.emplacement);
  if (d.ddm === null) d.ddm = defaultDdm(d.categorie, d.emplacement);
  if (defaults.ddm !== undefined) touched.add('ddm');

  /* ---- Champs ---- */
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const thumb = h('span', { class: 'product-thumb' });
  function drawThumb() {
    if (d.image) {
      const img = h('img', { src: d.image, alt: '', loading: 'lazy', onerror: () => { d.image = null; drawThumb(); } });
      thumb.replaceChildren(img);
    } else thumb.replaceChildren(icon('box'));
  }
  drawThumb();
  const nomInput = h('input', { type: 'text', id: 'pr-nom', class: 'input', value: d.nom, placeholder: 'Ex. Yaourts nature', maxlength: '80', autocomplete: 'off', oninput: () => touched.add('nom') });
  const marqueInput = h('input', { type: 'text', id: 'pr-marque', class: 'input', value: d.marque, placeholder: 'Marque', maxlength: '60', autocomplete: 'off', oninput: () => touched.add('marque') });
  const condInput = h('input', { type: 'text', id: 'pr-cond', class: 'input', value: d.conditionnement, placeholder: 'Ex. 4 × 125 g', maxlength: '40', autocomplete: 'off', oninput: () => touched.add('conditionnement') });
  const lookupLine = h('p', { class: 'muted small lookup-line', hidden: true });
  // Sans code-barres : le nom tapé est cherché dans Open Food Facts, les correspondances s'affichent sous le champ.
  const suggestBox = h('ul', { class: 'off-suggest', hidden: true, role: 'listbox', 'aria-label': 'Produits Open Food Facts' });
  let suggestTimer = null, suggestSeq = 0;
  function hideSuggest() { suggestBox.hidden = true; suggestBox.replaceChildren(); }
  function scheduleSuggest() {
    clearTimeout(suggestTimer);
    if (d.code || !navigator.onLine) return hideSuggest();
    const q = nomInput.value.trim();
    if (q.length < 3) return hideSuggest();
    suggestTimer = setTimeout(async () => {
      const seq = ++suggestSeq;
      // Chargement visible tout de suite : la recherche interroge quatre bases et peut prendre quelques secondes.
      suggestBox.replaceChildren(h('li', { class: 'off-suggest-head muted small off-suggest-loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), `Recherche de « ${q} » dans Open Food Facts, Open Products Facts, Open Beauty Facts…`));
      suggestBox.hidden = false;
      // Affichage progressif : chaque base qui répond alimente la liste, l'indicateur reste tant qu'il en manque.
      const render = (found, pending) => {
        if (closed || seq !== suggestSeq) return;
        if (nomInput.value.trim() !== q) return hideSuggest();
        const rows = found.length ? [
          h('li', { class: 'off-suggest-head muted small' }, `${found.length} produit${found.length > 1 ? 's' : ''} trouvé${found.length > 1 ? 's' : ''} :`),
          ...found.map((p) => h('li', { role: 'option' }, h('button', { type: 'button', class: 'off-suggest-item', onclick: () => pickSuggestion(p) },
            p.image ? h('img', { src: p.image, alt: '', loading: 'lazy', onerror: (ev) => ev.target.replaceWith(icon('box')) }) : icon('box'),
            h('span', { class: 'off-suggest-text' }, h('strong', null, p.nom), h('span', { class: 'muted small block' }, [p.marque, p.quantite, p.base && p.base !== 'off' ? baseLabel(p.base) : null].filter(Boolean).join(' · ') || 'marque inconnue')),
            p.nutriscore ? h('span', { class: `score-mini score-${p.nutriscore}` }, p.nutriscore.toUpperCase()) : null))),
        ] : [];
        if (pending > 0) rows.push(h('li', { class: 'off-suggest-head muted small off-suggest-loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), found.length ? `Encore ${pending} base${pending > 1 ? 's' : ''} en cours…` : `Recherche de « ${q} » dans Open Food Facts, Open Products Facts, Open Beauty Facts…`));
        else if (!found.length) rows.push(h('li', { class: 'off-suggest-head muted small' }, searchProducts.limited ? 'Trop de recherches d’un coup : réessaie dans une minute.' : `Aucun produit « ${q} » dans les bases Open Facts. Tu peux continuer à la main.`));
        else if ((searchProducts.failed || []).length) rows.push(h('li', { class: 'off-suggest-head muted small' }, `Résultats partiels : ${searchProducts.failed.join(', ')} n’a pas répondu${searchProducts.limited ? ' (trop de recherches en une minute)' : ''}. Réessaie dans un instant.`));
        suggestBox.replaceChildren(...rows);
        suggestBox.hidden = false;
      };
      const found = await searchProducts(q, render);
      if (closed || seq !== suggestSeq || found === null) return;
      render(found, 0);
    }, 650);
  }
  function pickSuggestion(p) {
    hideSuggest();
    d.code = p.code; d.nom = p.nom; nomInput.value = p.nom; touched.add('nom');
    if (p.marque) { d.marque = p.marque; marqueInput.value = p.marque; }
    if (p.quantite && !condInput.value.trim()) { d.conditionnement = p.quantite; condInput.value = p.quantite; }
    if (p.image) { d.image = p.image; drawThumb(); }
    codeLine.replaceChildren(`Code-barres : ${p.code}`);
    doLookup();
  }
  nomInput.addEventListener('input', scheduleSuggest);
  nomInput.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !suggestBox.hidden) { ev.preventDefault(); hideSuggest(); } });

  const uniteSelect = h('select', { id: 'pr-unite', class: 'input', value: d.unite, 'aria-label': 'Unité', onchange: (ev) => { d.unite = ev.target.value; qty.setStep(uniteById(d.unite).step); } },
    UNITES.map((u) => h('option', { value: u.id }, u.label)));
  const qty = stepper({ value: d.qte, step: uniteById(d.unite).step, min: 0, label: 'Quantité', onChange: (v) => { d.qte = v; } });

  const dateInput = h('input', { type: 'date', id: 'pr-dlc', class: 'input', value: d.dlc || '', onchange: (ev) => { d.dlc = ev.target.value || null; touched.add('dlc'); } });
  const dlcChips = h('div', { class: 'chips chips-sm', role: 'group', 'aria-label': 'Raccourcis de date' }, DLC_SHORTCUTS.map(([label, days]) =>
    h('button', { type: 'button', class: 'chip chip-sm', onclick: () => { d.dlc = days == null ? null : addDays(todayISO(), days); dateInput.value = d.dlc || ''; touched.add('dlc'); } }, label)));
  const typeHint = h('p', { class: 'muted small' });
  const typeSeg = h('div', { class: 'segmented seg-sm', role: 'radiogroup', 'aria-label': 'Type de date' });
  function drawType() {
    typeSeg.replaceChildren(...DATE_TYPES.map((t) => h('label', { class: 'seg', title: t.long },
      h('input', { type: 'radio', name: 'pr-type', value: t.id, checked: (t.id === 'ddm') === d.ddm, onchange: () => { d.ddm = t.id === 'ddm'; touched.add('ddm'); drawType(); } }),
      h('span', null, t.label))));
    typeHint.textContent = (d.ddm ? DATE_TYPES[1] : DATE_TYPES[0]).hint;
  }
  drawType();
  /** Le type de date suit la catégorie et l'emplacement tant que l'utilisateur ne l'a pas choisi lui-même. */
  function suggestType() {
    if (editing || touched.has('ddm')) return;
    d.ddm = defaultDdm(d.categorie, d.emplacement);
    drawType();
  }

  const empChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Emplacement' });
  function drawEmp() {
    empChips.replaceChildren(...EMPLACEMENTS.map((e) => h('button', { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(e.id === d.emplacement), style: { '--chip': 'var(--green)' },
      onclick: () => {
        d.emplacement = e.id; touched.add('emplacement'); drawEmp();
        if (!editing && !touched.has('dlc')) { d.dlc = defaultDlc(e.id); dateInput.value = d.dlc || ''; }
        suggestType();
      } }, e.nom)));
  }
  drawEmp();

  const catSelect = h('select', { id: 'pr-cat', class: 'input', value: d.categorie, onchange: (ev) => { d.categorie = ev.target.value; touched.add('categorie'); suggestType(); } }, CATEGORIES.map((c) => h('option', { value: c }, c)));
  const prixInput = h('input', { type: 'text', id: 'pr-prix', class: 'input', inputmode: 'decimal', placeholder: '0,00', value: d.prix != null ? String(d.prix).replace('.', ',') : '' });
  const seuilInput = h('input', { type: 'number', id: 'pr-seuil', class: 'input', inputmode: 'decimal', min: '0', step: '1', value: d.seuilMin ? String(d.seuilMin) : '' });
  const notesInput = h('textarea', { id: 'pr-notes', class: 'input', rows: '2', placeholder: 'Ex. entamé, pour la recette de samedi…' }, d.notes);
  const magasinInput = h('input', { type: 'text', id: 'pr-magasin', class: 'input', list: 'pr-stores', placeholder: 'Ex. Lidl', maxlength: '40', value: d.magasin || '', autocomplete: 'off' });
  const storesList = h('datalist', { id: 'pr-stores' }, knownStores(state).map((s2) => h('option', { value: s2 })));
  const portionsInput = h('input', { type: 'number', id: 'pr-portions', class: 'input', inputmode: 'decimal', min: '0', step: '1', placeholder: 'Ex. 4', value: d.portions != null ? String(d.portions) : '' });
  const insightLine = h('p', { class: 'muted small price-insight', hidden: true });
  function drawInsight() {
    const ins = isOn('prixHistorique') ? priceInsight(getState(), { code: d.code, nom: nomInput.value.trim() || d.nom }) : null;
    insightLine.hidden = !ins;
    if (!ins) return;
    const parts = [`Dernier prix : ${money(ins.last.prix)}${ins.last.magasin ? ` chez ${ins.last.magasin}` : ''} le ${fmtDate(ins.last.date, { day: 'numeric', month: 'short' })}`];
    if (ins.delta != null && Math.abs(ins.delta) >= 0.02) parts.push(`${ins.delta > 0 ? 'plus cher' : 'moins cher'} que la fois d’avant (${ins.delta > 0 ? '+' : ''}${Math.round(ins.delta * 100)} %)`);
    if (ins.stores.length > 1) parts.push(`le moins cher : ${ins.stores[0].magasin} à ${money(ins.stores[0].prix)}`);
    insightLine.textContent = `${parts.join(' · ')}.`;
  }
  drawInsight();
  nomInput.addEventListener('input', drawInsight);
  const allergenLine = h('p', { class: 'allergen-line', hidden: true });
  function drawAllergens() {
    const conflicts = isOn('allergenes') ? allergenConflicts(getState(), currentProduct) : [];
    allergenLine.hidden = !conflicts.length;
    if (conflicts.length) allergenLine.replaceChildren(h('span', { class: 'tag-allergene' }, icon('alert'), `Contient : ${conflicts.join(', ')}`), ' ', h('span', { class: 'muted small' }, 'allergène déclaré dans ton foyer.'));
  }
  drawAllergens();
  const prixLabelEl = h('label', { for: 'pr-prix' }, prixLabel(d.unite));
  const prixHint = h('p', { class: 'muted small' });
  /* ---- Prix relevés par d'autres (Open Prices), triés par distance ---- */
  const pricesBox = h('div', { class: 'open-prices', hidden: true });
  let openPrices = null, pricesCode = null;
  async function loadOpenPrices() {
    if (!d.code || !isOn('prixOpen') || pricesCode === d.code) return;
    pricesCode = d.code;
    pricesBox.hidden = false;
    pricesBox.replaceChildren(h('p', { class: 'muted small' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Prix relevés en magasin (Open Prices)…'));
    try { openPrices = await fetchOpenPrices(d.code); }
    catch { if (!closed) pricesBox.hidden = true; return; }
    if (!closed && pricesCode === d.code) drawOpenPrices();
  }
  function drawOpenPrices() {
    if (!openPrices || !openPrices.length) { pricesBox.replaceChildren(h('p', { class: 'muted small' }, 'Aucun prix relevé pour ce produit sur Open Prices.')); return; }
    const pos = savedPosition();
    const sorted = sortPrices(openPrices, pos).slice(0, 6);
    const near = h('button', { type: 'button', class: 'link small', onclick: async () => { try { await askPosition(); drawOpenPrices(); } catch (e) { toast(e.message); } } }, icon('pin'), pos ? 'Actualiser ma position' : 'Trier par distance');
    pricesBox.replaceChildren(
      h('p', { class: 'muted small open-prices-head' }, `${openPrices.length} prix relevé${openPrices.length > 1 ? 's' : ''} en magasin (Open Prices)${pos ? ', du plus proche au plus loin' : ', les plus récents'} · `, near),
      h('div', { class: 'chips chips-sm' }, sorted.map((p) => h('button', { type: 'button', class: 'chip chip-sm chip-price', title: `Relevé le ${fmtDate(p.date, { day: 'numeric', month: 'long', year: 'numeric' })}`, onclick: () => {
        d.prix = p.prix; prixInput.value = String(p.prix).replace('.', ',');
        if (isOn('prixHistorique')) { d.magasin = p.magasin; magasinInput.value = p.magasin; }
        drawPrixHint(); toast(`${money(p.prix)} chez ${p.magasin}`);
      } }, h('strong', { class: 'num' }, money(p.prix)), ` ${p.magasin}${p.ville ? `, ${p.ville}` : ''}`, h('span', { class: 'muted' }, p.km != null ? ` · ${fmtKm(p.km)}` : ` · ${fmtDate(p.date, { month: 'short', year: '2-digit' })}`)))));
  }
  function drawPrixHint() {
    const p = prixInput.value.trim() ? parseAmount(prixInput.value) : null;
    const v = p != null && !Number.isNaN(p) ? valueOf(p, qty.get(), uniteSelect.value) : null;
    prixHint.textContent = v != null ? `Valeur de la ligne : ${money(v)}. Sert à chiffrer le gaspillage si le produit est jeté.` : 'Facultatif : permet de compter les euros gaspillés si le produit finit à la poubelle.';
  }
  uniteSelect.addEventListener('change', () => { prixLabelEl.textContent = prixLabel(uniteSelect.value); drawPrixHint(); });
  prixInput.addEventListener('input', drawPrixHint);
  qty.addEventListener('click', drawPrixHint);
  drawPrixHint();

  const details = h('div', { class: 'product-details' });
  function drawDetails() {
    const p = currentProduct;
    details.replaceChildren();
    if (!p || p.source === 'manuel') return;
    const scores = [];
    if (p.nutriscore) scores.push(h('span', { class: `score score-${p.nutriscore}` }, 'Nutri-Score ', h('strong', null, p.nutriscore.toUpperCase())));
    if (p.nova) scores.push(h('span', { class: `score nova-${p.nova}` }, 'NOVA ', h('strong', null, String(p.nova))));
    if (p.ecoscore) scores.push(h('span', { class: `score score-${p.ecoscore}` }, 'Éco-Score ', h('strong', null, p.ecoscore.toUpperCase())));
    const n = p.nutriments;
    const nut = n ? [['Énergie', n.kcal, 'kcal'], ['Lipides', n.lipides, 'g'], ['dont saturés', n.satures, 'g'], ['Glucides', n.glucides, 'g'], ['dont sucres', n.sucres, 'g'], ['Fibres', n.fibres, 'g'], ['Protéines', n.proteines, 'g'], ['Sel', n.sel, 'g']].filter((r) => r[1] != null) : [];
    if (!isOn('nutriscore')) scores.length = 0;
    if (!scores.length && !p.allergenes.length && !p.ingredients && !nut.length) return;
    details.append(h('details', { class: 'zone' },
      h('summary', { class: 'zone-title' }, 'Infos produit (Open Food Facts)'),
      h('div', { class: 'zone-body' },
        scores.length ? h('div', { class: 'scores' }, scores) : null,
        p.labels && p.labels.length ? h('p', { class: 'muted small' }, `Labels : ${p.labels.join(', ')}`) : null,
        p.allergenes.length ? h('p', null, h('strong', null, 'Allergènes : '), p.allergenes.join(', ')) : null,
        nut.length ? h('dl', { class: 'nutri-grid', 'aria-label': 'Valeurs pour 100 g' }, nut.map(([k, v, u]) => [h('dt', null, k), h('dd', { class: 'num' }, `${String(v).replace('.', ',')} ${u}`)])) : null,
        nut.length ? h('p', { class: 'muted small' }, 'Valeurs pour 100 g ou 100 ml.') : null,
        p.ingredients ? h('p', { class: 'small' }, h('strong', null, 'Ingrédients : '), p.ingredients) : null)));
  }
  drawDetails();

  const existingLine = existing.length
    ? h('p', { class: 'summary small' }, 'Déjà en stock : ', existing.map((x, i) => [i ? ', ' : '', h('span', { class: 'num' }, fmtQte(x)), ` (${emplacementById(x.emplacement).nom.toLowerCase()})`]), '. Même emplacement et même date : les quantités s’additionnent.')
    : null;

  /* ---- Recherche Open Food Facts ---- */
  function applyProduct(p) {
    if (!touched.has('nom') && !nomInput.value.trim() && p.nom) { d.nom = p.nom; nomInput.value = p.nom; }
    if (!touched.has('marque') && !marqueInput.value.trim() && p.marque) { d.marque = p.marque; marqueInput.value = p.marque; }
    if (!touched.has('conditionnement') && !condInput.value.trim() && p.conditionnement) { d.conditionnement = p.conditionnement; condInput.value = p.conditionnement; }
    if (!d.image && p.image) { d.image = p.image; drawThumb(); }
    if (!touched.has('categorie') && p.categorie) { d.categorie = p.categorie; catSelect.value = p.categorie; }
    if (!editing && !touched.has('emplacement') && !existing.length && p.emplacement) {
      d.emplacement = p.emplacement; drawEmp();
      if (!touched.has('dlc')) { d.dlc = defaultDlc(p.emplacement); dateInput.value = d.dlc || ''; }
    }
    suggestType();
  }
  async function doLookup(force = false) {
    if (!d.code) return;
    loadOpenPrices();
    lookupLine.hidden = false;
    lookupLine.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Recherche du code-barres dans les bases Open Facts (alimentation, ménager, hygiène, animaux)…');
    const res = await lookupProduct(d.code, { force });
    if (closed) return;
    if (res.product) {
      currentProduct = res.product;
      applyProduct(res.product);
      drawDetails();
      drawAllergens();
      lookupLine.replaceChildren(res.source === 'cache' ? 'Produit déjà connu.' : `Trouvé sur ${baseLabel(res.product.base)}.`, ' ', h('button', { type: 'button', class: 'link small', onclick: () => doLookup(true) }, 'Actualiser'));
    } else if (res.notFound) {
      lookupLine.replaceChildren('Code inconnu des bases Open Facts (alimentation, ménager, hygiène, animaux) : donne-lui un nom, il sera mémorisé pour la prochaine fois.');
      nomInput.focus();
    } else {
      lookupLine.replaceChildren('Pas de connexion : saisis le nom, ou ', h('button', { type: 'button', class: 'link small', onclick: () => doLookup(true) }, 'réessayer'), '.');
    }
  }
  if (d.code && !currentProduct) doLookup();
  else if (d.code) loadOpenPrices();

  async function attachCode() {
    const c = await scanOnce('Associer un code-barres');
    if (!c || closed) return;
    d.code = c;
    codeLine.replaceChildren(`Code-barres : ${c}`);
    doLookup();
  }
  const codeLine = h('p', { class: 'muted small' }, d.code ? `Code-barres : ${d.code}` : h('button', { type: 'button', class: 'link small', onclick: attachCode }, icon('camera'), 'Associer un code-barres'));

  /* ---- Actions ---- */
  function readForm() {
    d.nom = nomInput.value.trim();
    d.marque = marqueInput.value.trim();
    d.conditionnement = condInput.value.trim();
    d.qte = qty.get();
    d.unite = uniteSelect.value;
    d.dlc = dateInput.value || null;
    d.categorie = catSelect.value;
    d.notes = notesInput.value.trim();
    d.seuilMin = Math.max(0, parseFloat(String(seuilInput.value).replace(',', '.')) || 0);
    d.magasin = magasinInput.value.trim();
    d.portions = portionsInput.value.trim() ? Math.max(0, parseFloat(String(portionsInput.value).replace(',', '.')) || 0) : null;
    const p = prixInput.value.trim();
    d.prix = p ? parseAmount(p) : null;
    if (!d.nom) return fail('Donne un nom au produit.', nomInput);
    if (!(d.qte > 0)) return fail('La quantité doit être supérieure à zéro.');
    if (p && Number.isNaN(d.prix)) return fail('Le prix doit être un nombre, par exemple 2,50.', prixInput);
    return true;
  }
  function fail(msg, focusEl) { err.textContent = msg; err.hidden = false; if (focusEl) focusEl.focus(); return false; }

  function save() {
    if (!readForm()) return;
    if (editing) {
      update((s) => {
        const it = s.stock.items.find((x) => x.id === item.id);
        if (!it) return;
        Object.assign(it, { nom: d.nom, marque: d.marque, conditionnement: d.conditionnement, qte: d.qte, unite: d.unite, emplacement: d.emplacement, categorie: d.categorie, dlc: d.dlc, ddm: d.ddm, prix: d.prix, seuilMin: d.seuilMin, notes: d.notes, image: d.image, code: d.code, magasin: d.magasin || null, portions: d.portions });
        saved = it;
      });
      toast('Article modifié');
    } else {
      update((s) => { saved = addStockItem(s, d); });
      toast(`Ajouté : ${d.nom} (${emplacementById(d.emplacement).nom.toLowerCase()})`);
    }
    if (d.code && (!currentProduct || currentProduct.nom !== d.nom || currentProduct.marque !== d.marque)) {
      rememberProduct(d.code, { nom: d.nom, marque: d.marque, conditionnement: d.conditionnement, categorie: d.categorie, emplacement: d.emplacement, image: d.image });
    }
    dlg.close();
  }

  async function remove() {
    const ok = await confirmDialog({ title: `Retirer « ${item.nom} » ?`, message: 'La ligne disparaît du stock sans passer par le journal anti-gaspi.', confirmLabel: 'Retirer du stock', danger: true });
    if (!ok) return;
    update((s) => removeStockItem(s, item.id, 'retrait'));
    toast('Article retiré du stock');
    dlg.close();
  }
  function quick(type) {
    const step = uniteById(item.unite).step;
    if (type === 'jete') {
      openWasteDialog(item).then((res) => {
        if (!res.ok) return;
        update((s) => removeStockItem(s, item.id, 'jete', { prix: res.prix }));
        const v = valueOf(res.prix, item.qte, item.unite);
        toast(v != null ? `${item.nom} : jeté, ${money(v)} gaspillés` : `${item.nom} : jeté`);
        dlg.close();
      });
      return;
    }
    update((s) => adjustStockQty(s, item.id, -step, 'conso'));
    toast(item.qte - step <= 0 ? `${item.nom} : terminé` : `${item.nom} : −${step}`);
    dlg.close();
  }
  function toggleOpen() {
    update((s) => { const it = s.stock.items.find((x) => x.id === item.id); if (it) it.ouvertLe = it.ouvertLe ? null : todayISO(); });
    toast('Article mis à jour');
    dlg.close();
  }
  function toBuy() {
    update((s) => addARacheter(s, { nom: nomInput.value.trim() || item.nom, code: d.code, qte: 1, unite: d.unite }));
    toast('Ajouté à la liste « À racheter »');
  }

  /** Envoie le produit dans le fil (image, marque, quantité, emplacement, date, Nutri-Score). */
  const publish = () => openPublishSheet({ type: 'produit', texte: `partage un produit : ${d.nom || item.nom}`, apercu: d.nom || item.nom, payload: { nom: d.nom || item.nom, marque: d.marque || '', image: d.image || null, code: d.code || null, qte: d.qte, unite: d.unite, emplacement: d.emplacement, dlc: d.dlc || null, ddm: !!d.ddm, categorie: d.categorie, nutriscore: (currentProduct && currentProduct.nutriscore) || null, prix: d.prix ?? null, magasin: d.magasin || '' } });

  /* ---- Assemblage ---- */
  const dlg = h('dialog', { class: 'sheet sheet-product', 'aria-labelledby': 'product-title' },
    h('header', { class: 'sheet-head' },
      h('h2', { id: 'product-title', class: 'sheet-title' }, editing ? 'Modifier l’article' : 'Ajouter au stock'),
      h('span', { class: 'sheet-head-tools' },
        editing && isOn('foyer') ? h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Publier ce produit dans le fil', title: 'Publier dans le fil', onclick: publish }, icon('share')) : null,
        h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer', onclick: () => dlg.close() }, icon('x')))),
    h('div', { class: 'sheet-body' },
      ...(editing && isOn('rappels') ? recallsFor(d.code).map((r) => recallBlock(r)) : []),
      h('div', { class: 'product-head' }, thumb,
        h('div', { class: 'product-fields' },
          h('div', { class: 'field' }, h('label', { for: 'pr-nom' }, 'Produit'), nomInput, suggestBox),
          h('div', { class: 'field-row' },
            h('div', { class: 'field' }, h('label', { for: 'pr-marque' }, 'Marque'), marqueInput),
            h('div', { class: 'field' }, h('label', { for: 'pr-cond' }, 'Conditionnement'), condInput)))),
      lookupLine,
      allergenLine,
      codeLine,
      existingLine,
      h('div', { class: 'field' }, h('label', { for: 'pr-unite' }, 'Quantité'), h('div', { class: 'qty-row' }, qty, uniteSelect)),
      h('div', { class: 'field-row' }, h('div', { class: 'field' }, prixLabelEl, prixInput), isOn('prixHistorique') ? h('div', { class: 'field' }, h('label', { for: 'pr-magasin' }, 'Magasin'), magasinInput, storesList) : null),
      prixHint,
      insightLine,
      pricesBox,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Emplacement'), empChips),
      h('div', { class: 'field' }, h('label', { for: 'pr-dlc' }, 'Date limite'), h('div', { class: 'qty-row' }, dateInput, typeSeg), dlcChips, typeHint),
      editing ? h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => quick('conso') }, icon('check'), 'Consommé'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => quick('jete') }, icon('trash'), 'Jeté'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: toggleOpen }, item.ouvertLe ? `Ouvert le ${fmtDate(item.ouvertLe, { day: 'numeric', month: 'short' })}` : 'Ouvert aujourd’hui'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: toBuy }, icon('basket'), 'À racheter'),
        isOn('etiquettesQR') ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => printLabels([item]).catch((e) => toast(e.message)) }, icon('image'), 'Étiquette QR') : null,
        isOn('foyer') ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: publish }, icon('share'), 'Publier') : null) : null,
      h('details', { class: 'zone', open: editing && (d.seuilMin > 0 || !!d.notes) },
        h('summary', { class: 'zone-title' }, 'Plus d’options'),
        h('div', { class: 'zone-body' },
          h('div', { class: 'field-row' },
            h('div', { class: 'field' }, h('label', { for: 'pr-cat' }, 'Catégorie'), catSelect),
            h('div', { class: 'field' }, h('label', { for: 'pr-seuil' }, 'Stock minimum'), seuilInput)),
          h('p', { class: 'muted small' }, 'Sous le stock minimum, le produit passe tout seul dans « À racheter ».'),
          isOn('portions') ? h('div', { class: 'field' }, h('label', { for: 'pr-portions' }, 'Portions restantes (produit entamé)'), portionsInput) : null,
          h('div', { class: 'field' }, h('label', { for: 'pr-notes' }, 'Notes'), notesInput))),
      details,
      err),
    h('footer', { class: 'sheet-foot' },
      editing ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: remove }, icon('trash'), 'Retirer') : null,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, editing ? 'Enregistrer' : 'Ajouter au stock')),
  );
  dlg.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('input:not([type=date])')) { ev.preventDefault(); save(); } });
  dlg.addEventListener('close', () => { closed = true; dlg.remove(); onClose?.(saved); });
  document.body.append(dlg);
  dlg.showModal();
  if (!editing && !d.code && !d.nom) setTimeout(() => nomInput.focus(), 50);
  return dlg;
}
