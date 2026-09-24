// Base SQLite (node:sqlite, sans dépendance npm). Une table par entité.
// L'API lit l'état complet et écrit collection par collection, dans une transaction.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revenu_mensuel REAL NOT NULL DEFAULT 0,
  epargne_visee REAL NOT NULL DEFAULT 0,
  debut_mois INTEGER NOT NULL DEFAULT 1,
  part_courses REAL NOT NULL DEFAULT 40,
  budget_strict INTEGER NOT NULL DEFAULT 0,
  theme TEXT NOT NULL DEFAULT 'system',
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  stock_alert_days INTEGER NOT NULL DEFAULT 3,
  stock_scan_continu INTEGER NOT NULL DEFAULT 1,
  stock_vibration INTEGER NOT NULL DEFAULT 1,
  stock_son INTEGER NOT NULL DEFAULT 1,
  current_week_id TEXT,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS charges_fixes (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, montant REAL NOT NULL, jour_du_mois INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prompt_form (
  id INTEGER PRIMARY KEY CHECK (id = 1), personnes INTEGER NOT NULL DEFAULT 2, budget TEXT NOT NULL DEFAULT '', regime TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '', temps_max INTEGER NOT NULL DEFAULT 30, placards TEXT NOT NULL DEFAULT '', repas TEXT NOT NULL DEFAULT 'midi-soir-7'
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, couleur TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY, montant REAL NOT NULL, categorie_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE TABLE IF NOT EXISTS menu_weeks (
  id TEXT PRIMARY KEY, menu TEXT NOT NULL, imported_at INTEGER, budget_prevu REAL,
  checked TEXT NOT NULL DEFAULT '{}', unavailable TEXT NOT NULL DEFAULT '{}', validation TEXT, range_at TEXT, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS manual_items (
  id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES menu_weeks(id) ON DELETE CASCADE,
  article TEXT NOT NULL, quantite TEXT NOT NULL DEFAULT '', prix_estime REAL NOT NULL DEFAULT 0, rayon TEXT NOT NULL DEFAULT 'Autre', position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock_items (
  id TEXT PRIMARY KEY, code TEXT, nom TEXT NOT NULL, marque TEXT NOT NULL DEFAULT '', conditionnement TEXT NOT NULL DEFAULT '',
  qte REAL NOT NULL DEFAULT 1, unite TEXT NOT NULL DEFAULT 'piece', emplacement TEXT NOT NULL DEFAULT 'placard', categorie TEXT NOT NULL DEFAULT 'Autre',
  dlc TEXT, ddm INTEGER NOT NULL DEFAULT 0, ouvert_le TEXT, ajoute_le TEXT, prix REAL, seuil_min REAL NOT NULL DEFAULT 0,
  image TEXT, notes TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stock_code ON stock_items(code);
CREATE INDEX IF NOT EXISTS idx_stock_dlc ON stock_items(dlc);
CREATE TABLE IF NOT EXISTS products (
  code TEXT PRIMARY KEY, nom TEXT, marque TEXT, conditionnement TEXT, categorie TEXT, emplacement TEXT, image TEXT,
  nutriscore TEXT, nova INTEGER, ecoscore TEXT, allergenes TEXT, labels TEXT, ingredients TEXT, nutriments TEXT, source TEXT, fetched_at INTEGER
);
CREATE TABLE IF NOT EXISTS stock_journal (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, at INTEGER, type TEXT NOT NULL, nom TEXT NOT NULL, qte REAL NOT NULL,
  unite TEXT, prix REAL, code TEXT, categorie TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON stock_journal(date);
CREATE TABLE IF NOT EXISTS a_racheter (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, code TEXT, qte REAL NOT NULL DEFAULT 1, unite TEXT NOT NULL DEFAULT 'piece',
  auto INTEGER NOT NULL DEFAULT 0, ajoute_le TEXT, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY, code TEXT, nom TEXT NOT NULL, magasin TEXT, prix REAL NOT NULL, unite TEXT, date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_nom ON price_history(nom);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, temps INTEGER, tags TEXT, recette TEXT, ingredients TEXT, personnes INTEGER, ajoute_le TEXT, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, label TEXT, member TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS push_log (key TEXT PRIMARY KEY, sent_at INTEGER);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, auteur TEXT, texte TEXT NOT NULL, date TEXT NOT NULL, at INTEGER, epingle INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS push_config (id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT, private_key TEXT, subject TEXT);
`;

// Colonnes ajoutées après la v2.0 : on les crée si elles manquent (SQLite n'a pas de ADD COLUMN IF NOT EXISTS).
const COLUMNS = [
  ['settings', 'allergenes', "TEXT NOT NULL DEFAULT '[]'"],
  ['settings', 'objectifs', "TEXT NOT NULL DEFAULT '{}'"],
  ['settings', 'notif_actives', 'INTEGER NOT NULL DEFAULT 1'],
  ['settings', 'notif_heure', 'INTEGER NOT NULL DEFAULT 18'],
  ['settings', 'notif_dlc', 'INTEGER NOT NULL DEFAULT 1'],
  ['settings', 'notif_hebdo', 'INTEGER NOT NULL DEFAULT 1'],
  ['settings', 'notif_mensuel', 'INTEGER NOT NULL DEFAULT 1'],
  ['settings', 'notif_objectifs', 'INTEGER NOT NULL DEFAULT 1'],
  ['expenses', 'auteur', 'TEXT'],
  ['menu_weeks', 'cooked', "TEXT NOT NULL DEFAULT '{}'"],
  ['stock_items', 'magasin', 'TEXT'],
  ['stock_items', 'portions', 'REAL'],
  ['prompt_form', 'restes_dabord', 'INTEGER NOT NULL DEFAULT 0'],
  ['recipes', 'share_id', 'TEXT'],
  ['recipes', 'lien', 'TEXT'],
  ['stock_journal', 'auteur', 'TEXT'],
  ['settings', 'modules', "TEXT NOT NULL DEFAULT '{}'"],
];

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const int = (v, d = 0) => Math.trunc(num(v, d));
const str = (v, d = '') => (v == null ? d : String(v));
const nullable = (v) => (v == null || v === '' ? null : v);
const json = (v, d) => JSON.stringify(v == null ? d : v);
const parse = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const bool = (v) => (v ? 1 : 0);
const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  for (const [table, col, def] of COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  db.exec('INSERT OR IGNORE INTO settings (id) VALUES (1)');
  db.exec('INSERT OR IGNORE INTO prompt_form (id) VALUES (1)');
  db.exec('INSERT OR IGNORE INTO push_config (id) VALUES (1)');
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

/* ---------- Lecture : assemble l'état tel que le client l'attend ---------- */
export function readState(db) {
  const s = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const pf = db.prepare('SELECT * FROM prompt_form WHERE id = 1').get();
  const charges = db.prepare('SELECT * FROM charges_fixes ORDER BY position, rowid').all();
  const weeks = db.prepare('SELECT * FROM menu_weeks ORDER BY position, rowid').all();
  const manual = db.prepare('SELECT * FROM manual_items ORDER BY position, rowid').all();
  const byWeek = new Map();
  for (const m of manual) (byWeek.get(m.week_id) || byWeek.set(m.week_id, []).get(m.week_id)).push({ id: m.id, article: m.article, quantite: m.quantite, prix_estime: m.prix_estime, rayon: m.rayon });
  const products = {};
  for (const p of db.prepare('SELECT * FROM products').all()) {
    products[p.code] = {
      code: p.code, nom: p.nom || '', marque: p.marque || '', conditionnement: p.conditionnement || '', categorie: p.categorie || 'Autre', emplacement: p.emplacement || 'placard',
      image: p.image, nutriscore: p.nutriscore, nova: p.nova, ecoscore: p.ecoscore, allergenes: parse(p.allergenes, []), labels: parse(p.labels, []),
      ingredients: p.ingredients || '', nutriments: parse(p.nutriments, null), source: p.source || 'off', fetchedAt: p.fetched_at || 0,
    };
  }
  return {
    version: 2,
    settings: {
      revenuMensuel: s.revenu_mensuel, chargesFixes: charges.map((c) => ({ id: c.id, nom: c.nom, montant: c.montant, jourDuMois: c.jour_du_mois })),
      epargneVisee: s.epargne_visee, debutMois: s.debut_mois, partCourses: s.part_courses, budgetStrict: !!s.budget_strict,
      theme: s.theme, onboarded: !!s.onboarded, createdAt: s.created_at,
      stock: { alertDays: s.stock_alert_days, scanContinu: !!s.stock_scan_continu, vibration: !!s.stock_vibration, son: !!s.stock_son },
      allergenes: parse(s.allergenes, []),
      objectifs: parse(s.objectifs, {}),
      notifs: { actives: !!s.notif_actives, heure: s.notif_heure, dlc: !!s.notif_dlc, hebdo: !!s.notif_hebdo, mensuel: !!s.notif_mensuel, objectifs: !!s.notif_objectifs },
      modules: parse(s.modules, {}),
    },
    categories: db.prepare('SELECT * FROM categories ORDER BY position, rowid').all().map((c) => ({ id: c.id, nom: c.nom, couleur: c.couleur })),
    expenses: db.prepare('SELECT * FROM expenses ORDER BY date, created_at').all().map((e) => ({ id: e.id, montant: e.montant, categorieId: e.categorie_id, note: e.note, date: e.date, createdAt: e.created_at, auteur: e.auteur })),
    menus: {
      currentId: s.current_week_id,
      weeks: weeks.map((w) => ({
        id: w.id, menu: parse(w.menu, null), importedAt: w.imported_at, budgetPrevu: w.budget_prevu,
        checked: parse(w.checked, {}), unavailable: parse(w.unavailable, {}), manualItems: byWeek.get(w.id) || [], validation: parse(w.validation, null), rangeAt: w.range_at, cooked: parse(w.cooked, {}),
      })).filter((w) => w.menu),
    },
    promptForm: { personnes: pf.personnes, budget: pf.budget, regime: pf.regime, allergies: pf.allergies, tempsMax: pf.temps_max, placards: pf.placards, repas: pf.repas, restesDabord: !!pf.restes_dabord },
    recettes: db.prepare('SELECT * FROM recipes ORDER BY position, rowid').all().map((r) => ({ id: r.id, nom: r.nom, temps: r.temps, tags: parse(r.tags, []), recette: r.recette || '', ingredients: parse(r.ingredients, []), personnes: r.personnes, ajouteLe: r.ajoute_le, partage: r.share_id, lien: r.lien })),
    messages: db.prepare('SELECT * FROM messages ORDER BY position, rowid').all().map((m) => ({ id: m.id, auteur: m.auteur, texte: m.texte, date: m.date, at: m.at, epingle: !!m.epingle })),
    stock: {
      items: db.prepare('SELECT * FROM stock_items ORDER BY position, rowid').all().map((i) => ({
        id: i.id, code: i.code, nom: i.nom, marque: i.marque, conditionnement: i.conditionnement, qte: i.qte, unite: i.unite, emplacement: i.emplacement, categorie: i.categorie,
        dlc: i.dlc, ddm: !!i.ddm, ouvertLe: i.ouvert_le, ajouteLe: i.ajoute_le, prix: i.prix, seuilMin: i.seuil_min, image: i.image, notes: i.notes, magasin: i.magasin, portions: i.portions,
      })),
      products,
      journal: db.prepare('SELECT * FROM stock_journal ORDER BY at, rowid').all().map((j) => ({ id: j.id, date: j.date, at: j.at, type: j.type, nom: j.nom, qte: j.qte, unite: j.unite, prix: j.prix, code: j.code, categorie: j.categorie, auteur: j.auteur })),
      aRacheter: db.prepare('SELECT * FROM a_racheter ORDER BY position, rowid').all().map((r) => ({ id: r.id, nom: r.nom, code: r.code, qte: r.qte, unite: r.unite, auto: !!r.auto, ajouteLe: r.ajoute_le })),
      prixHistorique: db.prepare('SELECT * FROM price_history ORDER BY date, rowid').all().map((p) => ({ id: p.id, code: p.code, nom: p.nom, magasin: p.magasin, prix: p.prix, unite: p.unite, date: p.date })),
    },
  };
}

/* ---------- Écriture : chaque collection remplace son contenu ---------- */
const writers = {
  settings(db, s) {
    if (!s || typeof s !== 'object') throw new Error('settings invalide');
    const st = s.stock || {};
    const n = s.notifs || {};
    db.prepare(`UPDATE settings SET revenu_mensuel=?, epargne_visee=?, debut_mois=?, part_courses=?, budget_strict=?, theme=?, onboarded=?, created_at=?,
      stock_alert_days=?, stock_scan_continu=?, stock_vibration=?, stock_son=?, allergenes=?, objectifs=?,
      notif_actives=?, notif_heure=?, notif_dlc=?, notif_hebdo=?, notif_mensuel=?, notif_objectifs=?, modules=?, updated_at=? WHERE id = 1`)
      .run(num(s.revenuMensuel), num(s.epargneVisee), Math.min(31, Math.max(1, int(s.debutMois, 1))), num(s.partCourses, 40), bool(s.budgetStrict),
        ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system', bool(s.onboarded), nullable(str(s.createdAt)),
        Math.max(0, int(st.alertDays, 3)), bool(st.scanContinu ?? true), bool(st.vibration ?? true), bool(st.son ?? true),
        json(Array.isArray(s.allergenes) ? s.allergenes : [], []), json(s.objectifs && typeof s.objectifs === 'object' ? s.objectifs : {}, {}),
        bool(n.actives ?? true), Math.min(23, Math.max(0, int(n.heure, 18))), bool(n.dlc ?? true), bool(n.hebdo ?? true), bool(n.mensuel ?? true), bool(n.objectifs ?? true), json(s.modules && typeof s.modules === 'object' ? s.modules : {}, {}), Date.now());
    db.exec('DELETE FROM charges_fixes');
    const ins = db.prepare('INSERT INTO charges_fixes (id, nom, montant, jour_du_mois, position) VALUES (?, ?, ?, ?, ?)');
    (Array.isArray(s.chargesFixes) ? s.chargesFixes : []).forEach((c, i) => ins.run(str(c.id), str(c.nom), num(c.montant), int(c.jourDuMois, 1), i));
  },
  categories(db, list) {
    if (!Array.isArray(list)) throw new Error('categories invalide');
    db.exec('DELETE FROM categories');
    const ins = db.prepare('INSERT INTO categories (id, nom, couleur, position) VALUES (?, ?, ?, ?)');
    list.forEach((c, i) => ins.run(str(c.id), str(c.nom), str(c.couleur, '#64748B'), i));
  },
  expenses(db, list) {
    if (!Array.isArray(list)) throw new Error('expenses invalide');
    db.exec('DELETE FROM expenses');
    const ins = db.prepare('INSERT INTO expenses (id, montant, categorie_id, note, date, created_at, auteur) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const e of list) ins.run(str(e.id), num(e.montant), str(e.categorieId, 'autre'), str(e.note), str(e.date), nullable(int(e.createdAt, 0)) ?? null, nullable(str(e.auteur)));
  },
  menus(db, m) {
    if (!m || typeof m !== 'object') throw new Error('menus invalide');
    db.exec('DELETE FROM manual_items');
    db.exec('DELETE FROM menu_weeks');
    const insW = db.prepare('INSERT INTO menu_weeks (id, menu, imported_at, budget_prevu, checked, unavailable, validation, range_at, cooked, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insM = db.prepare('INSERT INTO manual_items (id, week_id, article, quantite, prix_estime, rayon, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
    (Array.isArray(m.weeks) ? m.weeks : []).forEach((w, i) => {
      insW.run(str(w.id), json(w.menu, {}), nullable(int(w.importedAt, 0)) ?? null, w.budgetPrevu == null ? null : num(w.budgetPrevu), json(w.checked, {}), json(w.unavailable, {}), w.validation ? json(w.validation) : null, nullable(str(w.rangeAt)), json(w.cooked, {}), i);
      (Array.isArray(w.manualItems) ? w.manualItems : []).forEach((x, k) => insM.run(str(x.id), str(w.id), str(x.article), str(x.quantite), num(x.prix_estime), str(x.rayon, 'Autre'), k));
    });
    db.prepare('UPDATE settings SET current_week_id = ? WHERE id = 1').run(nullable(str(m.currentId)));
  },
  promptForm(db, f) {
    if (!f || typeof f !== 'object') throw new Error('promptForm invalide');
    db.prepare('UPDATE prompt_form SET personnes=?, budget=?, regime=?, allergies=?, temps_max=?, placards=?, repas=?, restes_dabord=? WHERE id = 1')
      .run(Math.max(1, int(f.personnes, 2)), str(f.budget), str(f.regime), str(f.allergies), Math.max(5, int(f.tempsMax, 30)), str(f.placards), str(f.repas, 'midi-soir-7'), bool(f.restesDabord));
  },
  recettes(db, list) {
    if (!Array.isArray(list)) throw new Error('recettes invalide');
    db.exec('DELETE FROM recipes');
    const ins = db.prepare('INSERT INTO recipes (id, nom, temps, tags, recette, ingredients, personnes, ajoute_le, share_id, lien, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    list.forEach((r, i) => ins.run(str(r.id), str(r.nom, 'Recette'), int(r.temps, 0), json(r.tags, []), str(r.recette), json(r.ingredients, []), Math.max(1, int(r.personnes, 2)), nullable(str(r.ajouteLe)), nullable(str(r.partage)), nullable(str(r.lien)), i));
  },
  messages(db, list) {
    if (!Array.isArray(list)) throw new Error('messages invalide');
    db.exec('DELETE FROM messages');
    const ins = db.prepare('INSERT INTO messages (id, auteur, texte, date, at, epingle, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
    list.forEach((m, i) => ins.run(str(m.id), nullable(str(m.auteur)), str(m.texte).slice(0, 500), str(m.date), int(m.at, 0), bool(m.epingle), i));
  },
  stock(db, st) {
    if (!st || typeof st !== 'object') throw new Error('stock invalide');
    db.exec('DELETE FROM stock_items');
    const insI = db.prepare(`INSERT INTO stock_items (id, code, nom, marque, conditionnement, qte, unite, emplacement, categorie, dlc, ddm, ouvert_le, ajoute_le, prix, seuil_min, image, notes, magasin, portions, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    (Array.isArray(st.items) ? st.items : []).forEach((i, k) => insI.run(str(i.id), nullable(str(i.code)), str(i.nom, 'Produit'), str(i.marque), str(i.conditionnement), num(i.qte, 1), str(i.unite, 'piece'),
      str(i.emplacement, 'placard'), str(i.categorie, 'Autre'), nullable(str(i.dlc)), bool(i.ddm), nullable(str(i.ouvertLe)), nullable(str(i.ajouteLe)), numOrNull(i.prix), num(i.seuilMin), nullable(str(i.image)), str(i.notes), nullable(str(i.magasin)), numOrNull(i.portions), k));
    db.exec('DELETE FROM products');
    const insP = db.prepare(`INSERT INTO products (code, nom, marque, conditionnement, categorie, emplacement, image, nutriscore, nova, ecoscore, allergenes, labels, ingredients, nutriments, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [code, p] of Object.entries(st.products && typeof st.products === 'object' ? st.products : {})) {
      if (!p || typeof p !== 'object') continue;
      insP.run(str(code), str(p.nom), str(p.marque), str(p.conditionnement), str(p.categorie, 'Autre'), str(p.emplacement, 'placard'), nullable(str(p.image)), nullable(str(p.nutriscore)),
        p.nova == null ? null : int(p.nova), nullable(str(p.ecoscore)), json(p.allergenes, []), json(p.labels, []), str(p.ingredients), p.nutriments ? json(p.nutriments) : null, str(p.source, 'off'), int(p.fetchedAt, 0));
    }
    db.exec('DELETE FROM stock_journal');
    const insJ = db.prepare('INSERT INTO stock_journal (id, date, at, type, nom, qte, unite, prix, code, categorie, auteur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const j of Array.isArray(st.journal) ? st.journal : []) insJ.run(str(j.id), str(j.date), int(j.at, 0), str(j.type), str(j.nom), num(j.qte), nullable(str(j.unite)), numOrNull(j.prix), nullable(str(j.code)), nullable(str(j.categorie)), nullable(str(j.auteur)));
    db.exec('DELETE FROM a_racheter');
    const insR = db.prepare('INSERT INTO a_racheter (id, nom, code, qte, unite, auto, ajoute_le, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    (Array.isArray(st.aRacheter) ? st.aRacheter : []).forEach((r, k) => insR.run(str(r.id), str(r.nom), nullable(str(r.code)), num(r.qte, 1), str(r.unite, 'piece'), bool(r.auto), nullable(str(r.ajouteLe)), k));
    db.exec('DELETE FROM price_history');
    const insH = db.prepare('INSERT INTO price_history (id, code, nom, magasin, prix, unite, date) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const p of Array.isArray(st.prixHistorique) ? st.prixHistorique : []) insH.run(str(p.id), nullable(str(p.code)), str(p.nom), nullable(str(p.magasin)), num(p.prix), nullable(str(p.unite)), str(p.date));
  },
};

export const COLLECTIONS = Object.keys(writers);

/** Écrit les collections présentes dans `body` ({ expenses: […], stock: {…} }). Retourne les clés écrites. */
export function writeCollections(db, body) {
  const keys = COLLECTIONS.filter((k) => body[k] !== undefined);
  if (!keys.length) return [];
  transaction(db, () => { for (const k of keys) writers[k](db, body[k]); });
  return keys;
}

export function resetAll(db) {
  transaction(db, () => {
    for (const t of ['manual_items', 'menu_weeks', 'expenses', 'categories', 'charges_fixes', 'stock_items', 'products', 'stock_journal', 'a_racheter', 'price_history', 'recipes', 'messages', 'push_log']) db.exec(`DELETE FROM ${t}`);
    db.exec('DELETE FROM settings; DELETE FROM prompt_form; INSERT INTO settings (id) VALUES (1); INSERT INTO prompt_form (id) VALUES (1);');
  });
}

/* ---------- Messages et recettes publiques ---------- */
export const messageIds = (db) => new Set(db.prepare('SELECT id FROM messages').all().map((m) => m.id));
export const messageById = (db, id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null;
export function publicRecipe(db, shareId) {
  const r = db.prepare('SELECT * FROM recipes WHERE share_id = ?').get(shareId);
  return r ? { nom: r.nom, temps: r.temps, tags: parse(r.tags, []), recette: r.recette || '', ingredients: parse(r.ingredients, []), personnes: r.personnes, lien: r.lien || null } : null;
}

/* ---------- Membres (codes d'accès supplémentaires) ---------- */
export const listMembers = (db) => db.prepare('SELECT id, nom, created_at FROM members ORDER BY rowid').all().map((m) => ({ id: m.id, nom: m.nom, createdAt: m.created_at }));
export const memberByToken = (db, token) => db.prepare('SELECT id, nom FROM members WHERE token = ?').get(token) || null;
export const addMember = (db, id, nom, token) => db.prepare('INSERT INTO members (id, nom, token, created_at) VALUES (?, ?, ?, ?)').run(id, nom, token, Date.now());
export const removeMember = (db, id) => db.prepare('DELETE FROM members WHERE id = ?').run(id);

/* ---------- Notifications push ---------- */
export const pushConfig = (db) => db.prepare('SELECT * FROM push_config WHERE id = 1').get();
export const savePushConfig = (db, pub, priv, subject) => db.prepare('UPDATE push_config SET public_key = ?, private_key = ?, subject = ? WHERE id = 1').run(pub, priv, subject);
export const listSubscriptions = (db) => db.prepare('SELECT * FROM push_subscriptions ORDER BY rowid').all();
export function upsertSubscription(db, { id, endpoint, p256dh, auth, label, member }) {
  db.prepare('INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, label, member, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, member = excluded.member')
    .run(id, endpoint, p256dh, auth, label || null, member || null, Date.now());
}
export const removeSubscription = (db, endpoint) => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
export const pushLogHas = (db, key) => !!db.prepare('SELECT 1 FROM push_log WHERE key = ?').get(key);
export const pushLogSet = (db, key) => db.prepare('INSERT OR REPLACE INTO push_log (key, sent_at) VALUES (?, ?)').run(key, Date.now());
