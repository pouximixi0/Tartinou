// Notifications planifiées : dates limites du jour, bilan hebdomadaire,
// bilan mensuel (fin de cycle), objectifs de catégorie à 80 %.
// Appelé toutes les quelques minutes ; push_log évite les doublons.
import { readState, listSubscriptions, removeSubscription, pushLogHas, pushLogSet } from './db.js';
import { sendPush } from './webpush.js';
import { computeBudget, cycleFor, sumBetween } from '../js/budget.js';
import { dlcInfo, journalStats } from '../js/stock.js';
import { addDays, mondayOf } from '../js/utils.js';

const TZ = process.env.TZ_APP || 'Europe/Paris';
const eur = (n) => `${(Math.round((n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Heure locale du foyer : { iso: 'AAAA-MM-JJ', hour, weekday (0 = dimanche) }. */
function localNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'].indexOf(parts.weekday);
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday };
}

/** Messages à envoyer maintenant pour un foyer donné. Chaque message a une clé unique (anti-doublon). */
export function pendingMessages(state, now = localNow()) {
  const n = state.settings.notifs || {};
  if (!n.actives) return [];
  if (now.hour !== Number(n.heure ?? 18)) return [];
  const out = [];
  const today = now.iso;

  if (n.dlc) {
    const alert = state.settings.stock.alertDays;
    let perimes = 0, urgents = 0, demain = [];
    for (const it of state.stock.items) {
      const info = dlcInfo(it, alert, today);
      if (info.status === 'perime') perimes++;
      else if (info.status === 'urgent') { urgents++; if (info.jours <= 1) demain.push(it.nom); }
    }
    if (perimes || urgents) {
      const bits = [];
      if (demain.length) bits.push(`${demain.slice(0, 3).join(', ')}${demain.length > 3 ? '…' : ''} à consommer d’ici demain`);
      if (urgents > demain.length) bits.push(`${urgents - demain.length} autre${urgents - demain.length > 1 ? 's' : ''} bientôt`);
      if (perimes) bits.push(`${perimes} périmé${perimes > 1 ? 's' : ''} à trier`);
      out.push({ key: `dlc:${today}`, title: 'Ton stock a besoin de toi', body: bits.join(' · '), url: '#stock' });
    }
  }

  if (n.hebdo && now.weekday === 0) {
    const b = computeBudget(state, today);
    const monday = mondayOf(today);
    const st = journalStats(state, monday, addDays(today, 1));
    const spent = b.semaine.depense;
    const body = [
      b.configured ? `Dépensé ${eur(spent)} sur ${eur(Math.max(0, b.semaine.plafond))}${b.semaine.reste >= 0 ? `, ${eur(b.semaine.reste)} de marge` : `, dépassé de ${eur(-b.semaine.reste)}`}` : `Dépensé ${eur(spent)} cette semaine`,
      st.conso + st.jete ? `${st.conso} produit${st.conso > 1 ? 's' : ''} consommé${st.conso > 1 ? 's' : ''}, ${st.jete} jeté${st.jete > 1 ? 's' : ''}${st.jeteValeur ? ` (${eur(st.jeteValeur)})` : ''}` : null,
    ].filter(Boolean).join(' · ');
    out.push({ key: `hebdo:${monday}`, title: 'Bilan de la semaine', body, url: '#depenses' });
  }

  if (n.mensuel) {
    const cycle = cycleFor(today, state.settings.debutMois);
    if (today === addDays(cycle.end, -1)) {
      const b = computeBudget(state, today);
      const st = journalStats(state, cycle.start, cycle.end);
      const eco = b.mois.reste;
      const body = [
        b.configured ? `Dépensé ${eur(b.mois.depense)} sur ${eur(Math.max(0, b.mois.plafond))}${eco >= 0 ? `, économisé ${eur(eco)}` : `, dépassé de ${eur(-eco)}`}` : `Dépensé ${eur(b.mois.depense)} ce mois`,
        `${st.conso} consommé${st.conso > 1 ? 's' : ''}, ${st.jete} jeté${st.jete > 1 ? 's' : ''}${st.jeteValeur ? `, ${eur(st.jeteValeur)} gaspillés` : ''}`,
      ].join(' · ');
      out.push({ key: `mensuel:${cycle.start}`, title: 'Bilan du mois', body, url: '#depenses' });
    }
  }

  if (n.objectifs && state.settings.objectifs) {
    const cycle = cycleFor(today, state.settings.debutMois);
    for (const [catId, obj] of Object.entries(state.settings.objectifs)) {
      const cap = Number(obj);
      if (!(cap > 0)) continue;
      const spent = sumBetween(state.expenses.filter((e) => e.categorieId === catId), cycle.start, cycle.end);
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) continue;
      if (spent >= cap) out.push({ key: `obj100:${cycle.start}:${catId}`, title: `Objectif ${cat.nom} dépassé`, body: `${eur(spent)} dépensés pour ${eur(cap)} prévus.`, url: '#depenses' });
      else if (spent >= 0.8 * cap) out.push({ key: `obj80:${cycle.start}:${catId}`, title: `${cat.nom} : 80 % de l’objectif`, body: `${eur(spent)} sur ${eur(cap)}, il reste ${eur(cap - spent)}.`, url: '#depenses' });
    }
  }
  return out;
}

/** Envoie les messages en attente d'un foyer. `vapid` = { publicKey, privateKey, subject }. */
export async function notifyFoyer(db, vapid, log = console) {
  const subs = listSubscriptions(db);
  if (!subs.length) return 0;
  const state = readState(db);
  const messages = pendingMessages(state).filter((m) => !pushLogHas(db, m.key));
  let sent = 0;
  for (const m of messages) {
    pushLogSet(db, m.key);
    for (const s of subs) {
      try {
        const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: m.title, body: m.body, url: m.url, tag: m.key.split(':')[0] }, vapid);
        if (r.status === 404 || r.status === 410) removeSubscription(db, s.endpoint);
        else if (!r.ok) log.warn('push refusé', r.status, r.text.slice(0, 200));
        else sent++;
      } catch (err) { log.warn('push erreur', err.message); }
    }
  }
  return sent;
}

/** Envoi direct (test ou message ponctuel) à tous les appareils du foyer. */
export async function broadcast(db, vapid, payload, log = console) {
  let sent = 0;
  for (const s of listSubscriptions(db)) {
    try {
      const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, vapid);
      if (r.status === 404 || r.status === 410) removeSubscription(db, s.endpoint);
      else if (r.ok) sent++;
      else log.warn('push refusé', r.status, r.text.slice(0, 200));
    } catch (err) { log.warn('push erreur', err.message); }
  }
  return sent;
}
