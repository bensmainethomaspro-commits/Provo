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

    if (!Object.keys(patch).length) return null;
    return { patch, apercu, source: r.source || 'inconnue', confiance: r.confiance || '' };
  });

  // La file avance même en cas d'échec, sinon une seule erreur la bloquerait
  // définitivement.
  file = suite.then(() => {}, () => {});
  return suite;
}
