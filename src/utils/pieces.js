/**
 * Les pièces jointes vivent À CÔTÉ du voyage, plus dedans.
 *
 * Photos de couverture, captures, billets en PDF : tout était rangé en base64
 * DANS l'objet voyage. Deux conséquences, mesurées :
 *  · le stockage local d'un navigateur tient 5,1 Mo, voyage compris ; trois
 *    billets suffisaient à ne plus rien pouvoir enregistrer ;
 *  · chaque synchronisation renvoyait le voyage entier, donc tous les billets,
 *    à chaque lettre tapée dans une note.
 *
 * Désormais une pièce lourde sort du voyage : elle est rangée dans IndexedDB
 * (des centaines de Mo, pas 5), et le voyage ne garde qu'une référence
 * `pj:<empreinte>`. L'empreinte est celle du CONTENU : deux téléphones qui
 * sortent la même photo écrivent la même référence, et la fusion n'y voit
 * aucun conflit. Le nuage garde une copie de chaque pièce (Supabase Storage,
 * dossier du voyage), d'où les autres téléphones la rapatrient.
 *
 * Tout ce qui est ici se lit sans navigateur (sauf IndexedDB, appelé à la
 * demande) : vérifié par `scripts/verif-pieces.mjs`.
 */

export const PREFIXE = 'pj:';
const REF = /^pj:[0-9a-f]{24}$/;
// Seulement ce que le dossier du nuage accepte : images d'appareil photo et
// PDF. Un SVG reste dans le voyage (il peut porter du script, et il est léger).
const DONNEE = /^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,/;
// Une vignette de quelques centaines d'octets ne vaut pas un aller-retour.
const SEUIL = 2048;

export const estRef = (v) => typeof v === 'string' && REF.test(v);
export const estDonneeLourde = (v) => typeof v === 'string' && v.length >= SEUIL && DONNEE.test(v);
export const idDe = (ref) => ref.slice(PREFIXE.length);

/**
 * Remplace chaque chaîne de l'arbre pour laquelle `f` rend autre chose.
 * Ne mute rien, et un sous-arbre inchangé garde son identité : la synchro
 * compare les objets, pas leur contenu.
 */
export function transformerChaines(o, f) {
  if (typeof o === 'string') return f(o);
  if (Array.isArray(o)) {
    let change = false;
    const r = o.map(x => { const y = transformerChaines(x, f); if (y !== x) change = true; return y; });
    return change ? r : o;
  }
  if (o && typeof o === 'object') {
    let change = false;
    const r = {};
    for (const [k, v] of Object.entries(o)) {
      const y = transformerChaines(v, f);
      if (y !== v) change = true;
      r[k] = y;
    }
    return change ? r : o;
  }
  return o;
}

/** Les chaînes de l'arbre qui passent `test`. */
function chaines(o, test, acc = []) {
  if (typeof o === 'string') { if (test(o)) acc.push(o); }
  else if (Array.isArray(o)) o.forEach(x => chaines(x, test, acc));
  else if (o && typeof o === 'object') Object.values(o).forEach(x => chaines(x, test, acc));
  return acc;
}

/** Vrai dès la première donnée lourde : le parcours s'arrête là. */
export function aDesDonnees(o) {
  if (typeof o === 'string') return estDonneeLourde(o);
  if (Array.isArray(o)) return o.some(aDesDonnees);
  if (o && typeof o === 'object') return Object.values(o).some(aDesDonnees);
  return false;
}

/** Les identifiants des pièces qu'un voyage référence. */
export const refsDe = (voyage) => new Set(chaines(voyage, estRef).map(idDe));

/** 24 caractères hexadécimaux de SHA-256 : l'identité d'un contenu. */
export async function empreinte(texte) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sort les données lourdes du voyage. Rend le voyage avec des références à
 * leur place (le même objet s'il n'y avait rien à sortir), et les pièces à
 * ranger. Ne range rien lui-même : c'est `stockerPieces`, et le voyage ne
 * doit être remplacé qu'APRÈS un rangement vérifié.
 */
export async function extrairePieces(voyage) {
  const donnees = [...new Set(chaines(voyage, estDonneeLourde))];
  if (!donnees.length) return { voyage, pieces: [] };
  const ids = new Map();
  for (const d of donnees) ids.set(d, await empreinte(d));
  return {
    voyage: transformerChaines(voyage, s => (ids.has(s) ? PREFIXE + ids.get(s) : s)),
    pieces: donnees.map(d => ({ id: ids.get(d), data: d })),
  };
}

/**
 * Ce qui part dans une copie envoyée à quelqu'un (« Envoyer une copie »).
 *
 * Les images voyagent, remises en clair (le destinataire n'a pas accès au
 * dossier du voyage). Les PAPIERS ne voyagent pas : billets et réservations
 * portent nom, numéro de dossier et code-barres, et la copie se lit par
 * simple lien. Une référence introuvable ici disparaît plutôt que de rester
 * cassée chez l'autre.
 *
 * `lire(id)` rend le contenu d'une pièce, ou rien.
 */
export async function pourUneCopie(voyage, lire) {
  const sansPapiers = {
    ...voyage,
    documents: [],
    days: (voyage.days || []).map(d => ({
      ...d, activities: (d.activities || []).map(a => (a.pdfs?.length ? { ...a, pdfs: [] } : a)),
    })),
    reserve: (voyage.reserve || []).map(a => (a.pdfs?.length ? { ...a, pdfs: [] } : a)),
  };
  const contenus = new Map();
  for (const id of refsDe(sansPapiers)) contenus.set(id, (await lire(id).catch(() => null)) || '');
  const copie = transformerChaines(sansPapiers, s => (estRef(s) ? contenus.get(idDe(s)) : s));
  // Une capture introuvable ne laisse pas un cadre vide.
  const sansVides = (a) => (a.screenshots?.some(x => !x) ? { ...a, screenshots: a.screenshots.filter(Boolean) } : a);
  return {
    ...copie,
    days: copie.days.map(d => ({ ...d, activities: d.activities.map(sansVides) })),
    reserve: copie.reserve.map(sansVides),
  };
}

// ── IndexedDB ────────────────────────────────────────────────────────────────
// Une base, un magasin : { data, envoyee: [idVoyage…] } sous l'identifiant.

const BASE = 'provo';
const MAGASIN = 'pieces';
let ouverture = null;

function base() {
  if (ouverture) return ouverture;
  ouverture = new Promise((ok, ko) => {
    if (typeof indexedDB === 'undefined') { ko(new Error('IndexedDB absent')); return; }
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.onblocked = () => ko(new Error('IndexedDB bloqué'));
  }).catch((e) => { ouverture = null; throw e; });
  return ouverture;
}

const attendre = (req) => new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });

async function lireEnregistrement(id) {
  const db = await base();
  return attendre(db.transaction(MAGASIN).objectStore(MAGASIN).get(id));
}

async function ecrireEnregistrement(id, valeur) {
  const db = await base();
  const tx = db.transaction(MAGASIN, 'readwrite');
  tx.objectStore(MAGASIN).put(valeur, id);
  await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error); });
}

// Ce qui a déjà été lu : une image affichée dix fois ne se relit pas dix fois.
const memoire = new Map();

export function pieceEnMemoire(id) {
  return memoire.get(id);
}

/** Le contenu d'une pièce, ou `undefined` si elle n'est pas (encore) sur ce téléphone. */
export async function lirePiece(id) {
  if (memoire.has(id)) return memoire.get(id);
  const e = await lireEnregistrement(id);
  if (e?.data) memoire.set(id, e.data);
  return e?.data;
}

/** L'enregistrement complet, pour la synchro (qui a été envoyé où). */
export const etatPiece = (id) => lireEnregistrement(id);

/**
 * Range des pièces, puis RELIT chacune : `true` seulement si toutes sont là,
 * intactes. Tant que ce n'est pas le cas, le voyage garde ses données.
 * `dejaEnvoyee` : les voyages dont le nuage a déjà la pièce (rapatriement).
 */
export async function stockerPieces(pieces, dejaEnvoyee = []) {
  for (const p of pieces) {
    const avant = await lireEnregistrement(p.id);
    if (avant?.data !== p.data) {
      await ecrireEnregistrement(p.id, { data: p.data, envoyee: [...new Set([...(avant?.envoyee || []), ...dejaEnvoyee])] });
    } else if (dejaEnvoyee.some(v => !avant.envoyee?.includes(v))) {
      await ecrireEnregistrement(p.id, { ...avant, envoyee: [...new Set([...(avant.envoyee || []), ...dejaEnvoyee])] });
    }
    const relu = await lireEnregistrement(p.id);
    if (relu?.data !== p.data) return false;
    memoire.set(p.id, p.data);
  }
  if (pieces.length) demanderPersistance();
  return true;
}

export async function marquerEnvoyee(id, idVoyage) {
  const e = await lireEnregistrement(id);
  if (!e || e.envoyee?.includes(idVoyage)) return;
  await ecrireEnregistrement(id, { ...e, envoyee: [...(e.envoyee || []), idVoyage] });
}

/** Une donnée tout juste saisie (photo, PDF) : rangée tout de suite, sa référence rendue. */
export async function enPiece(data) {
  if (!estDonneeLourde(data)) return data;
  try {
    const id = await empreinte(data);
    return (await stockerPieces([{ id, data }])) ? PREFIXE + id : data;
  } catch {
    // IndexedDB indisponible (navigation privée stricte) : comme avant, dans le voyage.
    return data;
  }
}

/** Les pièces que plus aucun voyage ne référence, et que le nuage garde. */
export async function oublierPiecesOrphelines(refsUtilisees, { memeNonEnvoyees = false } = {}) {
  const db = await base();
  const cles = await attendre(db.transaction(MAGASIN).objectStore(MAGASIN).getAllKeys());
  for (const id of cles) {
    if (refsUtilisees.has(id)) continue;
    const e = await lireEnregistrement(id);
    if (!memeNonEnvoyees && !e?.envoyee?.length) continue;
    const tx = db.transaction(MAGASIN, 'readwrite');
    tx.objectStore(MAGASIN).delete(id);
    await new Promise((ok) => { tx.oncomplete = ok; tx.onerror = ok; tx.onabort = ok; });
    memoire.delete(id);
  }
}

// Un stockage « au mieux » peut être vidé par le navigateur quand la place
// manque. Les billets du voyage ne sont pas un cache : on demande qu'il soit
// gardé. Le navigateur peut refuser ; on ne redemande pas à chaque pièce.
let persistanceDemandee = false;
function demanderPersistance() {
  if (persistanceDemandee) return;
  persistanceDemandee = true;
  globalThis.navigator?.storage?.persist?.().catch(() => {});
}

/** Prévient les écrans qu'une pièce vient d'arriver (rangée ou rapatriée). */
export const EVENEMENT = 'provo-pieces';
export function signalerPieces() {
  globalThis.dispatchEvent?.(new Event(EVENEMENT));
}

// ── Conversions ──────────────────────────────────────────────────────────────

export function versBlob(data) {
  const [entete, b64] = data.split(',');
  const type = /^data:([^;]+)/.exec(entete)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return new Blob([octets], { type });
}

export function depuisBlob(blob) {
  return new Promise((ok, ko) => {
    const l = new FileReader();
    l.onload = () => ok(l.result);
    l.onerror = () => ko(l.error);
    l.readAsDataURL(blob);
  });
}

/** Ouvre une pièce (ou une donnée en clair) dans le lecteur du téléphone. Rend `false` si elle manque. */
export async function ouvrirPiece(valeur) {
  const data = estRef(valeur) ? await lirePiece(idDe(valeur)).catch(() => undefined) : valeur;
  if (!data) return false;
  const url = URL.createObjectURL(versBlob(data));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
