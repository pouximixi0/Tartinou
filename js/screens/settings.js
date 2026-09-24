// Écran Réglages : budget, charges fixes (et récurrences détectées), catégories et objectifs,
// allergènes, stock, notifications, compte et foyer, sauvegarde (et relevé bancaire), thème, installation.
import { h, icon, money, uid, toast, todayISO, parseAmount, fmtDate } from '../utils.js';
import { getState, update, replaceState, resetState, exportJSON, checkBackup, syncStatus, onSync, flush, initStore, logout, refreshMe } from '../store.js';
import { api, setToken } from '../api.js';
import { enveloppeOf, cycleFor } from '../budget.js';
import { confirmDialog, openDialog } from '../components/dialog.js';
import { canInstall, promptInstall, onInstallable, isIOS, isStandalone } from '../install.js';
import { detectRecurring, parseBankCsv, matchBankRows, guessCategoryId } from '../finance.js';
import { pushSupported, isStandaloneIOS, currentSubscription, subscribeDevice, unsubscribeDevice } from '../push.js';

export const ALLERGENES = ['lait', 'gluten', 'œufs', 'fruits à coque', 'arachides', 'soja', 'poisson', 'crustacés', 'mollusques', 'céleri', 'moutarde', 'sésame', 'sulfites', 'lupin'];

export function renderSettings() {
  const state = getState();
  const s = state.settings;
  const root = h('section', { class: 'screen screen-settings' });

  /* ---- Budget ---- */
  const summary = h('p', { class: 'summary' });
  function refreshSummary() {
    const st = getState();
    const { enveloppe, charges } = enveloppeOf(st.settings);
    const cycle = cycleFor(todayISO(), st.settings.debutMois);
    summary.replaceChildren(
      'Enveloppe du cycle : ', h('strong', { class: 'num' }, money(enveloppe)),
      ` (revenu − ${money(charges)} de charges − ${money(st.settings.epargneVisee)} d’épargne), soit `,
      h('strong', { class: 'num' }, money(enveloppe / cycle.days)), ` par jour sur ${cycle.days} jours.`,
    );
  }
  const setNum = (key, min, max) => (ev) => {
    let v = parseAmount(ev.target.value);
    if (Number.isNaN(v)) v = 0;
    v = Math.min(max, Math.max(min, v));
    ev.target.value = String(v);
    update((st) => { st.settings[key] = v; }, { quiet: true });
    refreshSummary();
  };
  refreshSummary();
  root.append(zone('Budget',
    numField('s-revenu', 'Revenu mensuel (€)', s.revenuMensuel, setNum('revenuMensuel', 0, 1e7), { step: '10' }),
    h('div', { class: 'field-row' },
      numField('s-debut', 'Jour de début du cycle', s.debutMois, setNum('debutMois', 1, 31), { step: '1', max: '31', min: '1', mode: 'numeric' }),
      numField('s-epargne', 'Épargne visée par mois (€)', s.epargneVisee, setNum('epargneVisee', 0, 1e7), { step: '10' })),
    numField('s-part', 'Part des courses dans le budget (%)', s.partCourses, setNum('partCourses', 0, 100), { step: '5', max: '100', mode: 'numeric' }),
    summary,
    switchRow('Budget journalier strict', 'Affiche le maximum théorique du jour, sans report d’un jour sur l’autre.', s.budgetStrict, (v) => update((st) => { st.settings.budgetStrict = v; })),
  ));

  /* ---- Charges fixes + récurrences détectées ---- */
  const totalCharges = s.chargesFixes.reduce((a, c) => a + (Number(c.montant) || 0), 0);
  const cNom = h('input', { type: 'text', id: 'c-nom', class: 'input', placeholder: 'Ex. Loyer', maxlength: '40' });
  const cMontant = h('input', { type: 'text', id: 'c-montant', class: 'input', inputmode: 'decimal', placeholder: '0,00' });
  const cJour = h('input', { type: 'number', id: 'c-jour', class: 'input', inputmode: 'numeric', min: '1', max: '31', value: '1' });
  const cErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
  function addCharge() {
    const nom = cNom.value.trim();
    const montant = parseAmount(cMontant.value);
    const jour = Math.min(31, Math.max(1, Number(cJour.value) || 1));
    if (!nom) { cErr.textContent = 'Donne un nom à la charge (ex. Loyer).'; cErr.hidden = false; cNom.focus(); return; }
    if (!(montant > 0)) { cErr.textContent = 'Le montant doit être un nombre supérieur à zéro.'; cErr.hidden = false; cMontant.focus(); return; }
    update((st) => { st.settings.chargesFixes.push({ id: uid(), nom, montant, jourDuMois: jour }); });
    toast('Charge ajoutée');
  }
  const recurring = detectRecurring(state.expenses, s.chargesFixes);
  root.append(zone('Charges fixes',
    s.chargesFixes.length
      ? h('ul', { class: 'rows' }, s.chargesFixes.map((c) =>
          h('li', { class: 'row-item' },
            h('span', { class: 'row-text' }, c.nom, h('span', { class: 'muted small block' }, `le ${c.jourDuMois} du mois`)),
            h('span', { class: 'num' }, money(c.montant)),
            h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Supprimer ${c.nom}`, onclick: () => update((st) => { st.settings.chargesFixes = st.settings.chargesFixes.filter((x) => x.id !== c.id); }) }, icon('trash')))))
      : h('p', { class: 'muted' }, 'Aucune charge fixe. Ajoute ton loyer et tes abonnements : ils sont retirés de l’enveloppe mais ne comptent pas comme des dépenses.'),
    h('p', { class: 'summary' }, 'Total des charges : ', h('strong', { class: 'num' }, money(totalCharges))),
    recurring.length ? h('div', { class: 'suggestions' },
      h('p', { class: 'label' }, 'Dépenses qui reviennent chaque mois'),
      h('ul', { class: 'rows' }, recurring.slice(0, 5).map((r) =>
        h('li', { class: 'row-item' },
          h('span', { class: 'row-text' }, r.nom, h('span', { class: 'muted small block' }, `${money(r.montant)} · vu ${r.occurrences} mois, vers le ${r.jourDuMois}`)),
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: async () => {
            const ok = await confirmDialog({ title: `Passer « ${r.nom} » en charge fixe ?`, message: `${money(r.montant)} sera retiré de l’enveloppe chaque mois. Les ${r.ids.length} dépenses déjà saisies seront supprimées pour ne pas compter deux fois.`, confirmLabel: 'Créer la charge' });
            if (!ok) return;
            update((st) => { st.settings.chargesFixes.push({ id: uid(), nom: r.nom, montant: r.montant, jourDuMois: r.jourDuMois }); st.expenses = st.expenses.filter((e) => !r.ids.includes(e.id)); });
            toast('Charge fixe créée');
          } }, 'En charge fixe'))))) : null,
    h('div', { class: 'field' }, h('label', { for: 'c-nom' }, 'Nom'), cNom),
    h('div', { class: 'field-row' },
      h('div', { class: 'field' }, h('label', { for: 'c-montant' }, 'Montant (€)'), cMontant),
      h('div', { class: 'field' }, h('label', { for: 'c-jour' }, 'Jour du mois'), cJour)),
    cErr,
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: addCharge }, icon('plus'), 'Ajouter la charge'),
  ));

  /* ---- Catégories et objectifs ---- */
  async function deleteCategory(cat) {
    if (cat.id === 'autre') { toast('La catégorie Autre accueille les dépenses orphelines : elle ne peut pas être supprimée.'); return; }
    const n = state.expenses.filter((e) => e.categorieId === cat.id).length;
    const ok = await confirmDialog({ title: `Supprimer « ${cat.nom} » ?`, message: n ? `${n} dépense${n > 1 ? 's' : ''} passera${n > 1 ? 'ont' : ''} dans « Autre ».` : 'Aucune dépense n’utilise cette catégorie.', confirmLabel: 'Supprimer la catégorie', danger: true });
    if (!ok) return;
    update((st) => {
      st.categories = st.categories.filter((c) => c.id !== cat.id);
      st.expenses.forEach((e) => { if (e.categorieId === cat.id) e.categorieId = 'autre'; });
      delete st.settings.objectifs[cat.id];
      if (!st.categories.some((c) => c.id === 'autre')) st.categories.push({ id: 'autre', nom: 'Autre', couleur: '#64748B' });
    });
  }
  root.append(zone('Catégories et objectifs',
    h('p', { class: 'muted small' }, 'Un objectif par cycle et par catégorie : l’écran Dépenses passe en orange à 80 %, en rouge au-delà, et une notification te prévient.'),
    h('ul', { class: 'rows' }, state.categories.map((cat) =>
      h('li', { class: 'row-item row-cat' },
        h('input', { type: 'color', class: 'color', value: cat.couleur, 'aria-label': `Couleur de ${cat.nom}`, onchange: (ev) => update((st) => { st.categories.find((c) => c.id === cat.id).couleur = ev.target.value; }, { quiet: true }) }),
        h('input', { type: 'text', class: 'input', value: cat.nom, maxlength: '30', 'aria-label': 'Nom de la catégorie', onchange: (ev) => { const v = ev.target.value.trim() || cat.nom; ev.target.value = v; update((st) => { st.categories.find((c) => c.id === cat.id).nom = v; }, { quiet: true }); } }),
        h('input', { type: 'text', class: 'input input-objectif num', inputmode: 'decimal', placeholder: 'Objectif €', 'aria-label': `Objectif pour ${cat.nom}`, value: s.objectifs[cat.id] ? String(s.objectifs[cat.id]).replace('.', ',') : '',
          onchange: (ev) => { const v = parseAmount(ev.target.value); update((st) => { if (v > 0) st.settings.objectifs[cat.id] = v; else delete st.settings.objectifs[cat.id]; }, { quiet: true }); ev.target.value = v > 0 ? String(v).replace('.', ',') : ''; } }),
        h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Supprimer ${cat.nom}`, disabled: cat.id === 'autre', onclick: () => deleteCategory(cat) }, icon('trash'))))),
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => { update((st) => { st.categories.push({ id: uid(), nom: 'Nouvelle catégorie', couleur: '#64748B' }); }); setTimeout(() => { const inputs = document.querySelectorAll('.screen-settings .row-cat input[type=text]:not(.input-objectif)'); const last = inputs[inputs.length - 1]; last?.focus(); last?.select(); }, 0); } }, icon('plus'), 'Ajouter une catégorie'),
  ));

  /* ---- Allergènes ---- */
  const allChips = h('div', { class: 'chips' });
  function drawAllergenes() {
    const cur = getState().settings.allergenes;
    allChips.replaceChildren(...ALLERGENES.map((a) => h('button', { type: 'button', role: 'checkbox', class: 'chip', 'aria-checked': String(cur.includes(a)),
      onclick: () => { update((st) => { const set = new Set(st.settings.allergenes); if (set.has(a)) set.delete(a); else set.add(a); st.settings.allergenes = [...set]; }, { quiet: true }); drawAllergenes(); } }, a)));
  }
  drawAllergenes();
  root.append(zone('Allergènes du foyer',
    h('p', { class: 'muted small' }, 'Les produits scannés qui contiennent l’un de ces allergènes sont signalés en rouge dans le stock et sur la fiche produit.'),
    allChips,
  ));

  /* ---- Stock ---- */
  const nProducts = Object.keys(state.stock.products).length;
  const setStock = (k, v) => update((st) => { st.settings.stock[k] = v; }, { quiet: true });
  root.append(zone('Stock alimentaire',
    numField('s-alert', 'Alerte avant la date limite (jours)', s.stock.alertDays, (ev) => { const v = Math.min(30, Math.max(0, Number(ev.target.value) || 0)); ev.target.value = String(v); update((st) => { st.settings.stock.alertDays = v; }); }, { step: '1', max: '30', mode: 'numeric' }),
    switchRow('Scan en continu', 'Après un ajout, la caméra reste ouverte pour le produit suivant.', s.stock.scanContinu, (v) => setStock('scanContinu', v)),
    switchRow('Vibration au scan', '', s.stock.vibration, (v) => setStock('vibration', v)),
    switchRow('Bip au scan', '', s.stock.son, (v) => setStock('son', v)),
    h('p', { class: 'muted small' }, nProducts ? `${nProducts} produit${nProducts > 1 ? 's' : ''} mémorisé${nProducts > 1 ? 's' : ''} depuis Open Food Facts, utilisable${nProducts > 1 ? 's' : ''} hors ligne.` : 'Les produits scannés sont mémorisés pour fonctionner hors ligne.'),
    nProducts ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: async () => {
      const ok = await confirmDialog({ title: 'Vider le cache produits ?', message: 'Les produits seront recherchés à nouveau au prochain scan. Ton stock n’est pas touché.', confirmLabel: 'Vider le cache' });
      if (ok) { update((st) => { st.stock.products = {}; }); toast('Cache produits vidé'); }
    } }, 'Vider le cache produits') : null,
  ));

  /* ---- Notifications ---- */
  root.append(notificationsZone(state));

  /* ---- Compte et foyer ---- */
  root.append(accountZone());

  /* ---- Sauvegarde et relevé bancaire ---- */
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'import-file', onchange: importBackup });
  async function importBackup(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch (err) { toast(`Fichier illisible : ${err.message}`); ev.target.value = ''; return; }
    const problem = checkBackup(obj);
    if (problem) { toast(problem); ev.target.value = ''; return; }
    const ok = await confirmDialog({ title: 'Remplacer toutes les données ?', message: `La sauvegarde contient ${obj.expenses.length} dépense${obj.expenses.length > 1 ? 's' : ''}. Tout ce qui est dans le foyer sera remplacé.`, confirmLabel: 'Remplacer mes données', danger: true });
    ev.target.value = '';
    if (!ok) return;
    replaceState(obj);
    toast('Sauvegarde importée');
  }
  function exportBackup() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `tartinou-${todayISO()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Fichier de sauvegarde téléchargé');
  }
  const csvInput = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', class: 'visually-hidden', id: 'import-csv', onchange: async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) openBankImport(await f.text()); } });
  async function eraseAll() {
    const one = await confirmDialog({ title: 'Effacer toutes les données ?', message: 'Dépenses, menus, stock, réglages : tout sera supprimé pour tout le foyer, sur le serveur aussi.', confirmLabel: 'Continuer', danger: true });
    if (!one) return;
    const two = await confirmDialog({ title: 'Dernière confirmation', message: 'Cette action est définitive. Exporte une sauvegarde avant si besoin.', confirmLabel: 'Effacer définitivement', danger: true });
    if (!two) return;
    resetState();
    location.hash = '#aujourdhui';
  }
  root.append(zone('Sauvegarde et relevés',
    h('p', { class: 'muted small' }, 'Le fichier exporté contient tout : dépenses, menus, stock, recettes et réglages. Une sauvegarde importée remplace la base du foyer.'),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: exportBackup }, icon('download'), 'Exporter mes données'),
      fileInput,
      h('label', { for: 'import-file', class: 'btn btn-secondary' }, 'Importer une sauvegarde')),
    h('p', { class: 'muted small' }, 'Relevé bancaire : importe le CSV de ta banque pour retrouver les dépenses oubliées. Chaque ligne est rapprochée d’une dépense saisie (même montant, à trois jours près) ; les autres te sont proposées.'),
    csvInput,
    h('label', { for: 'import-csv', class: 'btn btn-secondary btn-block' }, icon('list'), 'Importer un relevé CSV'),
    h('button', { type: 'button', class: 'btn btn-danger-outline btn-block', onclick: eraseAll }, 'Effacer toutes les données'),
  ));

  /* ---- Thème ---- */
  root.append(zone('Thème',
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Thème' },
      [['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']].map(([val, label]) =>
        h('label', { class: 'seg' },
          h('input', { type: 'radio', name: 'theme', value: val, checked: s.theme === val, onchange: () => update((st) => { st.settings.theme = val; }) }),
          h('span', null, label))))));

  /* ---- Installation ---- */
  const installBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', hidden: !canInstall(), onclick: async () => { if (await promptInstall()) toast('Tartinou est installée'); } }, 'Installer l’app');
  onInstallable((yes) => { installBtn.hidden = !yes; });
  root.append(zone('Application',
    isStandalone() ? h('p', { class: 'muted' }, 'Tartinou est installée sur cet appareil.') : null,
    installBtn,
    !isStandalone() && isIOS() ? h('p', { class: 'muted small' }, 'Sur iPhone : bouton Partager, puis « Sur l’écran d’accueil ».') : null,
    !isStandalone() && !isIOS() && !canInstall() ? h('p', { class: 'muted small', id: 'install-hint' }, 'Le bouton d’installation apparaît quand le navigateur le propose (Chrome, Edge). Sinon : menu du navigateur, « Installer l’application ».') : null,
    h('p', { class: 'muted small' }, 'Tartinou v2.3 · base de données par foyer sur le serveur, copie locale sous la clé foyer:v2.'),
  ));
  return root;
}

/* ---------- Notifications ---------- */
function notificationsZone(state) {
  const n = state.settings.notifs;
  const setN = (k, v) => update((st) => { st.settings.notifs[k] = v; }, { quiet: true });
  const status = h('p', { class: 'summary small' });
  const toggle = h('input', { type: 'checkbox', role: 'switch', disabled: true, onchange: onToggle });
  const testBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', hidden: true, onclick: async () => { try { const r = await api('POST', '/push/test'); toast(r.envoyees ? `Notification envoyée à ${r.envoyees} appareil${r.envoyees > 1 ? 's' : ''}` : 'Aucun appareil abonné'); } catch (e) { toast(e.message); } } }, 'Envoyer un test');
  const devices = h('p', { class: 'muted small' });
  async function draw() {
    const list = syncStatus().push?.appareils || [];
    devices.textContent = list.length ? `Appareils abonnés du foyer : ${list.map((d) => `${d.label || 'appareil'}${d.member ? ` (${d.member})` : ''}`).join(', ')}.` : 'Aucun appareil abonné pour l’instant.';
    testBtn.hidden = !list.length;
    if (!pushSupported()) { status.textContent = isStandaloneIOS() ? 'Sur iPhone, installe d’abord Tartinou sur l’écran d’accueil (Partager → Sur l’écran d’accueil), puis reviens ici.' : 'Ce navigateur ne gère pas les notifications push.'; return; }
    if (Notification.permission === 'denied') { status.textContent = 'Notifications bloquées dans le navigateur : autorise-les dans les réglages du site.'; return; }
    const sub = await currentSubscription();
    toggle.disabled = false;
    toggle.checked = !!sub;
    status.textContent = sub ? 'Cet appareil reçoit les notifications du foyer.' : 'Active les notifications sur cet appareil pour recevoir les rappels.';
  }
  async function onToggle(ev) {
    const on = ev.target.checked;
    toggle.disabled = true;
    try {
      if (on) await subscribeDevice(syncStatus().push?.publicKey || (await api('GET', '/push/key')).publicKey);
      else await unsubscribeDevice();
      await refreshMe().catch(() => {});
      toast(on ? 'Notifications activées sur cet appareil' : 'Notifications désactivées ici');
    } catch (e) { toast(e.message || 'Impossible d’activer les notifications'); }
    await draw();
  }
  draw();
  const hourSel = h('select', { class: 'input', id: 'n-heure', value: String(n.heure), onchange: (ev) => setN('heure', Number(ev.target.value)) },
    Array.from({ length: 24 }, (_, i) => h('option', { value: String(i) }, `${String(i).padStart(2, '0')} h`)));
  return zone('Notifications',
    h('label', { class: 'switch' }, toggle, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', null, 'Recevoir les notifications sur cet appareil')),
    status,
    devices,
    testBtn,
    h('p', { class: 'label' }, 'Ce que le foyer reçoit'),
    switchRow('Activer les rappels', 'Interrupteur général pour tout le foyer.', n.actives, (v) => setN('actives', v)),
    h('div', { class: 'field' }, h('label', { for: 'n-heure' }, 'Heure d’envoi'), hourSel),
    switchRow('Dates limites', 'Chaque jour où un produit est à consommer vite ou périmé.', n.dlc, (v) => setN('dlc', v)),
    switchRow('Bilan hebdomadaire', 'Le dimanche : dépensé, marge, produits consommés et jetés.', n.hebdo, (v) => setN('hebdo', v)),
    switchRow('Bilan mensuel', 'Le dernier jour du cycle : dépensé, économisé, gaspillé.', n.mensuel, (v) => setN('mensuel', v)),
    switchRow('Objectifs de catégorie', 'Quand une catégorie atteint 80 % puis 100 % de son objectif.', n.objectifs, (v) => setN('objectifs', v)),
  );
}

/* ---------- Compte et foyer ---------- */
function accountZone() {
  const sy = syncStatus();
  const user = sy.user;
  const foyer = sy.foyer;
  const isAdmin = user?.role === 'admin';
  const SYNC_TXT = { idle: 'Connexion au serveur…', syncing: 'Envoi en cours…', synced: 'Synchronisé avec le serveur', offline: 'Hors ligne : les modifications sont gardées ici et partiront à la reconnexion', auth: 'Connexion requise', error: 'Erreur de synchronisation' };
  const syncLine = h('p', { class: 'summary small' });
  function drawSyncLine(s2) {
    const n = s2.pending.size;
    syncLine.replaceChildren(SYNC_TXT[s2.status] || s2.status, s2.message && s2.status === 'error' ? ` (${s2.message})` : '', n ? ` · ${n} bloc${n > 1 ? 's' : ''} en attente` : '',
      s2.live ? ' · temps réel actif' : '', s2.lastRemote ? ` · dernière modification par ${s2.lastRemote.by}` : '');
  }
  drawSyncLine(sy);
  const unsub = onSync((s2) => { if (!syncLine.isConnected) { unsub(); return; } drawSyncLine(s2); });

  const membersList = h('ul', { class: 'rows' });
  const codeLine = h('p', { class: 'summary' });
  function drawFoyer() {
    const f = syncStatus().foyer;
    if (!f) return;
    membersList.replaceChildren(...f.membres.map((m) => h('li', { class: 'row-item' },
      h('span', { class: 'row-text' }, m.nom, h('span', { class: 'muted small block' }, `${m.login}${m.role === 'admin' ? ' · administrateur' : ''}`)),
      isAdmin && m.id !== user.id ? h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Retirer ${m.nom}`, onclick: async () => {
        const ok = await confirmDialog({ title: `Retirer ${m.nom} du foyer ?`, message: 'Son compte sera supprimé et ses appareils déconnectés. Les données du foyer restent.', confirmLabel: 'Retirer', danger: true });
        if (!ok) return;
        try { await api('DELETE', `/members/${m.id}`); await refreshMe(); drawFoyer(); toast(`${m.nom} retiré du foyer`); } catch (e) { toast(e.message); }
      } }, icon('trash')) : null)));
    codeLine.replaceChildren(...(f.codeInvitation
      ? ['Code d’invitation : ', h('strong', { class: 'num code-invit' }, f.codeInvitation), ' ', h('button', { type: 'button', class: 'link small', onclick: async () => { try { await navigator.clipboard.writeText(f.codeInvitation); toast('Code copié'); } catch { toast(f.codeInvitation); } } }, 'copier')]
      : ['Le code d’invitation est visible par l’administrateur du foyer.']));
  }
  drawFoyer();

  async function changePassword() {
    const old = h('input', { type: 'password', id: 'pw-old', class: 'input', autocomplete: 'current-password' });
    const nw = h('input', { type: 'password', id: 'pw-new', class: 'input', autocomplete: 'new-password', placeholder: '8 caractères minimum' });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const dlg = openDialog({ title: 'Changer le mot de passe', cls: 'sheet-compact',
      content: [h('div', { class: 'field' }, h('label', { for: 'pw-old' }, 'Mot de passe actuel'), old), h('div', { class: 'field' }, h('label', { for: 'pw-new' }, 'Nouveau mot de passe'), nw), err],
      actions: [h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'), h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        try { const r = await api('POST', '/auth/password', { ancien: old.value, nouveau: nw.value }); setToken(r.token); dlg.close(); toast('Mot de passe changé'); }
        catch (e) { err.textContent = e.message; err.hidden = false; }
      } }, 'Enregistrer')] });
    setTimeout(() => old.focus(), 50);
  }
  async function renameFoyer() {
    const input = h('input', { type: 'text', id: 'fy-nom', class: 'input', value: foyer?.nom || '', maxlength: '60' });
    const dlg = openDialog({ title: 'Nom du foyer', cls: 'sheet-compact', content: h('div', { class: 'field' }, h('label', { for: 'fy-nom' }, 'Nom'), input),
      actions: [h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Annuler'), h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        try { await api('POST', '/foyer', { nom: input.value }); await refreshMe(); dlg.close(); toast('Foyer renommé'); update(() => {}); }
        catch (e) { toast(e.message); }
      } }, 'Enregistrer')] });
  }

  return zone('Compte et foyer',
    user ? h('p', null, h('strong', null, user.nom), h('span', { class: 'muted' }, ` · ${user.login}${isAdmin ? ' · administrateur' : ''}`)) : h('p', { class: 'muted' }, 'Non connecté.'),
    foyer ? h('p', null, 'Foyer : ', h('strong', null, foyer.nom), isAdmin ? [' ', h('button', { type: 'button', class: 'link small', onclick: renameFoyer }, 'renommer')] : null) : null,
    codeLine,
    isAdmin ? h('p', { class: 'muted small' }, 'Donne ce code à la personne qui doit rejoindre ton foyer : elle le saisit à l’inscription. ', h('button', { type: 'button', class: 'link small', onclick: async () => { const ok = await confirmDialog({ title: 'Générer un nouveau code ?', message: 'L’ancien code ne fonctionnera plus.', confirmLabel: 'Nouveau code' }); if (!ok) return; try { await api('POST', '/foyer', { nouveauCode: true }); await refreshMe(); drawFoyer(); toast('Nouveau code généré'); } catch (e) { toast(e.message); } } }, 'Générer un nouveau code')) : null,
    h('p', { class: 'label' }, 'Membres'),
    membersList,
    syncLine,
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => { if (syncStatus().pending.size) await flush(); else await initStore(); toast(SYNC_TXT[syncStatus().status] || 'Synchronisé'); } }, icon('cloud'), 'Synchroniser'),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: changePassword }, 'Mot de passe'),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => { const ok = await confirmDialog({ title: 'Se déconnecter ?', message: 'La copie locale sera effacée de cet appareil. Les données restent sur le serveur.', confirmLabel: 'Se déconnecter' }); if (ok) logout(); } }, 'Se déconnecter')),
  );
}

/* ---------- Import d'un relevé bancaire ---------- */
function openBankImport(text) {
  const state = getState();
  const { rows, error } = parseBankCsv(text);
  if (error) { toast(error); return; }
  const matched = matchBankRows(rows, state.expenses);
  const unmatched = matched.filter((r) => !r.expense);
  const selected = new Set(unmatched.map((_, i) => i));
  const cats = new Map(unmatched.map((r, i) => [i, guessCategoryId(r.libelle, state.categories)]));
  const btn = h('button', { type: 'button', class: 'btn btn-primary', onclick: confirm }, '');
  const drawBtn = () => { btn.textContent = selected.size ? `Ajouter ${selected.size} dépense${selected.size > 1 ? 's' : ''}` : 'Rien à ajouter'; btn.disabled = !selected.size; };
  drawBtn();
  const list = h('ul', { class: 'ranger-list' }, unmatched.map((r, i) => {
    const id = `bk-${i}`;
    const box = h('input', { type: 'checkbox', id, class: 'check', checked: true, onchange: (ev) => { if (ev.target.checked) selected.add(i); else selected.delete(i); li.classList.toggle('is-off', !ev.target.checked); drawBtn(); } });
    const sel = h('select', { class: 'input', 'aria-label': 'Catégorie', value: cats.get(i), onchange: (ev) => cats.set(i, ev.target.value) }, state.categories.map((c) => h('option', { value: c.id }, c.nom)));
    const li = h('li', { class: 'ranger-row' },
      h('div', { class: 'shop-main' }, box, h('label', { for: id, class: 'shop-label' }, h('span', { class: 'shop-name' }, r.libelle || 'Sans libellé'), h('span', { class: 'muted small' }, ` · ${fmtDate(r.date, { day: 'numeric', month: 'short' })}`)), h('span', { class: 'num shop-price' }, money(r.montant))),
      h('div', { class: 'field-row ranger-fields' }, sel));
    return li;
  }));
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'bank-title' },
    h('header', { class: 'sheet-head' }, h('h2', { id: 'bank-title', class: 'sheet-title' }, 'Relevé bancaire'), h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Fermer', onclick: () => dlg.close() }, icon('x'))),
    h('div', { class: 'sheet-body' },
      h('p', { class: 'summary' }, `${rows.length} débit${rows.length > 1 ? 's' : ''} lus · ${rows.length - unmatched.length} déjà saisi${rows.length - unmatched.length > 1 ? 's' : ''} · ${unmatched.length} à ajouter`),
      unmatched.length ? h('p', { class: 'muted small' }, 'Décoche ce qui n’est pas une dépense du quotidien (virements, remboursements). La catégorie est devinée d’après le libellé.') : h('p', { class: 'muted' }, 'Tout est déjà dans tes dépenses.'),
      list),
    h('footer', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Fermer'), btn));
  function confirm() {
    const user = syncStatus().user;
    update((st) => {
      for (const i of selected) {
        const r = unmatched[i];
        st.expenses.push({ id: uid(), montant: r.montant, categorieId: cats.get(i), note: r.libelle.slice(0, 80), date: r.date, createdAt: Date.now(), auteur: user?.nom || null });
      }
    });
    toast(`${selected.size} dépense${selected.size > 1 ? 's' : ''} ajoutée${selected.size > 1 ? 's' : ''}`);
    dlg.close();
  }
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- Helpers ---------- */
function zone(title, ...children) {
  return h('section', { class: 'zone zone-open' }, h('h2', { class: 'zone-title' }, title), h('div', { class: 'zone-body' }, children));
}
function numField(id, label, value, onChange, { step = '1', min = '0', max, mode = 'decimal' } = {}) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', { type: 'number', id, class: 'input', step, min, max, inputmode: mode, value: String(value ?? 0), onchange: onChange }));
}
function switchRow(label, hint, checked, onChange) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', role: 'switch', checked, onchange: (ev) => onChange(ev.target.checked) }),
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    h('span', null, label, hint ? h('span', { class: 'muted small block' }, hint) : null));
}
