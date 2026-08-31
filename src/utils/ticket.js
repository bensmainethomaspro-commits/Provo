/**
 * Ce qu'un ticket de caisse dit, lu dans le texte qu'en tire l'OCR.
 *
 * Séparé de l'OCR lui-même, et pur : c'est la partie qui décide, donc celle
 * qui doit être vérifiable sans navigateur et sans image. `scripts/verif-ticket.mjs`
 * la fige sur des tickets réels, avec les fautes de lecture qui vont avec.
 *
 * LE MONTANT EST LA SEULE CHOSE QUI COMPTE VRAIMENT. Le reste — commerce,
 * date, catégorie — se corrige d'un regard ; un montant faux se découvre à la
 * fin du voyage, quand plus personne ne se souvient. D'où la règle tenue
 * partout ici : **au moindre doute, on rend `confiance: 'basse'` et le client
 * fait relire**, et quand rien n'est lisible on ne rend rien du tout.
 */

// Un OCR confond régulièrement O/0, l/1, S/5 sur les tickets thermiques. On ne
// « corrige » PAS les chiffres — inventer un 0 à la place d'un O dans un montant
// serait exactement la faute à ne pas commettre. On ne normalise que la
// ponctuation et les espaces, où il n'y a rien à perdre.
const normaliser = (t) => String(t || '')
  // Espaces insécables : l'OCR en rend dans les milliers (« 1 240,00 »).
  // Écrits en clair ils passeraient pour de vrais espaces — d'où les codes.
  .replace(/[\u00A0\u202F\u2007\u2009]/g, ' ')
  .replace(/[’´`]/g, "'")
  .replace(/[—–]/g, '-')
  .split(/\r?\n/)
  .map((l) => l.replace(/[ \t]+/g, ' ').trim())
  .filter(Boolean);

// « 47,80 », « 47.80 », « 1 234,50 ». Deux décimales exigées : sur un ticket,
// un nombre sans décimale est presque toujours une quantité, un code TVA ou
// une heure — pas un prix.
const MONTANT = /(?:^|[^\d,.])(\d{1,3}(?:[ .]\d{3})*|\d+)[,.](\d{2})(?!\d)/g;

/** Tous les montants d'une ligne, dans l'ordre où ils s'y trouvent. */
function montantsDe(ligne) {
  const out = [];
  for (const m of ligne.matchAll(MONTANT)) {
    const entier = m[1].replace(/[ .]/g, '');
    const v = parseFloat(`${entier}.${m[2]}`);
    // Un ticket au-delà de 100 000 n'existe pas ; au-delà, c'est un numéro.
    if (Number.isFinite(v) && v > 0 && v < 100000) out.push(v);
  }
  return out;
}

// Les mots qui annoncent le total. Classés : « net à payer » l'emporte sur
// « total », qui l'emporte sur « montant » — un ticket porte souvent les trois,
// et seul le dernier est ce qu'on a réellement payé.
const MOTS_TOTAL = [
  [/\bnet\s*a\s*payer\b|\bnet\s*à\s*payer\b|\ba\s*payer\b|\bà\s*payer\b|\bamount\s*due\b/i, 3],
  [/\btotal\s*(?:ttc|t\.t\.c)\b|\btotal\s*eur\b|\bmontant\s*ttc\b/i, 3],
  [/\btotal\b|\bsomme\b|\bgesamt\b|\bimporte\b/i, 2],
  [/\bmontant\b|\bamount\b/i, 1],
];

// Ce qu'on ne doit JAMAIS prendre pour un total, même si le mot « total » y est.
const PIEGES = /\bsous[\s-]*total\b|\bsubtotal\b|\btva\b|\bt\.v\.a\b|\bvat\b|\bdont\b|\bremise\b|\brendu\b|\bmonnaie\b|\bespece|\bcarte\b|\bcb\b/i;

const DEVISES = [
  [/€|\beur\b|\beuro/i, 'EUR'],
  [/\$|\busd\b|\bdollar/i, 'USD'],
  [/£|\bgbp\b|\blivre/i, 'GBP'],
  [/\bchf\b|\bfr\.?\s*s\b/i, 'CHF'],
];

/** La devise, quand le ticket la porte. Jamais devinée depuis le pays. */
export function lireDevise(texte) {
  for (const [motif, code] of DEVISES) if (motif.test(texte)) return code;
  return '';
}

/**
 * Le montant payé.
 *
 * Deux chemins, dans cet ordre :
 *  1. une ligne qui ANNONCE le total (« Net à payer », « TOTAL TTC ») — c'est
 *     le ticket lui-même qui le désigne, et c'est de loin le plus sûr ;
 *  2. à défaut, le plus grand montant du ticket. Sur un ticket de caisse, le
 *     total est presque toujours le plus grand nombre — mais « presque »
 *     suffit à abaisser la confiance.
 *
 * Rend `null` quand aucun montant n'est lisible : mieux vaut un champ vide
 * qu'un chiffre pris au hasard.
 */
export function lireMontant(lignes) {
  let meilleur = null, rang = 0;
  for (const ligne of lignes) {
    if (PIEGES.test(ligne)) continue;
    for (const [motif, poids] of MOTS_TOTAL) {
      if (!motif.test(ligne)) continue;
      const m = montantsDe(ligne);
      if (!m.length) break;
      // Le DERNIER montant de la ligne : « TOTAL 3 articles 47,80 » se lit de
      // gauche à droite, et c'est le prix qui ferme la ligne.
      const v = m[m.length - 1];
      // À poids égal, la dernière annonce du ticket gagne : les caisses
      // impriment le total définitif en bas.
      if (poids >= rang) { meilleur = v; rang = poids; }
      break;
    }
  }
  if (meilleur !== null) return { montant: meilleur, sur: rang >= 2 };

  const tous = lignes.filter((l) => !PIEGES.test(l)).flatMap(montantsDe);
  if (!tous.length) return { montant: null, sur: false };
  return { montant: Math.max(...tous), sur: false };
}

/**
 * Le nom du commerce : la première ligne qui ressemble à une enseigne.
 *
 * En haut du ticket, avant les prix. On écarte ce qui est manifestement une
 * adresse, un numéro ou une date — et on ne rend rien plutôt qu'une ligne au
 * hasard, parce qu'un mauvais nom se recopie dans le carnet de comptes.
 */
export function lireCommerce(lignes) {
  for (const ligne of lignes.slice(0, 6)) {
    // Un bandeau décoratif n'est pas une enseigne. « *** TICKET *** » devenait
    // « TICKET » une fois les étoiles retirées, et passait pour un nom de
    // commerce : on écarte la ligne entière plutôt que de la nettoyer.
    if (/[*=_~-]{3,}/.test(ligne)) continue;
    const l = ligne.replace(/[*=_~-]{2,}/g, ' ').trim();
    if (l.length < 3 || l.length > 40) continue;
    if (montantsDe(l).length) continue;
    // Une adresse, un téléphone, un SIRET, une date : pas une enseigne.
    if (/\d{4,}/.test(l)) continue;
    if (/^\d/.test(l)) continue;
    if (/\b(rue|avenue|bd|boulevard|place|str|street|tel|tél|siret|tva)\b/i.test(l)) continue;
    // Au moins deux lettres à la suite : « *** » ou « # 12 » ne sont pas un nom.
    if (!/\p{L}{2,}/u.test(l)) continue;
    return l.slice(0, 40);
  }
  return '';
}

/** La date du ticket, au format du jour. Vide si elle n'est pas lisible. */
export function lireDateTicket(lignes) {
  const t = lignes.join('\n');
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Sur un ticket, le format est presque toujours JJ/MM/AAAA — une caisse
  // française n'imprime pas l'ordre américain. On ne le suppose que là.
  const fr = t.match(/\b(\d{2})[/.](\d{2})[/.](20\d{2}|\d{2})\b/);
  if (fr) {
    const an = fr[3].length === 2 ? `20${fr[3]}` : fr[3];
    const mois = +fr[2], jour = +fr[1];
    if (mois >= 1 && mois <= 12 && jour >= 1 && jour <= 31) {
      return `${an}-${fr[2]}-${fr[1]}`;
    }
  }
  return '';
}

const CATEGORIES = [
  ['repas', /\brestaurant\b|\bbrasserie\b|\bpizz|\bburger\b|\bcouvert|\bmenu\b|\bplat\b|\btrattoria\b/i],
  ['verre', /\bbar\b|\bbi[eè]re\b|\bcaf[ée]\b|\bpub\b|\bcocktail\b|\bvin\b/i],
  ['transport', /\btaxi\b|\buber\b|\bp[ée]age\b|\bcarburant\b|\bessence\b|\bmetro\b|\bticket\s*t\b|\bsncf\b/i],
  ['hebergement', /\bh[ôo]tel\b|\bnuit[ée]e\b|\bchambre\b|\bauberge\b/i],
  ['shopping', /\bboutique\b|\bmagasin\b|\bsupermarch|\bcarrefour\b|\bmonoprix\b|\bpharmacie\b/i],
];

/** À quoi le ticket ressemble. « autre » quand rien ne le dit. */
export function lireCategorieTicket(texte) {
  for (const [nom, motif] of CATEGORIES) if (motif.test(texte)) return nom;
  return 'autre';
}

/**
 * Un ticket lu → ce qu'on propose de remplir.
 *
 * `confiance: 'basse'` dès que le montant n'a pas été DÉSIGNÉ par le ticket
 * lui-même. Le formulaire l'affiche, et rien n'est enregistré sans accord.
 */
export function lireTicketTexte(texteBrut) {
  const lignes = normaliser(texteBrut);
  if (!lignes.length) return { error: 'illisible' };

  const { montant, sur } = lireMontant(lignes);
  if (montant === null) return { error: 'illisible' };

  const texte = lignes.join('\n');
  return {
    ok: true,
    montant,
    devise: lireDevise(texte) || 'EUR',
    commerce: lireCommerce(lignes),
    date: lireDateTicket(lignes),
    categorie: lireCategorieTicket(texte),
    confiance: sur ? 'haute' : 'basse',
  };
}
