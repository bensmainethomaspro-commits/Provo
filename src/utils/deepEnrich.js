import { supabase } from '../lib/supabase';

/**
 * Enrichissement approfondi : ce que le site du lieu dit et qu'aucune base
 * ouverte ne donne — horaires réels, gamme de prix, description.
 *
 * OpenStreetMap connaît bien les monuments, mal les commerces. Un café y aura
 * rarement ses horaires et jamais son ticket moyen. Or c'est précisément ce
 * qu'on veut savoir avant d'y aller, et ce que l'utilisateur ne doit pas avoir
 * à saisir (principe produit : aucune fiche ne doit être incomplète).
 *
 * Le navigateur ne peut pas lire un site tiers (CORS) : c'est la fonction Edge
 * `enrich-place` qui s'en charge. Rien n'est jamais appliqué ici — cette
 * couche ne fait que rapporter, la confirmation se fait en pop-up.
 */

// Une activité à la fois : ces recherches sont lentes et sollicitent un service
// payant. Rien ne justifie de les paralléliser.
let file = Promise.resolve();

/**
 * Une information n'est pas acquise une fois pour toutes : un restaurant
 * change ses horaires, un musée ses tarifs, un lieu ferme. L'enrichissement à
 * l'ajout ne suffit donc pas — il faut pouvoir repasser sur l'existant.
 *
 * L'empreinte évite de redemander la même chose : elle change si la fiche
 * change, et le délai fait rouvrir le dossier au bout d'un moment.
 */
export function signatureEnrich(a) {
  const c = (v) => (Number.isFinite(v) ? v.toFixed(4) : '-');
  return `${(a.title || '').trim().toLowerCase()}|${c(a.lat)}|${c(a.lon)}`;
}

// Trois semaines : assez pour qu'un horaire de saison ait changé, assez long
// pour ne pas rappeler un service payant sans raison.
const PEREMPTION_MS = 21 * 24 * 3600 * 1000;

function aRevoir(a, maintenant) {
  if (!a.enrichSig || a.enrichSig !== signatureEnrich(a)) return true;
  const t = Date.parse(a.enrichAt || '');
  return !Number.isFinite(t) || (maintenant - t) > PEREMPTION_MS;
}

/**
 * Les fiches qui gagneraient à être fouillées : il leur manque quelque chose,
 * et on ne l'a pas déjà cherché récemment. Aucune requête — c'est du tri local.
 *
 * @returns {Array<{activite, emplacement, ou}>}
 */
export function aEnrichir(trip, maintenant = Date.now()) {
  const out = [];
  const prendre = (a, emplacement, ou) => {
    if (!estEnrichissable(a)) return;
    if (!manquePourEnrichir(a).length) return;
    if (!aRevoir(a, maintenant)) return;
    out.push({ activite: a, emplacement, ou });
  };
  (trip?.days || []).forEach((d, i) =>
    (d.activities || []).forEach(a => prendre(a, { type: 'day', dayId: d.id }, `Jour ${i + 1}`)));
  (trip?.reserve || []).forEach(a => prendre(a, { type: 'reserve' }, 'Réserve'));
  return out;
}

export function estEnrichissable(a) {
  // Un repas générique n'a pas de site. Un lieu sans nom exploitable non plus.
  return !!a && !a.isMeal && (a.title || '').trim().length >= 3;
}

/** Ce qui manque encore à la fiche, et que cette recherche peut apporter. */
export function manquePourEnrichir(a) {
  const m = [];
  if (!a.openingHours) m.push('horaires');
  const sansPrix = a.price === '' || a.price == null || parseFloat(a.price) === 0;
  if (sansPrix) m.push('prix');
  if (!(a.description || '').trim()) m.push('description');
  return m;
}

async function appeler(activite) {
  const { data, error } = await supabase.functions.invoke('enrich-place', {
    body: {
      name: activite.title,
      address: activite.address || '',
      lat: activite.lat ?? null,
      lon: activite.lon ?? null,
      website: activite.link || '',
      category: activite.category || '',
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Interroge le site du lieu et rend ce qu'il faudrait ajouter — sans rien
 * modifier.
 *
 * @returns {Promise<{patch: object, apercu: object, source: string}|null>}
 *   null quand il n'y a rien à proposer.
 */
export function enrichirEnProfondeur(activite) {
  const suite = file.then(async () => {
    if (!estEnrichissable(activite)) return null;
    let r;
    try {
      r = await appeler(activite);
    } catch {
      // Hors ligne, ou fonction non déployée : ce n'est pas « rien trouvé »,
      // c'est « pas maintenant ». On ne marque donc rien comme vérifié.
      return null;
    }
    if (!r) return null;

    const patch = {}, apercu = {};

    // On ne remplit que les trous : ce que l'utilisateur a saisi lui-même
    // n'est jamais écrasé, même par une source plus récente.
    if (!activite.openingHours && r.horaires) {
      patch.openingHours = r.horaires;
      apercu.horaires = r.horaires;
    }

    const sansPrix = activite.price === '' || activite.price == null
      || parseFloat(activite.price) === 0;
    if (sansPrix && Number.isFinite(r.prixMin)) {
      // Le budget se calcule sur un nombre : on retient le bas de la
      // fourchette, qui est l'engagement minimal, et on montre la fourchette
      // complète pour que le choix soit éclairé.
      patch.price = String(r.prixMin);
      apercu.prix = Number.isFinite(r.prixMax) && r.prixMax > r.prixMin
        ? `${r.prixMin} – ${r.prixMax} ${r.devise || '€'}`
        : `${r.prixMin} ${r.devise || '€'}`;
    }

    if (!(activite.description || '').trim() && r.description) {
      patch.description = r.description;
      apercu.description = r.description;
    }

    if (!activite.link && r.site) {
      patch.link = r.site;
      apercu.site = r.site;
    }

    // La photo que l'établissement a choisie pour se représenter. Une vignette
    // Wikipédia donne l'immeuble, parfois rien — inutilisable pour un café.
    // Elle se confirme comme le reste : une image hors sujet se remarque tout
    // de suite, mais c'est à l'utilisateur de le dire.
    if (!activite.photoUrl && r.photo) {
      patch.photoUrl = r.photo;
      apercu.photo = r.photo;
    }

    // L'empreinte est posée que la proposition soit acceptée ou laissée : dans
    // les deux cas on a cherché, et on ne veut pas rechercher demain.
    const marque = { enrichSig: signatureEnrich(activite), enrichAt: new Date().toISOString() };
    if (!Object.keys(patch).length) return { patch: null, marque };
    return {
      patch: { ...patch, ...marque },
      marque,
      apercu,
      source: r.source || 'inconnue',
      confiance: r.confiance || '',
    };
  });

  // La file avance même en cas d'échec, sinon une seule erreur la bloquerait
  // définitivement.
  file = suite.then(() => {}, () => {});
  return suite;
}

/**
 * Repasse sur plusieurs fiches. Lent par construction — une requête à la fois,
 * et le modèle prend son temps — d'où `onProgres` pour que l'écran le montre.
 *
 * @returns {Promise<{propositions: Array, marques: Array}>}
 *   `marques` : les fiches fouillées sans rien à proposer. Rien à montrer,
 *   mais il faut s'en souvenir, sinon on redépensera pour le même vide.
 */
export async function fouillerLesFiches(liste, { onProgres, arret } = {}) {
  const propositions = [], marques = [];
  for (let i = 0; i < liste.length; i++) {
    if (arret?.aborted) break;
    const { activite, emplacement, ou } = liste[i];
    onProgres?.({ fait: i, total: liste.length, titre: activite.title });
    const r = await enrichirEnProfondeur(activite);
    // Réseau coupé ou fonction absente : on ne marque rien, on réessaiera.
    if (!r) continue;
    if (!r.patch) { marques.push({ id: activite.id, emplacement, patch: r.marque }); continue; }
    propositions.push({ id: activite.id, emplacement, titre: activite.title, ou, ...r });
  }
  onProgres?.({ fait: liste.length, total: liste.length, titre: null });
  return { propositions, marques };
}
