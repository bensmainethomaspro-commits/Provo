/**
 * Un carnet de visite collé : un lieu par page, et tout ce qu'il en dit.
 *
 * Demandé le 14 novembre 2026, avec un carnet de Venise en PDF (33 pages :
 * catégorie et quartier, nom, adresse, présentation, horaires, prix, « bon à
 * savoir »). Le copier-coller de ce PDF arrive sous cette forme, page par page :
 *
 *   RESTAURANTS & BARS 18 / 33          ← en-tête, avec le compteur de pages
 *   Illustration : nero di seppia        ← légendes des photos
 *   La Strada Nova, à deux pas
 *   TRATTORIA · CANNAREGIO               ← catégorie · quartier
 *   Trattoria Ca'                        ← le nom, coupé par la mise en page
 *   d'Oro alla Vedova
 *   Ramo Ca' d'Oro 3912, Cannaregio      ← l'adresse
 *   Petit restaurant vénitien […]        ← la présentation
 *   HORAIRES
 *   Midi et soir
 *   Fermé le jeudi (à vérifier)
 *   PRIX
 *   25 - 40 €
 *   Bon à savoir · Réservation indispensable.
 *   Infos indicatives (nov. 2026), […]   ← pied de page, répété partout
 *
 * Un carnet écrit à la main ou par un assistant (titres « ## », libellés
 * « Horaires : … ») se lit aussi. Rien ne part sur le réseau : c'est du texte.
 * Et rien n'est deviné : ce qu'on ne sait pas lire reste du texte tel quel.
 */
import { categorieDuGenre } from '../../supabase/functions/_shared/lecture-lien.ts';

// ── Petits outils de texte ──────────────────────────────────────────────────

const net = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const sansAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Une ligne écrite tout en capitales (« TRATTORIA · CANNAREGIO »). */
function enCapitales(l) {
  const lettres = l.replace(/[^\p{L}]/gu, '');
  const capitales = lettres.replace(/[^\p{Lu}]/gu, '').length;
  // Une lettre sur dix peut sortir en minuscule d'un texte espacé mal décodé
  // (« CA N N A R e G I O ») ; une ligne normale en a bien plus.
  return lettres.length >= 3 && capitales >= lettres.length * 0.9 && l.length <= 64;
}

/**
 * « S A N P O LO » → « SANPOLO » : des capitales espacées lettre à lettre (un
 * texte en lettres espacées, copié depuis certains lecteurs de PDF). Les
 * espaces entre les mots sont perdus ; `orthographeDans` les retrouve.
 */
function sansEspacement(s) {
  const mots = net(s).split(' ');
  const courts = mots.filter(m => m.length <= 2).length;
  return mots.length >= 3 && courts / mots.length >= 0.6 ? mots.join('') : net(s);
}

/**
 * La graphie d'un mot collé (« SANPOLO ») telle qu'un autre texte de la page
 * l'écrit (« Ruga Rialto 973, San Polo » → « San Polo »). `null` sinon.
 */
function orthographeDans(colle, textes) {
  const cle = (m) => sansAccents(m).toLowerCase().replace(/[^a-z0-9]/g, '');
  const cible = cle(colle);
  if (cible.length < 3) return null;
  for (const t of textes) {
    const mots = net(t).split(' ');
    for (let i = 0; i < mots.length; i++) {
      let acc = '';
      for (let j = i; j < mots.length && acc.length < cible.length; j++) {
        acc += cle(mots[j]);
        if (acc === cible) return mots.slice(i, j + 1).join(' ').replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
      }
    }
  }
  return null;
}

const PETITS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'di', 'del', 'della', 'dei', 'da', 'à', 'au', 'aux', 'en', 'sur', 'y', 'e']);
/** « SAN POLO & GRAND CANAL » → « San Polo & Grand Canal ». */
export function casseDeTitre(s) {
  return net(s).toLocaleLowerCase('fr').split(' ').map((mot, i) => {
    if (i > 0 && PETITS.has(mot)) return mot;
    return mot.replace(/(^|[-'’])(\p{L})/gu, (_, sep, c) => sep + c.toLocaleUpperCase('fr'));
  }).join(' ');
}

/**
 * Des lignes coupées par la mise en page, recollées : « Basilique Saint- » +
 * « Marc » donne « Basilique Saint-Marc », « 7h30 - » + « 12h » donne
 * « 7h30 - 12h », mais « Lun-sam 9h30 - 17h15 » et « Dim 14h - 17h15 »
 * restent deux lignes.
 */
export function recoller(lignes) {
  const out = [];
  for (const brute of lignes) {
    const l = net(brute);
    if (!l) continue;
    const avant = out[out.length - 1];
    if (avant === undefined) { out.push(l); continue; }
    const ouvertes = (avant.match(/\(/g) || []).length - (avant.match(/\)/g) || []).length;
    const suite = /[-–,(&]$|(?:^|[\s'’])(?:et|à|de|du|des|en|ou|le|la|les|au|aux)$/iu.test(avant)
      || /^[-–(»&]/.test(l) || /^\p{Ll}/u.test(l) || ouvertes > 0 || l.length <= 5;
    if (!suite) { out.push(l); continue; }
    // « Saint-|Marc » se recolle sans espace ; « 7h30 -|12h » avec.
    out[out.length - 1] = /\p{L}-$/u.test(avant) ? avant + l : `${avant} ${l}`;
  }
  return out;
}

// ── Les horaires : en clair toujours, en format machine quand c'est sûr ─────

const JOURS_FR = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const JOURS_OSM = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const jourFr = (m) => JOURS_FR.indexOf(sansAccents(m).toLowerCase().slice(0, 3));

function heureOsm(h, min) {
  return `${String(h).padStart(2, '0')}:${String(min || 0).padStart(2, '0')}`;
}

/** « 9h30 - 17h15 et 19h - minuit » → « 09:30-17:15,19:00-24:00 », ou null. */
function creneauxOsm(texte) {
  const parties = texte.split(/\s*(?:,|\bet\b)\s*/i).filter(Boolean);
  const out = [];
  for (const p of parties) {
    const m = /^(\d{1,2})\s*[h:](\d{2})?\s*[-–à]\s*(?:(\d{1,2})\s*[h:](\d{2})?|minuit)$/i.exec(p.trim());
    if (!m) return null;
    const d = +m[1], fH = m[3] != null ? +m[3] : 24, fM = m[3] != null ? +(m[4] || 0) : 0;
    if (d > 24 || fH > 24 || +(m[2] || 0) > 59 || fM > 59) return null;
    out.push(`${heureOsm(d, m[2])}-${heureOsm(fH, fM)}`);
  }
  return out.length ? out.join(',') : null;
}

// Ce qui rend une ligne d'horaires approximative : la traduire en format
// machine ferait afficher « Fermé » à tort, ce qui est pire que de ne rien dire.
const FLOU = /≈|~|environ|variable|selon|vérifier|verifier|souvent|saison|dès|jusqu|conseill|en journée|en soirée|en semaine|midi|soir|matin|\(|sur réservation|rendez-vous/i;

/**
 * Les horaires d'un carnet, au format de la carte ouverte — seulement quand
 * chaque ligne se lit sans doute possible.
 *
 *   « Lun-sam 9h30 - 17h15 » + « Dim 14h - 17h15 » → « Mo-Sa 09:30-17:15; Su 14:00-17:15 »
 *   « Midi et soir » + « Fermé le jeudi (à vérifier) » → null
 */
export function horairesVersOsm(lignes) {
  const ls = (lignes || []).map(net).filter(Boolean);
  if (!ls.length) return null;
  if (ls.length === 1 && /^(?:accès libre |ouvert )?24\s*h\s*\/\s*24(?:\s*,?\s*7\s*j\s*\/\s*7)?$/i.test(ls[0])) return '24/7';
  const regles = [];
  const ouverts = new Set();
  const fermes = [];
  for (const l of ls) {
    if (/^derni(?:è|e)re? (?:entrée|accès|admission)/i.test(l) && !FLOU.test(l.replace(/^derni\S+ \S+/, ''))) continue;
    if (FLOU.test(l)) return null;
    const ferme = /^fermé(?:\s+le|\s+les)?\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?$/i.exec(l);
    if (ferme) { fermes.push(jourFr(ferme[1])); continue; }
    let jours = [0, 1, 2, 3, 4, 5, 6], reste = l;
    const tous = /^(?:tous les jours|tlj|7\s*j\s*\/\s*7)\s*[:,]?\s*(.*)$/i.exec(l);
    const plage = /^(lun\w*|mar\w*|mer\w*|jeu\w*|ven\w*|sam\w*|dim\w*)\.?(?:\s*(?:[-–]|au|à)\s*(lun\w*|mar\w*|mer\w*|jeu\w*|ven\w*|sam\w*|dim\w*)\.?)?\s*[:,]?\s*(.*)$/i.exec(l);
    if (tous) reste = tous[1];
    else if (plage) {
      const d = jourFr(plage[1]), f = plage[2] ? jourFr(plage[2]) : d;
      if (d < 0 || f < 0) return null;
      jours = [];
      for (let k = 0; k < 7; k++) { const i = (d + k) % 7; jours.push(i); if (i === f) break; }
      reste = plage[3];
    } else if (!/^\d/.test(l)) return null;
    const creneaux = creneauxOsm(reste);
    if (!creneaux) return null;
    jours.forEach(j => ouverts.add(j));
    const quand = jours.length === 7 ? 'Mo-Su'
      : jours.length === 1 ? JOURS_OSM[jours[0]] : `${JOURS_OSM[jours[0]]}-${JOURS_OSM[jours[jours.length - 1]]}`;
    regles.push(`${quand} ${creneaux}`);
  }
  // « Fermé le lundi » sous « Tous les jours 9h-18h » : le carnet se contredit.
  if (!regles.length || fermes.some(j => ouverts.has(j))) return null;
  return regles.join('; ');
}

/** Le premier montant en euros d'un texte de prix : « 25 - 40 € » → 25. */
export function montantDe(texte) {
  const m = /(\d+(?:[.,]\d{1,2})?)\s*(?:[-–]\s*\d+(?:[.,]\d{1,2})?\s*)?€/.exec(String(texte || ''));
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

// ── Catégorie et quartier ───────────────────────────────────────────────────

// Comparé sans accents et en minuscules : « ÎLE » est « ile ».
const GENRES_EN_PLUS = [
  [/\b(bacaro|cicchett|enoteca|bar a vin|caviste|gelateria|pasticceria|panificio|focacc|forno|pizza)/, 'resto'],
  [/\b(ile|isola|island|promenade|balade|marche|mercato|pont)\b/, 'balade'],
  [/\b(eglise|chiesa|scuola|basilica|duomo|campanile|theatre|teatro|opera|visite|galleri)/, 'visite'],
];

function categorieDe(type, section, titre = '') {
  // Le genre écrit (« OSTERIA »), sinon celui que dit le nom (« Musée… »,
  // « Trattoria… »), sinon la rubrique.
  for (const g of [type, titre]) {
    const t = net(g);
    if (!t) continue;
    const simple = sansAccents(t).toLowerCase();
    for (const [re, cat] of GENRES_EN_PLUS) if (re.test(simple)) return cat;
    const c = categorieDuGenre(t);
    if (c) return c;
  }
  const s = sansAccents(net(section)).toLowerCase();
  if (/restaurant|\bbars?\b|cafes?|tables?|manger|boire/.test(s)) return 'resto';
  if (/\biles?\b|balades?|promenades?/.test(s)) return 'balade';
  return 'visite';
}

// Ce qu'un en-tête de page dit de la rubrique, et pas du lieu.
// (Comparée sans accents.)
const RUBRIQUE = /^(?:(?:visites?|activites?|restaurants?|cafes?|bars?|bonnes adresses|a voir|a faire|sorties|sommaire(?: par secteur)?|&|et|,)\s*)+$/i;
// Un titre de carnet écrit à la main qui annonce une rubrique plutôt qu'un
// quartier : « ## Restaurants », « ### Où manger », « ## À voir ».
const TITRE_DE_RUBRIQUE = /\b(?:restaurants?|bars?|cafes?|manger|boire|visites?|musees?|a voir|a faire|activites?|sorties?|bonnes adresses|incontournables|plages?|balades?)\b/i;

// ── Le carnet en PDF, page par page ─────────────────────────────────────────

const COMPTEUR = /(?:^|\s)(\d{1,3})\s*\/\s*(\d{1,3})\s*$/;
const LIBELLE = {
  horaires: /^(?:horaires?|heures d'ouverture|ouverture)\s*:?$/i,
  prix: /^(?:prix|tarifs?|budget)\s*:?$/i,
};
const BON = /^(?:bon à savoir|à savoir|a savoir|conseil|astuce)\s*[·:–-]\s*(.*)$/i;

function pages(lignes) {
  const reperes = [];
  lignes.forEach((l, i) => {
    const m = COMPTEUR.exec(l);
    if (m) reperes.push({ i, n: +m[1], total: +m[2], avant: net(l.slice(0, m.index)) });
  });
  // Un vrai compteur de pages : le même total partout, des numéros qui montent.
  const total = reperes[0]?.total;
  const valides = reperes.filter(r => r.total === total && r.n >= 1 && r.n <= total);
  if (valides.length < 2 || valides.some((r, k) => k && r.n <= valides[k - 1].n)) return null;
  // Où commence chaque page : à son en-tête, sur la ligne du compteur ou juste
  // au-dessus quand l'extraction l'a mis à part.
  const reperees = valides.map(r => {
    if (r.avant) return { ...r, entete: r.avant, debut: r.i };
    let j = r.i - 1;
    while (j >= 0 && !net(lignes[j])) j--;
    return j >= 0 && enCapitales(net(lignes[j])) ? { ...r, entete: net(lignes[j]), debut: j } : { ...r, entete: '', debut: r.i };
  });
  return reperees.map((r, k) => ({
    entete: r.entete,
    corps: lignes.slice(r.i + 1, k + 1 < reperees.length ? reperees[k + 1].debut : lignes.length),
  }));
}

/** Les lignes répétées sur la plupart des pages : pieds de page, rappels. */
function repetees(listes) {
  const compte = new Map();
  for (const corps of listes) {
    for (const l of new Set(corps.map(net).filter(Boolean))) compte.set(l, (compte.get(l) || 0) + 1);
  }
  const seuil = Math.max(2, Math.ceil(listes.length * 0.4));
  return new Set([...compte].filter(([l, n]) => n >= seuil
    && !LIBELLE.horaires.test(l) && !LIBELLE.prix.test(l)).map(([l]) => l));
}

// Une phrase finie : la présentation en finit toujours une, l'adresse rarement.
const FIN_DE_PHRASE = /[.!?…]["»”)]?$/;

/**
 * Où commence la présentation, le paragraphe qui finit juste avant
 * « HORAIRES ». Une ligne en fait partie quand la précédente y mène : elle
 * commence par une minuscule, la précédente finit sur un tiret ou une
 * virgule, ou bien le premier mot n'aurait pas tenu sur la précédente — c'est
 * ce que fait une mise en page qui revient à la ligne. L'adresse, courte,
 * laissait la place au mot suivant : elle n'en est pas.
 *
 * @param {string[]} lignes la tête de la page, sans la catégorie
 * @param {number} largeur la largeur d'une ligne pleine de présentation
 * @returns {number} l'indice de la première ligne de la présentation
 *   (`lignes.length` s'il n'y en a pas)
 */
function debutDuParagraphe(lignes, largeur) {
  if (!lignes.length || !FIN_DE_PHRASE.test(lignes[lignes.length - 1])) return lignes.length;
  const marge = Math.max(3, Math.round(largeur * 0.12));
  let i = lignes.length - 1;
  while (i > 0) {
    const avant = lignes[i - 1], l = lignes[i];
    // Un mot composé se coupe à son tiret : « Gondole-|navette ».
    const mot = (/^[^\s-]*-?/.exec(l)[0] || '').length;
    const enchaine = /^\p{Ll}/u.test(l) || /[-–,;:(&]$/.test(avant) || largeur - avant.length <= mot + marge;
    if (!enchaine) break;
    i--;
  }
  return i;
}

/**
 * La largeur d'une ligne pleine de présentation, sur tout le carnet : celle
 * des lignes coupées au milieu d'une phrase (la suivante commence par une
 * minuscule). Le « bon à savoir », sur toute la page, est plus large : le
 * prendre pour mesure ferait passer chaque ligne pour courte.
 */
function largeurDeColonne(tetes) {
  const coupees = [];
  for (const t of tetes) {
    for (let k = 0; k + 1 < t.length; k++) {
      if (t[k].length >= 20 && /^\p{Ll}/u.test(t[k + 1])) coupees.push(t[k].length);
    }
  }
  if (coupees.length >= 3) {
    coupees.sort((a, b) => a - b);
    return coupees[Math.min(coupees.length - 1, Math.floor(coupees.length * 0.9))];
  }
  return Math.max(30, ...tetes.flat().map(l => l.length).filter(n => n <= 90));
}

/** Une page en lignes non vides, avec le bloc (entre deux lignes vides) de chacune. */
function enBlocs(corps) {
  const lignes = [], bloc = [];
  let b = 0, vide = true;
  for (const brute of corps) {
    const l = net(brute);
    if (!l) { if (!vide) b++; vide = true; continue; }
    lignes.push(l); bloc.push(b); vide = false;
  }
  return { lignes, bloc };
}

/** Où finit la tête (catégorie, nom, adresse, présentation) : au premier libellé. */
function finDeTete(lignes) {
  const i = lignes.findIndex(l => LIBELLE.horaires.test(l) || LIBELLE.prix.test(l) || BON.test(l));
  return i < 0 ? null : i;
}

/** La catégorie (« VISITE », « OSTERIA · CANNAREGIO ») : elle ferme les légendes de photos. */
const iCategorie = (tete) => tete.findIndex(enCapitales);

function lirePage({ entete, corps }, largeur) {
  const { lignes, bloc } = enBlocs(corps);
  const finTete = finDeTete(lignes);
  if (finTete === null) return null;
  const iSur = iCategorie(lignes.slice(0, finTete));
  const [type, quartierSur] = iSur >= 0 ? lignes[iSur].split(/\s*[·•|]\s*/).map(sansEspacement) : ['', ''];
  const apres = lignes.slice(iSur + 1, finTete);
  if (!apres.length) return null;

  // Nom, adresse, présentation.
  let nom, adresse = '', presentation;
  const blocsApres = [];
  apres.forEach((l, k) => {
    const b = bloc[iSur + 1 + k];
    if (k && b === bloc[iSur + k]) blocsApres[blocsApres.length - 1].push(l); else blocsApres.push([l]);
  });
  if (blocsApres.length >= 3) {
    // Extraction par blocs : le premier est le nom, celui d'avant la
    // présentation est l'adresse ; une légende de photo glissée entre les
    // deux est laissée de côté.
    nom = blocsApres[0];
    presentation = blocsApres[blocsApres.length - 1];
    adresse = net(blocsApres[blocsApres.length - 2].join(' '));
  } else {
    const d = debutDuParagraphe(apres, largeur);
    presentation = apres.slice(d);
    const avant = apres.slice(0, d);
    if (avant.length >= 2) { adresse = avant[avant.length - 1]; nom = avant.slice(0, -1); } else nom = avant;
    if (!nom.length) { nom = presentation.slice(0, 1); presentation = presentation.slice(1); }
  }
  const title = net(recoller(nom).join(' '));
  if (title.length < 2 || title.length > 90) return null;

  // Chaque champ va de son libellé au suivant (les pieds de page sont déjà ôtés).
  const bornes = lignes.map((l, i) => (LIBELLE.horaires.test(l) || LIBELLE.prix.test(l) || BON.test(l) ? i : -1))
    .filter(i => i >= 0).concat(lignes.length);
  const champ = (i) => lignes.slice(i + 1, Math.min(...bornes.filter(x => x > i)));
  const iH = lignes.findIndex(l => LIBELLE.horaires.test(l));
  const iP = lignes.findIndex(l => LIBELLE.prix.test(l));
  const iB = lignes.findIndex(l => BON.test(l));
  let brutsH = iH >= 0 ? champ(iH) : [];
  let brutsP = iP >= 0 ? champ(iP) : [];
  // « HORAIRES » puis « PRIX » sans rien entre eux : deux tuiles côte à côte,
  // lues titre après titre. Le premier bloc qui suit est aux horaires.
  if (iH >= 0 && iP === iH + 1 && !brutsH.length && brutsP.length) {
    const premier = bloc[iP + 1];
    const k = brutsP.findIndex((_, j) => bloc[iP + 1 + j] !== premier);
    if (k > 0) { brutsH = brutsP.slice(0, k); brutsP = brutsP.slice(k); }
  }
  const horaires = recoller(brutsH);
  const prix = recoller(brutsP);
  let bon = '';
  if (iB >= 0) {
    // Le « bon à savoir » est une phrase : il s'arrête à son point.
    const morceaux = [BON.exec(lignes[iB])[1]];
    for (const l of champ(iB)) {
      if (FIN_DE_PHRASE.test(morceaux[morceaux.length - 1])) break;
      morceaux.push(l);
    }
    bon = recollerTexte(morceaux.filter(Boolean));
  }

  const [section, quartierTete] = String(entete || '').split(/\s*[·•|]\s*/).map(sansEspacement);
  let quartier = net(quartierSur) || net(quartierTete)
    || (entete && !RUBRIQUE.test(sansAccents(net(section))) ? net(section) : '');
  // Une capitale espacée a perdu ses espaces : la page écrit souvent le
  // quartier ailleurs, dans l'adresse (« SANPOLO » → « San Polo »).
  if (quartier && !quartier.includes(' ')) {
    quartier = orthographeDans(quartier, [adresse, ...lignes.filter((_, i) => i !== iSur)]) || quartier;
  }
  const osm = horairesVersOsm(horaires);
  const montant = montantDe(prix[0]);

  return {
    title,
    category: categorieDe(type, section),
    ...(quartier ? { quartier: casseDeTitre(quartier) } : {}),
    ...(adresse ? { address: adresse } : {}),
    ...(presentation.length ? { description: recollerTexte(presentation) } : {}),
    ...(horaires.length ? { horairesTexte: horaires.join('\n') } : {}),
    ...(osm ? { openingHours: osm } : {}),
    ...(prix.length ? { prixTexte: prix.join('\n') } : {}),
    ...(montant != null ? { price: String(montant) } : {}),
    ...(bon ? { bonASavoir: bon } : {}),
  };
}

/** Un paragraphe : les lignes bout à bout, « chefs- » + « d'œuvre » recollé. */
function recollerTexte(lignes) {
  return lignes.reduce((t, l) => (!t ? l : /\p{L}-$/u.test(t) ? t + l : `${t} ${l}`), '')
    .replace(/«\s+/g, '« ').replace(/\s+»/g, ' »').replace(/\s+/g, ' ').trim();
}

function lireLesPages(lignes) {
  const ps = pages(lignes);
  if (!ps) return null;
  const bruit = repetees(ps.map(p => p.corps));
  const nettes = ps.map(p => ({ ...p, corps: p.corps.filter(l => !bruit.has(net(l))) }));
  const tetes = nettes.map(p => {
    const { lignes } = enBlocs(p.corps);
    const fin = finDeTete(lignes);
    return fin === null ? [] : lignes.slice(iCategorie(lignes.slice(0, fin)) + 1, fin);
  });
  const largeur = largeurDeColonne(tetes);
  return nettes.map(p => lirePage(p, largeur)).filter(Boolean);
}

// ── Un carnet écrit à la main : titres et libellés ──────────────────────────

const TITRE_MD = /^(#{1,4})\s+(.+?)\s*#*$/;
const TITRE_GRAS = /^\*\*([^*]{2,80})\*\*$/;
const TITRE_NUM = /^\d{1,2}[.)]\s+(\S.{1,80})$/;
const CHAMP = /^(?:[-*•]\s*)?(?:\*\*|__)?(horaires?|heures d'ouverture|ouverture|prix|tarifs?|budget|bon à savoir|à savoir|conseil|astuce|adresse|où|quartier|catégorie|type)(?:\*\*|__)?\s*[:·–-]\s*(?:\*\*|__)?\s*(.*)$/i;
const EMOJI = [[/^📍\s*/, 'adresse'], [/^(?:🕐|⏰|🕒)\s*/, 'horaires'], [/^(?:💶|💰|💵)\s*/, 'prix'], [/^(?:💡|ℹ️|ℹ)\s*/, 'bon']];

// Une confirmation de voyage a aussi des titres numérotés et des « Prix : » :
// elle se lit ailleurs (dates, heures, numéro de dossier), pas comme un carnet.
const RESERVATION = /\b(?:dossier|booking|confirmation|pnr|e-?ticket|e-?billet)\b/i;

function lireLesTitres(lignes) {
  if (lignes.some(l => RESERVATION.test(l))) return null;
  const titres = [];
  lignes.forEach((brute, i) => {
    const l = net(brute);
    const md = TITRE_MD.exec(l), gras = TITRE_GRAS.exec(l), num = TITRE_NUM.exec(l);
    if (md) titres.push({ i, niveau: md[1].length, texte: md[2] });
    else if (gras) titres.push({ i, niveau: 9, texte: gras[1] });
    else if (num) titres.push({ i, niveau: 10, texte: num[1] });
  });
  if (titres.length < 2) return null;
  const lieux = [];
  // Les titres sans rien dessous ouvrent un quartier ou une rubrique, valables
  // jusqu'au prochain titre de même niveau ou plus haut.
  let quartier = { texte: '', niveau: 99 }, rubrique = { texte: '', niveau: 99 };
  titres.forEach((t, k) => {
    const corps = lignes.slice(t.i + 1, k + 1 < titres.length ? titres[k + 1].i : lignes.length).map(net).filter(Boolean);
    const champs = {};
    let enCours = null;
    const libres = [];
    for (let l of corps) {
      l = l.replace(/^[-*•]\s+/, '').replace(/^_(.+)_$/, '$1').replace(/^\*(.+)\*$/, '$1');
      const c = CHAMP.exec(l);
      const e = EMOJI.find(([re]) => re.test(l));
      if (c || e) {
        const cle = c ? sansAccents(c[1]).toLowerCase() : e[1];
        enCours = /^(horaire|heures|ouverture)/.test(cle) ? 'horaires' : /^(prix|tarif|budget)/.test(cle) ? 'prix'
          : /^(adresse|ou)$/.test(cle) ? 'adresse' : /^(quartier)$/.test(cle) ? 'quartier'
            : /^(categorie|type)$/.test(cle) ? 'type' : 'bon';
        const valeur = c ? c[2] : l.replace(e[0], '');
        (champs[enCours] ||= []).push(...(valeur ? [valeur] : []));
        continue;
      }
      if (enCours && enCours !== 'adresse' && enCours !== 'quartier' && enCours !== 'type') { champs[enCours].push(l); continue; }
      enCours = null;
      libres.push(l);
    }
    const aDesChamps = champs.horaires || champs.prix || champs.bon || champs.adresse;
    if (!aDesChamps && !libres.length) {
      const ouvert = { texte: t.texte, niveau: t.niveau };
      if (TITRE_DE_RUBRIQUE.test(sansAccents(t.texte))) {
        rubrique = ouvert;
        if (quartier.niveau >= t.niveau) quartier = { texte: '', niveau: 99 };
      } else {
        quartier = ouvert;
        if (rubrique.niveau >= t.niveau) rubrique = { texte: '', niveau: 99 };
      }
      return;
    }
    if (!aDesChamps) return;
    let type = champs.type?.join(' ') || '';
    // « Visite · San Marco », « *Osteria — Cannaregio* » : catégorie et quartier.
    if (libres.length && /[·•—|]/.test(libres[0]) && libres[0].length <= 50) {
      const [a, b] = libres.shift().split(/\s*[·•—|]\s*/);
      type = type || a;
      if (b && !champs.quartier) champs.quartier = [b];
    }
    const title = net(t.texte.replace(/\*\*/g, ''));
    const horaires = (champs.horaires || []).flatMap(h => h.split(/\s*;\s*/)).map(net).filter(Boolean);
    const prix = champs.prix || [];
    const q = net(champs.quartier?.[0] || quartier.texte);
    lieux.push({
      title,
      category: categorieDe(type, rubrique.texte, title),
      ...(q ? { quartier: /\p{Ll}/u.test(q) ? q : casseDeTitre(q) } : {}),
      ...(champs.adresse?.length ? { address: net(champs.adresse.join(' ')) } : {}),
      ...(libres.length ? { description: net(libres.join(' ')) } : {}),
      ...(horaires.length ? { horairesTexte: horaires.join('\n') } : {}),
      ...(horairesVersOsm(horaires) ? { openingHours: horairesVersOsm(horaires) } : {}),
      ...(prix.length ? { prixTexte: prix.map(net).join('\n') } : {}),
      ...(montantDe(prix[0]) != null ? { price: String(montantDe(prix[0])) } : {}),
      ...(champs.bon?.length ? { bonASavoir: net(champs.bon.join(' ')) } : {}),
    });
  });
  return lieux;
}

/**
 * @param {string} texte le texte collé
 * @returns {{lieux: Array<object>}|null} les lieux du carnet, ou null si ce
 *   n'est pas un carnet (moins de deux lieux reconnus).
 */
export function lireCarnet(texte) {
  const brut = String(texte || '');
  if (brut.length < 60 || !brut.includes('\n')) return null;
  const lignes = brut.replace(/\r\n?/g, '\n').replace(/[\u00a0\u202f]/g, ' ').split('\n');
  const lieux = lireLesPages(lignes) || lireLesTitres(lignes) || [];
  // Deux pages pour un même lieu (une suite) : on garde la première.
  const vus = new Set();
  const uniques = lieux.filter(l => {
    const cle = sansAccents(l.title).toLowerCase();
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
  return uniques.length >= 2 ? { lieux: uniques } : null;
}
