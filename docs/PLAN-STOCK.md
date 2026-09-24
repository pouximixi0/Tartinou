# Tartinou · Stock alimentaire — plan détaillé

Objectif : savoir ce qu'il y a dans le frigo, le congélateur et les placards, sans effort de saisie (scan du code-barres), et s'en servir partout dans l'app (menus, courses, anti-gaspi).

## 1. Principes

- **Zéro friction** : scanner → une feuille pré-remplie → un bouton « Ajouter ». Trois gestes maximum.
- **Toujours une issue** : caméra, photo du code-barres, saisie au clavier, ajout à la main. Rien ne bloque.
- **Hors ligne d'abord** : les produits déjà scannés sont mémorisés localement ; sans réseau, on garde le code et on complète plus tard.
- **Le stock nourrit le reste** : l'écran Aujourd'hui alerte sur les dates limites, le prompt des menus connaît les placards, la liste de courses sait ce qui est déjà là, le ticket validé range les courses.

## 2. Livré dans cette version

### Écran « Stock » (nouvel onglet, accent cuisine)
- En-tête : nombre de produits, périmés, à consommer vite.
- Deux boutons : **Scanner un produit** (principal) et **Ajouter à la main**.
- Recherche instantanée, filtre par emplacement (Tous / Frigo / Congélateur / Placard / Autre, avec compteurs), tri (date limite, nom, ajout récent).
- Groupe « À consommer vite » en tête (périmés + sous le seuil d'alerte), puis un groupe par emplacement.
- Ligne produit : miniature Open Food Facts, nom, marque, conditionnement, badge de date coloré (rouge périmé, orange urgent, vert ok), stepper − / + sur la quantité.
- Quand la quantité tombe à zéro : « Consommé ou jeté ? » + case « à racheter ». Alimente le journal anti-gaspi.
- Zone « À racheter » : produits sous leur seuil ou ajoutés à la main ; « Ranger » (retour en stock) ou « Mettre dans la liste de courses ».
- Zone « Anti-gaspi » : ce mois-ci, produits consommés, jetés et valeur estimée ; journal complet.

### Scanner
- Caméra arrière plein écran avec cadre de visée, statut en clair, lampe torche si l'appareil le permet.
- Moteur natif `BarcodeDetector` (Chrome Android, Safari récent) ; sinon lecteur ZXing chargé depuis jsDelivr et mis en cache par le service worker.
- Mode **Ajouter** / **Retirer** : en mode Retirer, chaque scan retire une unité (la ligne dont la date est la plus proche d'abord).
- Scan continu : après un ajout, la caméra reprend pour le produit suivant (désactivable dans les réglages).
- Vibration + bip à la détection (réglables). Anti-rebond : un même code n'est pas relu pendant 2,5 s.
- Replis : **Photo** du code-barres (entrée fichier avec capture), **Saisie au clavier** des chiffres.

### Fiche produit (feuille)
- Recherche Open Food Facts lancée dès la détection : nom (fr), marque, conditionnement, image, Nutri-Score, NOVA, Éco-Score, allergènes, ingrédients, nutriments pour 100 g.
- Suggestion automatique de la catégorie et de l'emplacement (surgelés → congélateur, frais → frigo, sinon placard) à partir des catégories Open Food Facts.
- Quantité (stepper) et unité (pièces, g, kg, ml, L) ; emplacement (puces) ; date limite avec raccourcis (+3 j, +1 sem, +1 mois, +6 mois, sans) et bascule **DLC / DDM** (une DDM dépassée n'est pas « périmé », juste « souvent encore bon »).
- Plus d'options : catégorie, prix, seuil de réassort (stock minimum → passe automatiquement dans « À racheter »), notes.
- « Déjà en stock : 2 dans le frigo » → l'ajout fusionne avec la ligne existante (même code, même emplacement, même date).
- Produit inconnu : on saisit le nom une fois, il est mémorisé pour le prochain scan. Hors ligne : le code est gardé, « Réessayer » plus tard.
- En modification : Consommé (−1), Jeté, Ouvert aujourd'hui, À racheter, Supprimer.

### Intégrations
- **Aujourd'hui** : carte « 2 produits périmés · 3 à consommer avant jeudi » qui ouvre le stock.
- **Menus** : bouton « Remplir avec mon stock » dans « Ce que j'ai déjà » ; le prompt reçoit en plus la liste des produits à consommer en priorité.
- **Courses** : étiquette « en stock » sur les articles probablement déjà possédés ; après validation du ticket, feuille « Ranger les courses » (emplacement et date proposés par article) ; section « À racheter » visible même sans menu.
- **Réglages** : seuil d'alerte (jours), scan continu, vibration, son, vidage du cache produits.
- **Sauvegarde** : le stock est inclus dans l'export JSON (schéma v2, migration automatique).

## 3. Idées pour la suite (non livrées)

- Rappels : notification locale la veille d'une date limite (nécessite les notifications push ou un raccourci vers le calendrier).
- Recettes anti-gaspi : bouton « Que cuisiner avec ce qui périme ? » qui génère un prompt ciblé.
- Reconnaissance de la date limite par photo (OCR).
- Partage du stock entre plusieurs téléphones (synchronisation via un fichier ou un petit serveur).
- Historique de prix par produit et comparaison entre magasins.
- Codes-barres pour les produits maison (étiquettes QR à imprimer pour les bocaux et le congélateur).
- Statistiques : taux de gaspillage par catégorie, coût du gaspillage sur 12 mois, produits les plus consommés.
- Listes types (« courses de la semaine ») générées depuis les seuils de réassort.
- Décrémentation automatique quand une recette du menu est cuisinée (« J'ai cuisiné ce plat » → retire les ingrédients).

## 4. Modèle de données (`state.stock`)

```json
{
  "items": [{
    "id": "…", "code": "3017620422003", "nom": "Nutella", "marque": "Ferrero", "conditionnement": "400 g",
    "qte": 1, "unite": "piece", "emplacement": "placard", "categorie": "Épicerie sucrée",
    "dlc": "2027-03-01", "ddm": true, "ouvertLe": null, "ajouteLe": "2026-09-24",
    "prix": 3.2, "seuilMin": 0, "image": "https://…", "notes": ""
  }],
  "products": { "3017620422003": { "nom": "…", "marque": "…", "nutriscore": "e", "fetchedAt": 0 } },
  "journal": [{ "id": "…", "date": "2026-09-24", "type": "conso", "nom": "…", "qte": 1, "unite": "piece", "prix": 3.2 }],
  "aRacheter": [{ "id": "…", "nom": "…", "code": null, "qte": 1, "unite": "piece", "auto": false }]
}
```

Réglages : `settings.stock = { alertDays: 3, scanContinu: true, vibration: true, son: true }`.

## 5. Sources externes

- Open Food Facts : `https://world.openfoodfacts.org/api/v2/product/{code}.json` (base ouverte, sans clé). Seul le code-barres est envoyé.
- Lecteur de secours : `@zxing/browser` sur jsDelivr, chargé uniquement si le navigateur n'a pas `BarcodeDetector`.
- Images produit : `images.openfoodfacts.org`, mises en cache par le service worker.
