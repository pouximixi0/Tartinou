// Fonctions activables ou non dans les réglages. Tout est activé par défaut ;
// `isOn('mur')` répond false seulement si l'utilisateur a coupé la fonction.
import { getState } from './store.js';

export const MODULE_GROUPS = [
  { titre: 'Écrans', items: [
    ['menus', 'Menus', 'Onglet Menus : prompt, import, semaine, favoris.'],
    ['courses', 'Courses', 'Onglet Courses : liste, ticket, rangement.'],
    ['stock', 'Stock', 'Onglet Stock : produits, dates limites, anti-gaspi.'],
    ['foyer', 'Communauté', 'Onglet Communauté : fil commun à tout le serveur, mur du foyer, réactions, commentaires.'],
  ] },
  { titre: 'Aujourd’hui', items: [
    ['miniJauges', 'Jauges semaine et mois', ''],
    ['alerteStock', 'Alerte stock', 'Produits périmés ou à consommer vite.'],
    ['alerteObjectifs', 'Alerte objectifs', 'Catégories à 80 % ou au-delà.'],
    ['mur', 'Aperçu du flux', 'Dernières publications du foyer sur Aujourd’hui.'],
    ['activite', 'Activité automatique', 'Dépenses, stock et plats cuisinés dans le flux.'],
    ['serie', 'Série de jours sous le budget', ''],
  ] },
  { titre: 'Dépenses', items: [
    ['auteurDepenses', 'Auteur des dépenses', 'Prénom affiché quand le foyer a plusieurs membres.'],
    ['objectifs', 'Objectifs par catégorie', 'Barres colorées et alertes.'],
    ['recurrences', 'Récurrences proposées', 'Dépenses mensuelles suggérées en charges fixes.'],
    ['releveCsv', 'Import de relevé bancaire', ''],
  ] },
  { titre: 'Menus', items: [
    ['ceSoir', '« Que cuisiner ce soir ? »', ''],
    ['favoris', 'Recettes favorites', ''],
    ['liensRecettes', 'Liens vers les recettes en ligne', 'Demandés dans le prompt et affichés dans les fiches.'],
    ['cuisine', '« J’ai cuisiné ce plat »', 'Retire les ingrédients du stock.'],
  ] },
  { titre: 'Courses', items: [
    ['tagEnStock', 'Étiquette « en stock »', ''],
    ['rangerApresTicket', 'Ranger après le ticket', 'Propose de ranger les courses dès le ticket validé.'],
    ['aRacheter', 'Liste « À racheter »', ''],
  ] },
  { titre: 'Stock', items: [
    ['nutriscore', 'Nutri-Score', 'Pastille colorée sur les produits scannés.'],
    ['allergenes', 'Allergènes', 'Signalés en rouge d’après ton profil.'],
    ['prixHistorique', 'Prix et historique par magasin', ''],
    ['portions', 'Portions restantes', ''],
    ['valeurStock', 'Valeur du stock', ''],
    ['antiGaspi', 'Anti-gaspi', 'Journal, statistiques, euros gaspillés.'],
    ['rangement', 'Mode rangement', 'Inventaire guidé.'],
    ['etiquettesQR', 'Étiquettes QR', ''],
    ['rappels', 'Rappels de produits', 'Alerte quand un produit du stock fait l’objet d’un rappel officiel (RappelConso).'],
    ['prixOpen', 'Prix relevés en magasin', 'Open Prices : prix vus par d’autres pour ce produit, triés par distance.'],
  ] },
  { titre: 'Général', items: [
    ['partage', 'Boutons de partage', 'Liste, menu, recettes, invitation.'],
    ['tempsReel', 'Mise à jour en direct', 'Les modifications des autres appareils arrivent sans recharger.'],
  ] },
];

export const MODULE_KEYS = MODULE_GROUPS.flatMap((g) => g.items.map(([k]) => k));
export const defaultModules = () => Object.fromEntries(MODULE_KEYS.map((k) => [k, true]));

/** true sauf si la fonction a été désactivée dans les réglages. */
export function isOn(key, state = getState()) {
  const m = state && state.settings && state.settings.modules;
  return !m || m[key] !== false;
}
