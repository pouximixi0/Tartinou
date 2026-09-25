// RappelConso (DGCCRF, data.economie.gouv.fr) : rappels de produits, cherchés par
// code-barres (GTIN). Ouvert, sans clé. Le serveur vérifie les codes du stock de
// chaque foyer et prévient les membres quand un nouveau rappel concerne un produit.
const API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso-v2-gtin-trie/records';
const FIELDS = 'gtin,numero_fiche,libelle,marque_produit,motif_rappel,risques_encourus,conduites_a_tenir_par_le_consommateur,date_publication,lien_vers_la_fiche_rappel,date_de_fin_de_la_procedure_de_rappel,distributeurs,zone_geographique_de_vente';

const clean = (s) => String(s || '').trim();
const split = (s) => clean(s).split('|').map((x) => x.trim()).filter(Boolean);

function normalize(r) {
  return {
    gtin: String(r.gtin || ''),
    numero: clean(r.numero_fiche) || String(r.gtin),
    libelle: clean(r.libelle),
    marque: clean(r.marque_produit),
    motif: clean(r.motif_rappel),
    risques: clean(r.risques_encourus),
    conduite: split(r.conduites_a_tenir_par_le_consommateur),
    distributeurs: split(r.distributeurs),
    zone: clean(r.zone_geographique_de_vente),
    date: clean(r.date_publication).slice(0, 10),
    fin: clean(r.date_de_fin_de_la_procedure_de_rappel).slice(0, 10) || null,
    lien: clean(r.lien_vers_la_fiche_rappel),
  };
}

/** Rappels publiés pour ces codes-barres (par paquets de 40, le filtre est numérique). */
export async function fetchRecalls(gtins) {
  const codes = [...new Set(gtins.map((c) => String(c || '').replace(/\D/g, '')).filter((c) => c.length >= 8 && c.length <= 14))];
  const out = [];
  for (let i = 0; i < codes.length; i += 40) {
    const chunk = codes.slice(i, i + 40);
    const params = new URLSearchParams({ where: `gtin IN (${chunk.map(Number).join(', ')})`, select: FIELDS, limit: '100', order_by: 'date_publication desc' });
    const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`RappelConso répond ${res.status}`);
    const data = await res.json();
    for (const r of data.results || []) out.push(normalize(r));
  }
  return out;
}
