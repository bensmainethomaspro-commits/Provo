/**
 * Le quartier d'un lieu, et le rangement de la Réserve par quartier.
 *
 * Mesuré le 15 novembre 2026 (`scripts/diag-carnet.mjs`) : la carte ouverte
 * range le quartier dans un champ différent selon la ville.
 *
 *   Venise    neighbourhood = San Marco, Cannaregio…  suburb = Venezia-Murano-Burano (tous)
 *   Rome      quarter = Trastevere, Trevi…            suburb = Municipio Roma I (tous)
 *   Paris     suburb = Paris 6e Arrondissement        quarter = Quartier de l'Odéon (un par lieu)
 *   Vienne    suburb = Innere Stadt, Mariahilf        neighbourhood = Laimgrube
 *   Barcelone quarter = la Sagrada Família            suburb = l'Eixample
 *
 * Aucun champ n'est le bon partout. La fiche garde donc tous les niveaux
 * (`secteurs`), et le rangement choisit, pour CE voyage, celui qui le découpe
 * en quelques quartiers : ni un seul groupe (la ville entière), ni un groupe
 * par lieu. Un quartier écrit par la personne ou lu dans un carnet
 * (`quartier`) passe avant tout : c'est sa façon de découper la ville.
 */

export const NIVEAUX = ['neighbourhood', 'quarter', 'suburb', 'city_district'];

const net = (v) => String(v || '').trim();

/** Les niveaux de quartier d'une adresse Nominatim. */
export function secteursDe(adresse = {}) {
  const s = {};
  for (const k of NIVEAUX) if (net(adresse[k])) s[k] = net(adresse[k]);
  return Object.keys(s).length ? s : null;
}

/** Les mêmes, depuis Photon : `locality` est le quartier, `district` l'arrondissement. */
export function secteursDePhoton(p = {}) {
  const s = {};
  if (net(p.locality)) s.neighbourhood = net(p.locality);
  if (net(p.district)) s.suburb = net(p.district);
  return Object.keys(s).length ? s : null;
}

const cle = (v) => net(v).toLowerCase();

/**
 * Le niveau qui découpe ce voyage en quelques quartiers, et ceux qui ne le
 * découpent pas (une valeur partagée par la plupart des lieux : la ville).
 *
 * @param {Array<object>} fiches
 * @returns {{niveau: string|null, grossiers: Set<string>}}
 */
export function choisirNiveau(fiches) {
  const situees = (fiches || []).filter(f => f?.secteurs && !net(f.quartier));
  const n = situees.length;
  const grossiers = new Set();
  let meilleur = null, score = -Infinity;
  for (const k of NIVEAUX) {
    const valeurs = situees.map(f => cle(f.secteurs[k])).filter(Boolean);
    if (!valeurs.length) continue;
    const compte = new Map();
    for (const v of valeurs) compte.set(v, (compte.get(v) || 0) + 1);
    const plusFrequent = Math.max(...compte.values());
    // Une valeur que portent (presque) tous les lieux, c'est la ville : ce
    // niveau ne range rien (« Venezia-Murano-Burano », « Municipio Roma I »).
    // Neuf sur dix, pas deux sur trois : quatre idées dont trois à San Marco,
    // c'est un voyage centré sur San Marco, pas une ville.
    if (n >= 3 && plusFrequent / n >= 0.9) { grossiers.add(k); continue; }
    if (compte.size < 2) continue;
    // Un groupe par lieu ne range rien non plus (« Quartier de l'Odéon »,
    // « Place-Vendôme »…) — mais trois rioni pour quatre lieux, si.
    if (n >= 4 && compte.size / n > 0.8) continue;
    const couverture = valeurs.length / n;
    const s = couverture - 0.02 * Math.abs(compte.size - Math.sqrt(n));
    if (s > score) { score = s; meilleur = k; }
  }
  return { niveau: meilleur, grossiers };
}

/**
 * Le quartier d'une fiche, dans le découpage choisi pour le voyage.
 * Sans contexte (une fiche affichée seule), le niveau le plus local connu.
 */
export function quartierDe(fiche, { niveau = null, grossiers = new Set() } = {}) {
  if (!fiche) return '';
  if (net(fiche.quartier)) return net(fiche.quartier);
  const s = fiche.secteurs || {};
  if (niveau && net(s[niveau])) return net(s[niveau]);
  for (const k of NIVEAUX) if (!grossiers.has(k) && k !== niveau && net(s[k])) return net(s[k]);
  return '';
}

/**
 * Les fiches rangées par quartier : un groupe par quartier, dans l'ordre
 * alphabétique — on y cherche celui où l'on est —, les fiches sans quartier
 * à la fin.
 *
 * @returns {Array<{cle: string, quartier: string, items: object[]}>}
 */
export function rangerParQuartier(fiches, contexte = choisirNiveau(fiches)) {
  const groupes = new Map();
  for (const f of fiches || []) {
    const nom = quartierDe(f, contexte);
    const c = cle(nom) || '~';
    if (!groupes.has(c)) groupes.set(c, { cle: c, quartier: nom || 'Sans quartier', items: [] });
    groupes.get(c).items.push(f);
  }
  return [...groupes.values()].sort((x, y) => (x.cle === '~') - (y.cle === '~')
    || x.quartier.localeCompare(y.quartier, 'fr'));
}

/** Le rangement par quartier a-t-il un sens ? Au moins deux quartiers connus. */
export function rangementPossible(fiches, contexte = choisirNiveau(fiches)) {
  return rangerParQuartier(fiches, contexte).filter(g => g.cle !== '~').length >= 2;
}
