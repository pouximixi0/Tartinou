// Toute la logique budget passe par computeBudget() : Aujourd'hui, Dépenses
// et le pré-remplissage du budget courses lisent le même résultat.
import { todayISO, fromISO, toISO, addDays, daysBetween, mondayOf, round2 } from './utils.js';

/** Début d'un cycle pour un mois donné, borné au dernier jour du mois. */
function cycleStartInMonth(year, month, debutMois) {
  const last = new Date(year, month + 1, 0).getDate();
  return toISO(new Date(year, month, Math.min(debutMois, last)));
}

/** Cycle budgétaire contenant `iso` : { start, end (exclu), days }. */
export function cycleFor(iso, debutMois = 1) {
  const d = fromISO(iso);
  let start = cycleStartInMonth(d.getFullYear(), d.getMonth(), debutMois);
  if (start > iso) start = cycleStartInMonth(d.getFullYear(), d.getMonth() - 1, debutMois);
  const sd = fromISO(start);
  const end = cycleStartInMonth(sd.getFullYear(), sd.getMonth() + 1, debutMois);
  return { start, end, days: daysBetween(start, end) };
}

export const sumBetween = (expenses, from, to) =>
  expenses.reduce((acc, e) => (e.date >= from && e.date < to ? acc + e.montant : acc), 0);

export function enveloppeOf(settings) {
  const charges = settings.chargesFixes.reduce((a, c) => a + (Number(c.montant) || 0), 0);
  return { charges, enveloppe: (Number(settings.revenuMensuel) || 0) - charges - (Number(settings.epargneVisee) || 0) };
}

/**
 * Premier jour réellement suivi dans un cycle : la date d'installation de l'app,
 * ou une dépense saisie plus tôt (antidatée). Avant ce jour, rien n'a été noté,
 * donc rien ne doit être reporté.
 */
export function trackingStartFor(state, cycle) {
  let start = state.settings.createdAt || cycle.start;
  for (const e of state.expenses) if (e.date >= cycle.start && e.date < cycle.end && e.date < start) start = e.date;
  if (start < cycle.start) return cycle.start;
  if (start > cycle.end) return cycle.end;
  return start;
}

/** Part de l'enveloppe qui couvre les jours suivis du cycle (l'enveloppe entière si tout le cycle est suivi). */
export function trackedEnveloppe(state, cycle) {
  const { enveloppe } = enveloppeOf(state.settings);
  const suivis = daysBetween(trackingStartFor(state, cycle), cycle.end);
  return (enveloppe * suivis) / cycle.days;
}

/** Max ajusté « au matin » du jour `iso` : reste suivi du cycle avant ce jour, réparti sur les jours restants. */
export function dailyMaxFor(state, iso) {
  const s = state.settings;
  const { enveloppe } = enveloppeOf(s);
  const cycle = cycleFor(iso, s.debutMois);
  const maxTheorique = enveloppe / cycle.days;
  if (s.budgetStrict || iso < trackingStartFor(state, cycle)) return maxTheorique;
  const spentBefore = sumBetween(state.expenses, cycle.start, iso);
  const joursRestants = daysBetween(iso, cycle.end);
  return (trackedEnveloppe(state, cycle) - spentBefore) / Math.max(1, joursRestants);
}

export function computeBudget(state, today = todayISO()) {
  const s = state.settings;
  const { enveloppe, charges } = enveloppeOf(s);
  const configured = (Number(s.revenuMensuel) || 0) > 0;
  const cycle = cycleFor(today, s.debutMois);
  const joursRestants = Math.max(1, daysBetween(today, cycle.end));
  const maxTheoriqueJour = enveloppe / cycle.days;
  const suiviDepuis = trackingStartFor(state, cycle);
  const enveloppeSuivie = trackedEnveloppe(state, cycle);
  const depenseCycle = sumBetween(state.expenses, cycle.start, cycle.end);
  const depenseAujourdhui = sumBetween(state.expenses, today, addDays(today, 1));
  const maxAjusteJour = (enveloppeSuivie - depenseCycle + depenseAujourdhui) / joursRestants;
  const maxJour = s.budgetStrict ? maxTheoriqueJour : maxAjusteJour;
  const resteAujourdhui = maxJour - depenseAujourdhui;

  // Plafond fixé au lundi matin. Si le lundi précède le cycle, on part du début du cycle.
  const monday = mondayOf(today);
  const refDay = monday < cycle.start ? cycle.start : monday;
  const plafondSemaine = (s.budgetStrict ? maxTheoriqueJour : dailyMaxFor(state, refDay)) * 7;
  const depenseSemaine = sumBetween(state.expenses, monday, addDays(monday, 7));

  return {
    configured,
    enveloppe,
    enveloppeSuivie,
    suiviDepuis,
    cyclePartiel: suiviDepuis > cycle.start,
    charges,
    cycle,
    joursDuCycle: cycle.days,
    joursRestants,
    maxTheoriqueJour,
    maxTheoriqueSemaine: maxTheoriqueJour * 7,
    maxAjusteJour,
    maxJour,
    depenseCycle,
    depenseAujourdhui,
    resteAujourdhui,
    semaine: { plafond: plafondSemaine, depense: depenseSemaine, reste: plafondSemaine - depenseSemaine },
    mois: { plafond: enveloppeSuivie, depense: depenseCycle, reste: enveloppeSuivie - depenseCycle },
    streak: computeStreak(state, today),
    budgetCourses: round2(Math.max(0, maxJour) * 7 * ((Number(s.partCourses) || 0) / 100)),
  };
}

/** Jours consécutifs (jusqu'à hier) où la dépense est restée sous le max du jour. */
function computeStreak(state, today) {
  const floor = state.settings.createdAt || today;
  let streak = 0;
  let day = addDays(today, -1);
  for (let i = 0; i < 366 && day >= floor; i++) {
    const spent = sumBetween(state.expenses, day, addDays(day, 1));
    if (spent > dailyMaxFor(state, day) + 0.005) break;
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/** Les N derniers cycles (le courant en premier), pour le filtre de l'écran Dépenses. */
export function recentCycles(debutMois, n = 12, today = todayISO()) {
  const out = [];
  let c = cycleFor(today, debutMois);
  for (let i = 0; i < n; i++) {
    out.push(c);
    c = cycleFor(addDays(c.start, -1), debutMois);
  }
  return out;
}
