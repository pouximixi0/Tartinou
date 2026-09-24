// Premier lancement : trois étapes (revenu → charges → épargne), chacune passable.
import { h, icon, money, uid, parseAmount } from '../utils.js';
import { getState, update } from '../store.js';

let step = 0;

export function renderOnboarding() {
  const root = h('section', { class: 'screen screen-onboarding' });
  const body = h('div', { class: 'onboarding-body' });
  const draw = () => {
    body.replaceChildren(steps[step]());
    dots.textContent = `Étape ${step + 1} sur 3`;
    back.hidden = step === 0;
  };
  const finish = () => update((s) => { s.settings.onboarded = true; });
  const next = () => { if (step < 2) { step++; draw(); } else finish(); };

  const steps = [
    () => {
      const s = getState().settings;
      const revenu = h('input', { type: 'number', id: 'ob-revenu', class: 'input input-big num', min: '0', step: '10', inputmode: 'decimal', value: s.revenuMensuel ? String(s.revenuMensuel) : '', placeholder: '2000', autofocus: true });
      const debut = h('input', { type: 'number', id: 'ob-debut', class: 'input', min: '1', max: '31', inputmode: 'numeric', value: String(s.debutMois) });
      return h('div', null,
        h('h1', { class: 'lead' }, 'Combien gagnes-tu par mois ?'),
        h('p', { class: 'muted' }, 'Net, ce qui arrive sur ton compte. Tu pourras l’ajuster dans les réglages.'),
        h('div', { class: 'field' }, h('label', { for: 'ob-revenu' }, 'Revenu mensuel (€)'), revenu),
        h('div', { class: 'field' }, h('label', { for: 'ob-debut' }, 'Jour du mois où tu es payé'), debut,
          h('span', { class: 'muted small block' }, 'Le cycle budgétaire commence ce jour-là (1 par défaut).')),
        h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: () => {
          const r = parseAmount(revenu.value); const d = Math.min(31, Math.max(1, Number(debut.value) || 1));
          update((st) => { st.settings.revenuMensuel = r > 0 ? r : 0; st.settings.debutMois = d; }, { quiet: true });
          next();
        } }, 'Continuer'),
      );
    },
    () => {
      const list = h('ul', { class: 'rows' });
      const nom = h('input', { type: 'text', id: 'ob-cnom', class: 'input', placeholder: 'Ex. Loyer', maxlength: '40' });
      const montant = h('input', { type: 'text', id: 'ob-cmontant', class: 'input', inputmode: 'decimal', placeholder: '0,00' });
      const jour = h('input', { type: 'number', id: 'ob-cjour', class: 'input', inputmode: 'numeric', min: '1', max: '31', value: '1' });
      const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const total = h('p', { class: 'summary' });
      function drawList() {
        const charges = getState().settings.chargesFixes;
        list.replaceChildren(...charges.map((c) => h('li', { class: 'row-item' },
          h('span', { class: 'row-text' }, c.nom, h('span', { class: 'muted small block' }, `le ${c.jourDuMois} du mois`)),
          h('span', { class: 'num' }, money(c.montant)),
          h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Supprimer ${c.nom}`, onclick: () => { update((st) => { st.settings.chargesFixes = st.settings.chargesFixes.filter((x) => x.id !== c.id); }, { quiet: true }); drawList(); } }, icon('trash')))));
        total.replaceChildren('Total : ', h('strong', { class: 'num' }, money(charges.reduce((a, c) => a + c.montant, 0))), ' par mois');
      }
      function add() {
        const n = nom.value.trim(); const m = parseAmount(montant.value);
        if (!n) { err.textContent = 'Donne un nom à la charge (ex. Loyer).'; err.hidden = false; nom.focus(); return; }
        if (!(m > 0)) { err.textContent = 'Le montant doit être un nombre supérieur à zéro.'; err.hidden = false; montant.focus(); return; }
        err.hidden = true;
        update((st) => { st.settings.chargesFixes.push({ id: uid(), nom: n, montant: m, jourDuMois: Math.min(31, Math.max(1, Number(jour.value) || 1)) }); }, { quiet: true });
        nom.value = ''; montant.value = ''; drawList(); nom.focus();
      }
      drawList();
      return h('div', null,
        h('h1', { class: 'lead' }, 'Tes charges fixes principales'),
        h('p', { class: 'muted' }, 'Loyer, énergie, abonnements… Elles sont retirées de ton enveloppe une fois pour toutes.'),
        list, total,
        h('div', { class: 'field' }, h('label', { for: 'ob-cnom' }, 'Nom'), nom),
        h('div', { class: 'field-row' },
          h('div', { class: 'field' }, h('label', { for: 'ob-cmontant' }, 'Montant (€)'), montant),
          h('div', { class: 'field' }, h('label', { for: 'ob-cjour' }, 'Jour du mois'), jour)),
        err,
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: add }, icon('plus'), 'Ajouter la charge'),
        h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: next }, 'Continuer'),
      );
    },
    () => {
      const s = getState().settings;
      const ep = h('input', { type: 'number', id: 'ob-epargne', class: 'input input-big num', min: '0', step: '10', inputmode: 'decimal', value: s.epargneVisee ? String(s.epargneVisee) : '', placeholder: '200' });
      return h('div', null,
        h('h1', { class: 'lead' }, 'Combien veux-tu mettre de côté chaque mois ?'),
        h('p', { class: 'muted' }, 'Ce montant est réservé avant de calculer ton budget quotidien.'),
        h('div', { class: 'field' }, h('label', { for: 'ob-epargne' }, 'Épargne visée (€ par mois)'), ep),
        h('button', { type: 'button', class: 'btn btn-primary btn-block btn-tall', onclick: () => {
          const v = parseAmount(ep.value);
          update((st) => { st.settings.epargneVisee = v > 0 ? v : 0; }, { quiet: true });
          finish();
        } }, 'Commencer'),
      );
    },
  ];

  const dots = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const back = h('button', { type: 'button', class: 'link', onclick: () => { step--; draw(); } }, 'Retour');
  root.append(
    h('header', { class: 'onboarding-head' },
      h('p', { class: 'brand-big' }, 'Tartinou'),
      dots),
    body,
    h('div', { class: 'row-actions center' },
      back,
      h('button', { type: 'button', class: 'link', onclick: finish }, 'Passer et remplir plus tard')),
  );
  draw();
  return root;
}
