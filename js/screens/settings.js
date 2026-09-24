// Écran Réglages : budget, charges fixes, catégories, sauvegarde, thème, installation.
import { h, icon, money, uid, toast, todayISO, parseAmount } from '../utils.js';
import { getState, update, replaceState, resetState, exportJSON, checkBackup, syncStatus, onSync, flush, initStore } from '../store.js';
import { setToken } from '../api.js';
import { enveloppeOf, cycleFor } from '../budget.js';
import { confirmDialog } from '../components/dialog.js';
import { canInstall, promptInstall, onInstallable, isIOS, isStandalone } from '../install.js';

export function renderSettings() {
  const state = getState();
  const s = state.settings;
  const root = h('section', { class: 'screen screen-settings' });
  root.append(h('h1', { class: 'lead' }, 'Réglages'));

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
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Budget'),
      h('div', { class: 'zone-body' },
        numField('s-revenu', 'Revenu mensuel (€)', s.revenuMensuel, setNum('revenuMensuel', 0, 1e7), { step: '10' }),
        h('div', { class: 'field-row' },
          numField('s-debut', 'Jour de début du cycle', s.debutMois, setNum('debutMois', 1, 31), { step: '1', max: '31', min: '1', mode: 'numeric' }),
          numField('s-epargne', 'Épargne visée par mois (€)', s.epargneVisee, setNum('epargneVisee', 0, 1e7), { step: '10' })),
        numField('s-part', 'Part des courses dans le budget (%)', s.partCourses, setNum('partCourses', 0, 100), { step: '5', max: '100', mode: 'numeric' }),
        summary,
        h('label', { class: 'switch' },
          h('input', { type: 'checkbox', role: 'switch', checked: s.budgetStrict, onchange: (ev) => update((st) => { st.settings.budgetStrict = ev.target.checked; }) }),
          h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
          h('span', null, 'Budget journalier strict', h('span', { class: 'muted small block' }, 'Affiche le maximum théorique du jour, sans report d’un jour sur l’autre.'))),
      )),
  );

  /* ---- Charges fixes ---- */
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
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Charges fixes'),
      h('div', { class: 'zone-body' },
        s.chargesFixes.length
          ? h('ul', { class: 'rows' }, s.chargesFixes.map((c) =>
              h('li', { class: 'row-item' },
                h('span', { class: 'row-text' }, c.nom, h('span', { class: 'muted small block' }, `le ${c.jourDuMois} du mois`)),
                h('span', { class: 'num' }, money(c.montant)),
                h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Supprimer ${c.nom}`, onclick: () => update((st) => { st.settings.chargesFixes = st.settings.chargesFixes.filter((x) => x.id !== c.id); }) }, icon('trash')))))
          : h('p', { class: 'muted' }, 'Aucune charge fixe. Ajoute ton loyer et tes abonnements : ils sont retirés de l’enveloppe mais ne comptent pas comme des dépenses.'),
        h('p', { class: 'summary' }, 'Total des charges : ', h('strong', { class: 'num' }, money(totalCharges))),
        h('div', { class: 'field' }, h('label', { for: 'c-nom' }, 'Nom'), cNom),
        h('div', { class: 'field-row' },
          h('div', { class: 'field' }, h('label', { for: 'c-montant' }, 'Montant (€)'), cMontant),
          h('div', { class: 'field' }, h('label', { for: 'c-jour' }, 'Jour du mois'), cJour)),
        cErr,
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: addCharge }, icon('plus'), 'Ajouter la charge'),
      )),
  );

  /* ---- Catégories ---- */
  async function deleteCategory(cat) {
    if (cat.id === 'autre') { toast('La catégorie Autre accueille les dépenses orphelines : elle ne peut pas être supprimée.'); return; }
    const n = state.expenses.filter((e) => e.categorieId === cat.id).length;
    const ok = await confirmDialog({ title: `Supprimer « ${cat.nom} » ?`, message: n ? `${n} dépense${n > 1 ? 's' : ''} passera${n > 1 ? 'ont' : ''} dans « Autre ».` : 'Aucune dépense n’utilise cette catégorie.', confirmLabel: 'Supprimer la catégorie', danger: true });
    if (!ok) return;
    update((st) => {
      st.categories = st.categories.filter((c) => c.id !== cat.id);
      st.expenses.forEach((e) => { if (e.categorieId === cat.id) e.categorieId = 'autre'; });
      if (!st.categories.some((c) => c.id === 'autre')) st.categories.push({ id: 'autre', nom: 'Autre', couleur: '#64748B' });
    });
  }
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Catégories'),
      h('div', { class: 'zone-body' },
        h('ul', { class: 'rows' }, state.categories.map((cat) =>
          h('li', { class: 'row-item' },
            h('input', { type: 'color', class: 'color', value: cat.couleur, 'aria-label': `Couleur de ${cat.nom}`, onchange: (ev) => update((st) => { st.categories.find((c) => c.id === cat.id).couleur = ev.target.value; }, { quiet: true }) }),
            h('input', { type: 'text', class: 'input', value: cat.nom, maxlength: '30', 'aria-label': 'Nom de la catégorie', onchange: (ev) => { const v = ev.target.value.trim() || cat.nom; ev.target.value = v; update((st) => { st.categories.find((c) => c.id === cat.id).nom = v; }, { quiet: true }); } }),
            h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Supprimer ${cat.nom}`, disabled: cat.id === 'autre', onclick: () => deleteCategory(cat) }, icon('trash'))))),
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => { update((st) => { st.categories.push({ id: uid(), nom: 'Nouvelle catégorie', couleur: '#64748B' }); }); setTimeout(() => { const inputs = document.querySelectorAll('.screen-settings .rows input[type=text]'); const last = inputs[inputs.length - 1]; last?.focus(); last?.select(); }, 0); } }, icon('plus'), 'Ajouter une catégorie'),
      )),
  );

  /* ---- Stock ---- */
  const nProducts = Object.keys(state.stock.products).length;
  const setStock = (k, v) => update((st) => { st.settings.stock[k] = v; }, { quiet: true });
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Stock alimentaire'),
      h('div', { class: 'zone-body' },
        numField('s-alert', 'Alerte avant la date limite (jours)', s.stock.alertDays, (ev) => { const v = Math.min(30, Math.max(0, Number(ev.target.value) || 0)); ev.target.value = String(v); update((st) => { st.settings.stock.alertDays = v; }); }, { step: '1', max: '30', mode: 'numeric' }),
        switchRow('Scan en continu', 'Après un ajout, la caméra reste ouverte pour le produit suivant.', s.stock.scanContinu, (v) => setStock('scanContinu', v)),
        switchRow('Vibration au scan', '', s.stock.vibration, (v) => setStock('vibration', v)),
        switchRow('Bip au scan', '', s.stock.son, (v) => setStock('son', v)),
        h('p', { class: 'muted small' }, nProducts ? `${nProducts} produit${nProducts > 1 ? 's' : ''} mémorisé${nProducts > 1 ? 's' : ''} depuis Open Food Facts, utilisable${nProducts > 1 ? 's' : ''} hors ligne.` : 'Les produits scannés sont mémorisés pour fonctionner hors ligne.'),
        nProducts ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: async () => {
          const ok = await confirmDialog({ title: 'Vider le cache produits ?', message: 'Les produits seront recherchés à nouveau au prochain scan. Ton stock n’est pas touché.', confirmLabel: 'Vider le cache' });
          if (ok) { update((st) => { st.stock.products = {}; }); toast('Cache produits vidé'); }
        } }, 'Vider le cache produits') : null,
      )),
  );

  /* ---- Serveur et synchronisation ---- */
  const SYNC_TXT = { idle: 'Connexion au serveur…', syncing: 'Envoi en cours…', synced: 'Synchronisé avec le serveur', offline: 'Hors ligne : les modifications sont gardées ici et partiront à la reconnexion', auth: 'Code d’accès requis', error: 'Erreur de synchronisation' };
  const syncLine = h('p', { class: 'summary small' });
  function drawSyncLine(sy) {
    if (!syncLine.isConnected && sy !== syncStatus()) return;
    const n = sy.pending.size;
    syncLine.replaceChildren(SYNC_TXT[sy.status] || sy.status, sy.message && sy.status === 'error' ? ` (${sy.message})` : '', n ? ` · ${n} bloc${n > 1 ? 's' : ''} en attente` : '',
      sy.lastOk ? ` · dernier échange à ${new Date(sy.lastOk).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '');
  }
  drawSyncLine(syncStatus());
  const unsub = onSync((sy) => { if (!syncLine.isConnected) { unsub(); return; } drawSyncLine(sy); });
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Serveur'),
      h('div', { class: 'zone-body' },
        h('p', { class: 'muted small' }, 'Tes données vivent dans la base SQLite de ton serveur. Cet appareil en garde une copie pour fonctionner hors ligne.'),
        syncLine,
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => { if (syncStatus().pending.size) await flush(); else await initStore(); toast(syncStatus().status === 'synced' ? 'Synchronisé' : SYNC_TXT[syncStatus().status]); } }, icon('cloud'), 'Synchroniser maintenant'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => {
            const ok = await confirmDialog({ title: 'Changer le code d’accès ?', message: 'L’app te redemandera le code du serveur. Les données ne sont pas touchées.', confirmLabel: 'Changer le code' });
            if (ok) { setToken(''); location.reload(); }
          } }, 'Changer le code d’accès')),
      )),
  );

  /* ---- Sauvegarde ---- */
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'import-file', onchange: importBackup });
  async function importBackup(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch (err) { toast(`Fichier illisible : ${err.message}`); ev.target.value = ''; return; }
    const problem = checkBackup(obj);
    if (problem) { toast(problem); ev.target.value = ''; return; }
    const ok = await confirmDialog({ title: 'Remplacer toutes les données ?', message: `La sauvegarde contient ${obj.expenses.length} dépense${obj.expenses.length > 1 ? 's' : ''}. Tout ce qui est dans l’app sera remplacé.`, confirmLabel: 'Remplacer mes données', danger: true });
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
  async function eraseAll() {
    const one = await confirmDialog({ title: 'Effacer toutes les données ?', message: 'Dépenses, menus, stock, réglages : tout sera supprimé, sur le serveur aussi.', confirmLabel: 'Continuer', danger: true });
    if (!one) return;
    const two = await confirmDialog({ title: 'Dernière confirmation', message: 'Cette action est définitive. Exporte une sauvegarde avant si besoin.', confirmLabel: 'Effacer définitivement', danger: true });
    if (!two) return;
    resetState();
    location.hash = '#aujourdhui';
  }
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Sauvegarde'),
      h('div', { class: 'zone-body' },
        h('p', { class: 'muted small' }, 'Le fichier exporté contient tout : dépenses, menus, stock et réglages. Une sauvegarde importée remplace la base du serveur.'),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: exportBackup }, icon('download'), 'Exporter mes données'),
          fileInput,
          h('label', { for: 'import-file', class: 'btn btn-secondary' }, 'Importer une sauvegarde')),
        h('button', { type: 'button', class: 'btn btn-danger-outline btn-block', onclick: eraseAll }, 'Effacer toutes les données'),
      )),
  );

  /* ---- Thème ---- */
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Thème'),
      h('div', { class: 'zone-body' },
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Thème' },
          [['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']].map(([val, label]) =>
            h('label', { class: 'seg' },
              h('input', { type: 'radio', name: 'theme', value: val, checked: s.theme === val, onchange: () => update((st) => { st.settings.theme = val; }) }),
              h('span', null, label)))))),
  );

  /* ---- Installation ---- */
  const installBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', hidden: !canInstall(), onclick: async () => { if (await promptInstall()) toast('Tartinou est installée'); } }, 'Installer l’app');
  onInstallable((yes) => { installBtn.hidden = !yes; });
  root.append(
    h('section', { class: 'zone zone-open' },
      h('h2', { class: 'zone-title' }, 'Application'),
      h('div', { class: 'zone-body' },
        isStandalone() ? h('p', { class: 'muted' }, 'Tartinou est installée sur cet appareil.') : null,
        installBtn,
        !isStandalone() && isIOS() ? h('p', { class: 'muted small' }, 'Sur iPhone : bouton Partager, puis « Sur l’écran d’accueil ».') : null,
        !isStandalone() && !isIOS() && !canInstall() ? h('p', { class: 'muted small', id: 'install-hint' }, 'Le bouton d’installation apparaît quand le navigateur le propose (Chrome, Edge). Sinon : menu du navigateur, « Installer l’application ».') : null,
        h('p', { class: 'muted small' }, 'Tartinou v2 · base de données sur le serveur, copie locale sous la clé foyer:v2.'),
      )),
  );
  return root;
}

function switchRow(label, hint, checked, onChange) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', role: 'switch', checked, onchange: (ev) => onChange(ev.target.checked) }),
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    h('span', null, label, hint ? h('span', { class: 'muted small block' }, hint) : null));
}

function numField(id, label, value, onChange, { step = '1', min = '0', max, mode = 'decimal' } = {}) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', { type: 'number', id, class: 'input', step, min, max, inputmode: mode, value: String(value ?? 0), onchange: onChange }));
}
