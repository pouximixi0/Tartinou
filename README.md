# Tartinou

Tartinou est une application personnelle (PWA) qui réunit le suivi des dépenses quotidiennes, les menus de la semaine et le **stock alimentaire** (scan des codes-barres, dates limites, anti-gaspi).

Depuis la v2, toutes les données vivent dans des **bases SQLite sur ton serveur** (`server/`), exposées par une petite API sans dépendance npm. On se crée un **compte** (identifiant, mot de passe) ; chaque **foyer** regroupe les personnes qui partagent les mêmes données et possède sa propre base. Le téléphone garde une copie locale (`localStorage`, clé `foyer:v2`) pour démarrer instantanément et fonctionner hors ligne ; les modifications faites sans réseau partent dès la reconnexion, et les autres appareils du foyer se mettent à jour en direct (SSE).

## Fonctions

- **Aujourd'hui** : reste à dépenser du jour, semaine, mois ; alertes stock et objectifs.
- **Dépenses** : saisie au pavé, catégories avec objectifs par cycle (orange à 80 %, rouge au-delà), auteur de chaque dépense à plusieurs, import d'un relevé bancaire CSV avec rapprochement, dépenses récurrentes proposées en charges fixes.
- **Menus** : prompt pour Claude (stock, produits urgents, « restes d'abord », recettes favorites), import du menu, « Que cuisiner ce soir ? » (une recette à partir de ce qui périme), fiche recette avec convives ajustables, « J'ai cuisiné ce plat » qui retire les ingrédients du stock, favoris remis au menu en un geste.
- **Courses** : liste par rayon, « en stock » signalé, validation du ticket, « Ranger les courses », « À racheter ».
- **Stock** : scan (caméra, photo, saisie, étiquettes QR maison), Open Food Facts, DLC/DDM, emplacements, prix par magasin avec historique (« plus cher que la dernière fois »), allergènes du foyer signalés, portions restantes, mode rangement (inventaire guidé), anti-gaspi (journal, statistiques sur six mois, euros gaspillés), étiquettes QR à imprimer.
- **Notifications** (Web Push, sans dépendance) : dates limites du jour, bilan hebdomadaire le dimanche, bilan mensuel en fin de cycle, objectifs à 80 % et 100 %. Heure et contenus réglables, par appareil.
- **Comptes et foyer** : inscription, connexion, code d'invitation (partageable par lien), membres, administrateur, changement de mot de passe.
- **Social** : mur du foyer (petits mots épinglables, notifiés aux autres membres), fil d'activité (qui a ajouté, jeté, cuisiné, dépensé), partage de la liste de courses, du menu et des recettes (texte ou lien public `/p/r/<id>` importable en un clic), lien vers la recette d'origine (Marmiton, 750g…) demandé dans le prompt et cliquable dans la fiche.

## Lancer en local

Node ≥ 22.13 (SQLite intégré, `node:sqlite`). Aucune installation.

```
npm start
# → http://127.0.0.1:3311  (API ouverte, base dans ./data/foyer.db)
```

Le serveur sert aussi les fichiers de l'app. Pour tester le rendu mobile, utilise l'émulation d'appareil du navigateur (380 px de large). La caméra exige HTTPS ou `localhost`.

Icônes : `icons/icon-1024.png` est le logo source (fond marine) ; les tailles 512, 192 et 180 (Apple) en sont dérivées. `npm run icons` régénère les anciennes icônes géométriques si besoin.

## Déployer sur le serveur (tartinou.pouximixi.fr)

nginx sert les fichiers statiques et relaie `/api/` vers le service Node (port 3311, données dans `/var/lib/foyer/` : `accounts.db` pour les comptes, `foyers/<id>.db` par foyer). Le code serveur (`FOYER_TOKEN` dans `/etc/foyer.env`) n'est demandé que pour créer un nouveau foyer après le premier ; rejoindre un foyer existant passe par son code d'invitation.

```
# 1. Fichiers
tar czf - --exclude=docs --exclude=data index.html styles.css app.js manifest.json sw.js README.md package.json js icons scripts server \
  | ssh -i ~/.ssh/pronote_ics_deploy root@100.105.207.97 'mkdir -p /var/www/life && tar xzf - -C /var/www/life && chown -R root:root /var/www/life'

# 2. Première installation seulement : service, code d'accès, nginx
ssh -i ~/.ssh/pronote_ics_deploy root@100.105.207.97 '
  mkdir -p /var/lib/foyer && chown www-data:www-data /var/lib/foyer
  [ -f /etc/foyer.env ] || echo "FOYER_TOKEN=$(node /var/www/life/server/index.js --make-token)" > /etc/foyer.env
  chmod 600 /etc/foyer.env
  cp /var/www/life/server/foyer.service /etc/systemd/system/foyer.service
  systemctl daemon-reload && systemctl enable --now foyer
  cp /var/www/life/server/nginx-life.conf /etc/nginx/sites-available/life && nginx -t && systemctl reload nginx
  cat /etc/foyer.env'

# 3. Mises à jour suivantes : étape 1, puis
ssh -i ~/.ssh/pronote_ics_deploy root@100.105.207.97 'systemctl restart foyer'
```

À chaque déploiement, incrémente `VERSION` dans `sw.js` pour que les appareils déjà installés récupèrent les nouveaux fichiers. Au premier lancement, l'app propose de **créer un compte** : le premier compte du serveur crée son foyer librement et reprend l'ancienne base unique `foyer.db` si elle existe. Un téléphone qui avait l'ancienne version 100 % locale envoie ses données au serveur si le foyer est vide.

Variables du serveur : `PORT` (3311), `HOST` (127.0.0.1), `FOYER_DB` (chemin de référence, les bases vivent à côté), `FOYER_TOKEN` (code serveur), `FOYER_INSCRIPTION=ouverte` pour laisser créer des foyers sans code, `FOYER_STATIC=0` pour ne servir que l'API (c'est le cas derrière nginx), `TZ_APP` (Europe/Paris) pour l'heure des notifications, `FOYER_PUSH_SUBJECT` (mailto: pour VAPID). Les clés VAPID sont générées au premier démarrage et gardées dans `accounts.db`.

## API

- `GET /api/health` : état du service (nombre de foyers, mode d'inscription, premier compte ou non).
- `POST /api/auth/register` `{ login, nom, password, codeInvitation | nomFoyer + codeServeur }`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password`.
- `GET /api/me` : compte, foyer (membres, code d'invitation pour l'administrateur), clé push et appareils abonnés.
- `POST /api/foyer` `{ nom }` ou `{ nouveauCode: true }` ; `DELETE /api/members/:id` (administrateur).
- `GET /api/state` : l'état complet du foyer (settings, categories, expenses, menus, promptForm, recettes, stock).
- `PUT /api/state` : corps `{ expenses: […], stock: {…} }` — chaque collection présente remplace la sienne, dans une transaction ; les autres appareils reçoivent un événement.
- `GET /api/events?token=…` : flux SSE des modifications du foyer.
- `GET /api/push/key`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `POST /api/push/test`.
- `POST /api/reset` : vide la base du foyer (administrateur).

Toutes les routes sauf `health` et `auth/*` exigent `Authorization: Bearer <jeton de session>`. Tables par foyer : `settings`, `charges_fixes`, `prompt_form`, `categories`, `expenses`, `menu_weeks`, `manual_items`, `recipes`, `stock_items`, `products`, `stock_journal`, `a_racheter`, `price_history`, `push_subscriptions`, `push_log` (voir `server/db.js`) ; comptes dans `accounts.db` (`foyers`, `users`, `sessions`, `push_config`).

## Stock alimentaire

Onglet **Stock** : scanner un code-barres (caméra, photo ou saisie), Open Food Facts remplit nom, marque, image et scores ; tu choisis l'emplacement (frigo, congélateur, placard) et la date limite. Détails du fonctionnement, des intégrations (Aujourd'hui, Menus, Courses) et des idées à venir dans [docs/PLAN-STOCK.md](docs/PLAN-STOCK.md).

Services externes : Open Food Facts (seul le code-barres est envoyé), jsDelivr pour le lecteur ZXing quand le navigateur n'a pas `BarcodeDetector`, images produit sur `images.openfoodfacts.org`.

## Sauvegarder ses données

Réglages → Sauvegarde → **Exporter mes données** télécharge `tartinou-AAAA-MM-JJ.json`. **Importer une sauvegarde** remplace tout (sur le serveur aussi) après confirmation. Le fichier contient un champ `version` : la fonction `migrate()` de `js/store.js` convertit les anciens formats. Pense aussi à sauvegarder `/var/lib/foyer/foyer.db` côté serveur.

## Règle du report sur un cycle partiellement suivi

Le max ajusté du jour vaut `(enveloppe − dépenses du cycle + dépenses du jour) / jours restants`. Si l'app a été installée (ou la première dépense saisie) en cours de cycle, seule la part de l'enveloppe qui couvre les jours suivis est prise en compte : `enveloppe × joursSuivis / joursDuCycle`. Sans cela, les jours non saisis seraient crédités comme des économies. Pour un cycle entièrement suivi, la formule est inchangée.

## Design

Une seule feuille de style, `styles.css`. Police système (aucune requête externe), fond papier et encre, un accent par domaine (budget ocre, cuisine vert), chiffres tabulaires, listes groupées à filets fins, feuilles basses pour la saisie. Thème clair et sombre suivent le système, ou se forcent dans les réglages. Pour vérifier un écran sur mobile sans téléphone : Chrome headless avec `Emulation.setDeviceMetricsOverride` (390 px, mobile), car la fenêtre headless refuse les largeurs sous 500 px.

## Structure

- `index.html`, `styles.css`, `app.js` (routeur, pastille de synchronisation) ; `manifest.json`, `sw.js`.
- `server/index.js` (HTTP, API, SSE, planificateur), `server/db.js` (schéma et lecture/écriture SQLite par foyer), `server/auth.js` (comptes, foyers, sessions), `server/webpush.js` (VAPID et chiffrement Web Push), `server/notify.js` (messages planifiés), `server/foyer.service`, `server/nginx-life.conf`.
- `js/store.js` : état, cache local, file d'attente, synchronisation et temps réel ; `js/api.js` : client HTTP et session ; `js/push.js` : abonnement aux notifications ; `js/finance.js` : récurrences, objectifs, relevés CSV ; `js/planning.js` : placer une recette dans la semaine ; `js/qr.js` : étiquettes QR.
- `js/budget.js` : `computeBudget()` alimente Aujourd'hui, Dépenses et le budget courses.
- `js/menu-schema.js` : validation stricte du JSON de menu et assemblage du prompt.
- `js/stock.js` : modèle du stock, dates limites, suggestions, journal ; `js/off.js` : Open Food Facts ; `js/scanner.js` : caméra et lecture des codes.
- `js/screens/` : un module par écran ; `js/components/` : jauge, feuille de saisie, dialogues, recette, stepper, fiche produit, « Ranger les courses », « Jeté ? », mode rangement, « J'ai cuisiné », « Que cuisiner ce soir ? ».
