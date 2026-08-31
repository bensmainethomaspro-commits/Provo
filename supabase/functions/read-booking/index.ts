// Provo — « read-booking »
//
// Lit une confirmation de réservation collée telle quelle — courriel d'hôtel,
// billet de train, confirmation de vol ou de restaurant — et en rend une fiche.
//
// Pourquoi : c'est du travail de saisie pur. La confirmation contient déjà le
// lieu, la date, l'heure et la référence ; les retaper dans un formulaire,
// c'est exactement ce que le principe du produit veut éviter. On colle, l'app
// remplit.
//
// SANS MODÈLE, ET SANS RIEN INVENTER. Une confirmation n'est pas de la prose :
// c'est un formulaire déguisé. « Check-in : 12/09/2026 à 15:00 », « Référence :
// XK7P2Q », « Adresse : 4 Philharmoniker Str. » — des étiquettes et des
// valeurs, écrites pour être lues vite par un humain pressé. Des règles les
// lisent aussi bien, gratuitement et instantanément.
//
// Ce qu'elle ne fait PAS : décider, ni deviner. Un champ qu'elle n'a pas lu
// reste vide, et `confiance: "basse"` dès qu'elle a dû trancher. Le client
// montre la fiche et rien n'est enregistré sans accord — une fausse date se
// découvre le jour du départ.
//
// Vérifié par `scripts/verif-reservation.mjs`, sur des confirmations réelles.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { origineAutorisee } from "../_shared/origine.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Une confirmation tient largement là-dedans. Au-delà, c'est qu'on colle autre
// chose.
const TAILLE_MAX = 20000;
const TAILLE_MIN = 60;

// ── Les mois, dans les deux langues qu'on rencontre ─────────────────────────
const MOIS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1,
  fevrier: 2, "février": 2, fevr: 2, feb: 2, february: 2,
  mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juillet: 7, juil: 7, jul: 7, july: 7,
  aout: 8, "août": 8, aug: 8, august: 8,
  septembre: 9, sept: 9, sep: 9, september: 9,
  octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11,
  decembre: 12, "décembre": 12, dec: 12, "déc": 12, december: 12,
};

const sansAccent = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const jj = (n: number) => String(n).padStart(2, "0");

/**
 * L'année quand la confirmation ne la donne pas.
 *
 * Une réservation est presque toujours à venir. Si la date tombée cette année
 * est déjà loin derrière, c'est l'année prochaine qu'on vise — mais on le dit :
 * une année devinée fait partie de ce qui doit être relu.
 */
function anneeProbable(mois: number, jour: number, aujourdhui: Date): number {
  const an = aujourdhui.getFullYear();
  const candidate = new Date(an, mois - 1, jour);
  const marge = new Date(aujourdhui);
  marge.setDate(marge.getDate() - 30);
  return candidate < marge ? an + 1 : an;
}

/**
 * La date de début, dans le premier format reconnu.
 *
 * Rend aussi `sur`, qui vaut faux dès qu'il a fallu trancher : un format
 * jour/mois indistinct de mois/jour, ou une année absente.
 */
export function lireDate(texte: string, aujourdhui = new Date()): { date: string; sur: boolean } {
  const t = sansAccent(texte);

  // 1 · ISO : sans ambiguïté possible, c'est celui qu'on préfère.
  const iso = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const [, a, m, j] = iso;
    if (+m >= 1 && +m <= 12 && +j >= 1 && +j <= 31) {
      return { date: `${a}-${jj(+m)}-${jj(+j)}`, sur: true };
    }
  }

  // 2 · « 12 septembre 2026 », « ven. 12 sept. 2026 », « September 12, 2026 ».
  // Du plus LONG au plus court : une alternation prend le premier qui marche,
  // et « sept » l'emportait sur « september » — le nom passait, l'année qui le
  // suivait tombait à côté, et la date se retrouvait « à relire » sans raison.
  const nomsMois = Object.keys(MOIS).map((m) => sansAccent(m))
    .sort((a, b) => b.length - a.length).join("|");
  const enLettres = t.match(
    new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${nomsMois})\\.?\\s*(20\\d{2})?`))
    || t.match(new RegExp(`\\b(${nomsMois})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d{2})?`));
  if (enLettres) {
    // Selon la forme trouvée, le jour est en 1 ou en 2.
    const jour = /^\d/.test(enLettres[1]) ? +enLettres[1] : +enLettres[2];
    const mois = MOIS[/^\d/.test(enLettres[1]) ? enLettres[2] : enLettres[1]];
    const an = enLettres[3] ? +enLettres[3] : anneeProbable(mois, jour, aujourdhui);
    if (mois && jour >= 1 && jour <= 31) {
      return { date: `${an}-${jj(mois)}-${jj(jour)}`, sur: Boolean(enLettres[3]) };
    }
  }

  // 3 · « 12/09/2026 ». C'est le cas piégeux : 09/12 se lit dans les deux sens.
  //     Quand un des deux nombres dépasse 12, il ne peut être que le jour et
  //     tout est levé ; sinon on prend l'ordre français — l'app est en français
  //     — et on prévient que ce n'est pas sûr.
  const chiffres = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2}|\d{2})\b/);
  if (chiffres) {
    const [, a1, a2, a3] = chiffres;
    const an = a3.length === 2 ? 2000 + +a3 : +a3;
    let jour = +a1, mois = +a2, sur = false;
    if (+a1 > 12 && +a2 <= 12) { jour = +a1; mois = +a2; sur = true; }
    else if (+a2 > 12 && +a1 <= 12) { jour = +a2; mois = +a1; sur = true; }
    if (mois >= 1 && mois <= 12 && jour >= 1 && jour <= 31) {
      return { date: `${an}-${jj(mois)}-${jj(jour)}`, sur };
    }
  }

  return { date: "", sur: false };
}

/**
 * L'heure de début et, si elle est donnée, celle de fin.
 *
 * Les deux se suivent presque toujours sur la même ligne, séparées par un
 * tiret, une flèche ou « à » : « 14:30 – 16:05 », « 20h00 à 22h ».
 */
export function lireHeures(texte: string): { heure: string; fin: string } {
  const t = texte.replace(/\s+/g, " ");
  const MOTIF = /\b([01]?\d|2[0-3])\s*(?:[:h.]\s*([0-5]\d)?)\s*(am|pm|AM|PM)?/g;
  const trouvees: string[] = [];
  for (const m of t.matchAll(MOTIF)) {
    let h = +m[1];
    const min = m[2] || "00";
    const ampm = (m[3] || "").toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h > 23) continue;
    // Une année ou un prix ne sont pas des heures : le motif exige déjà « h »
    // ou « : », mais « 2026.09 » y ressemblerait sans cette garde.
    const avant = t.slice(Math.max(0, m.index! - 1), m.index!);
    if (/\d/.test(avant)) continue;
    trouvees.push(`${jj(h)}:${min}`);
    if (trouvees.length >= 2) break;
  }
  return { heure: trouvees[0] || "", fin: trouvees[1] || "" };
}

/** Le numéro de dossier, quand une étiquette l'annonce. */
export function lireReference(texte: string): string {
  const MOTIF =
    /(?:r[ée]f[ée]rence|confirmation|r[ée]servation|booking|dossier|pnr|billet|n[°o]\.?)\s*(?:de\s+\w+\s*)?[:#]?\s*([A-Z0-9][A-Z0-9-]{4,19})\b/gi;
  // TOUTES les étiquettes, pas la première : « Votre billet de train » ouvrait
  // le motif et ramassait le mot suivant, ce qui masquait le vrai « Dossier :
  // TR88201 » trois lignes plus bas.
  for (const m of texte.matchAll(MOTIF)) {
    const ref = m[1].toUpperCase();
    // Une référence porte au moins un chiffre : sans ça on ramasse le mot qui
    // suit l'étiquette (« Réservation : CONFIRMÉE »).
    if (/\d/.test(ref)) return ref.slice(0, 40);
  }
  return "";
}

/** L'adresse postale, quand une étiquette l'annonce ou qu'une ligne y ressemble. */
export function lireAdresse(texte: string): string {
  const etiquette = texte.match(/(?:adresse|address)\s*[:.]?\s*(.{6,160})/i);
  if (etiquette) return etiquette[1].split(/\s{2,}|[\n\r]|(?: · )/)[0].trim().slice(0, 160);
  for (const ligne of texte.split(/[\n\r]+/)) {
    const l = ligne.trim();
    if (l.length < 8 || l.length > 160) continue;
    // Un numéro puis un mot de voie : la forme d'une adresse dans toutes les
    // langues qu'on croise.
    if (/^\d{1,4}[a-z]?[ ,]/i.test(l)
      || /\b\d{1,4}[ ,].{0,40}\b(rue|avenue|boulevard|place|chemin|str(?:a[sß]e)?|street|road|allee|gasse|weg)\b/i.test(l)
      // Ailleurs qu'en France, la voie précède le numéro (« Wollzeile 5 ») et
      // c'est le code postal qui signe la ligne.
      || /^[A-ZÀ-Ý][\wÀ-ÿ'’-]+\s+\d{1,4}[a-z]?,\s*\d{4,5}\b/.test(l)) {
      return l.slice(0, 160);
    }
  }
  return "";
}

const CATEGORIES: [string, RegExp][] = [
  ["trajet", /\b(vol|flight|a[ée]roport|airport|embarquement|boarding|train|billet\s+de\s+train|gare|wagon|voiture\s+n|bus|autocar|ferry|location\s+de\s+voiture|car\s+rental)\b/i],
  ["repos", /\b(h[ôo]tel|hotel|auberge|hostel|chambre|room|check[\s-]?in|check[\s-]?out|nuit[ée]e|logement|appartement|airbnb|s[ée]jour)\b/i],
  ["resto", /\b(restaurant|table|couverts|d[îi]ner|d[ée]jeuner|brunch|r[ée]servation\s+pour\s+\d+\s+personnes)\b/i],
  ["visite", /\b(mus[ée]e|museum|visite|guided\s+tour|exposition|billet\s+d['’]entr[ée]e|monument|ch[âa]teau)\b/i],
  ["fun", /\b(concert|spectacle|th[éeè][âa]tre|op[ée]ra|match|festival|parc\s+d['’]attraction)\b/i],
];

/** À quoi on a affaire. « autre » quand rien ne le dit — pas de devinette. */
export function lireCategorie(texte: string): string {
  for (const [nom, motif] of CATEGORIES) if (motif.test(texte)) return nom;
  return "autre";
}

/**
 * Le nom de l'établissement, et le titre qu'on écrira sur la fiche.
 *
 * Trois prises, de la plus sûre à la plus faible : le nom qui suit « Hôtel » ou
 * « Restaurant », un trajet « CDG → VIE », puis la première ligne du texte —
 * c'est presque toujours l'en-tête de la confirmation.
 */
export function lireLieuEtTitre(texte: string, categorie: string): { lieu: string; titre: string; sur: boolean } {
  const propre = (s: string) =>
    s.replace(/[|•·–—]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

  // Le type de lieu s'écrit avec une majuscule en tête de courriel (« Hôtel
  // Sacher »), le nom qui suit en porte une aussi — mais on ne peut pas poser
  // le drapeau `i` sur toute l'expression sans perdre ce second repère, qui est
  // justement ce qui distingue un nom propre du reste de la phrase.
  const nomme = texte.match(
    // Espaces et tabulations seulement, jamais de retour à la ligne : « \s »
    // franchissait la fin de ligne et collait le premier mot de la phrase
    // suivante au nom du lieu (« Hôtel Sacher Wien Votre »).
    /\b([Hh][ôo]tel|[Hh]otel|[Aa]uberge|[Rr]estaurant|[Mm]us[ée]e|[Tt]h[éeè][âa]tre|[Oo]p[ée]ra|[Cc]h[âa]teau)[ \t]+([A-ZÀ-Ý][\wÀ-ÿ'’-]*(?:[ \t]+[A-ZÀ-Ý][\wÀ-ÿ'’-]*){0,3})/);
  if (nomme) {
    const lieu = propre(`${nomme[1]} ${nomme[2]}`);
    return { lieu, titre: lieu, sur: true };
  }

  // Un trajet se lit sur SA ligne, et on garde le premier mot propre de chaque
  // côté de la flèche : « Paris Gare de Lyon → Vienne Hbf » donne
  // « Paris → Vienne ». Prendre le dernier mot avant la flèche rendait
  // « Lyon → Vienne » — le nom de la gare, pas celui de la ville.
  if (categorie === "trajet") {
    for (const ligne of texte.split(/[\n\r]+/)) {
      const bords = ligne.split(/\s*(?:→|->|>|–|—|\bvers\b|\bto\b)\s*/);
      if (bords.length !== 2) continue;
      const mot = (c: string) =>
        (c.trim().match(/[A-ZÀ-Ý][\wÀ-ÿ'’-]{1,20}|\b[A-Z]{3}\b/) || [""])[0];
      const de = mot(bords[0]), vers = mot(bords[1]);
      if (de && vers) {
        return { lieu: propre(vers), titre: propre(`${de} → ${vers}`), sur: true };
      }
    }
  }

  // Dernier recours : la première ligne qui ressemble à un titre. Marquée
  // « pas sûre » — c'est une position, pas une lecture.
  for (const ligne of texte.split(/[\n\r]+/)) {
    const l = propre(ligne);
    if (l.length >= 3 && l.length <= 70 && /[A-Za-zÀ-ÿ]/.test(l)
      && !/^(bonjour|madame|monsieur|cher|dear|hello|objet|subject|de\s*:|from\s*:)/i.test(l)) {
      return { lieu: "", titre: l, sur: false };
    }
  }
  return { lieu: "", titre: "", sur: false };
}

/**
 * Une confirmation collée → une fiche.
 *
 * `confiance: "basse"` dès qu'un seul morceau a demandé de trancher : c'est le
 * signal que le client affiche pour faire relire avant d'enregistrer.
 */
export function lireReservation(texte: string, aujourdhui = new Date()) {
  const categorie = lireCategorie(texte);
  const d = lireDate(texte, aujourdhui);
  const { heure, fin } = lireHeures(texte);
  const { lieu, titre, sur: surLeNom } = lireLieuEtTitre(texte, categorie);

  if (!titre && !lieu) return { erreur: "pas_une_reservation" };

  return {
    titre: titre || lieu,
    lieu,
    adresse: lireAdresse(texte),
    date: d.date,
    heure,
    fin,
    reference: lireReference(texte),
    categorie,
    // Pas de date lue, ou une date/un nom devinés : ça se relit.
    confiance: d.date && d.sur && surLeNom ? "haute" : "basse",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // Cette fonction ne coûte plus rien depuis qu'elle lit par règles. Le
  // contrôle d'origine reste : elle reçoit du texte collé par quelqu'un, et
  // rien n'oblige à offrir ce service à tous les sites du web.
  if (!origineAutorisee(req)) return json({ error: "origine_refusee" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const texte = typeof body?.texte === "string" ? body.texte.trim() : "";
  if (texte.length < TAILLE_MIN) return json({ error: "texte_trop_court" }, 400);
  if (texte.length > TAILLE_MAX) return json({ error: "texte_trop_long" }, 413);

  const lu = lireReservation(texte.slice(0, TAILLE_MAX));
  // Sans titre ni lieu, il n'y a rien d'utilisable : le dire vaut mieux que de
  // rendre une fiche vide que l'utilisateur devra remplir lui-même.
  if ("erreur" in lu) return json({ error: lu.erreur }, 200);
  return json({ ok: true, ...lu }, 200);
});
