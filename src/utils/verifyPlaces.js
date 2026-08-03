import { distKm, lookupPlace, missingFieldsFrom } from './enrich';

/**
 * Contrôle des lieux d'un voyage.
 *
 * Un géocodeur se trompe : « Vienna state opera » ressort parfois à Opera, en
 * Italie. L'erreur ne se voit pas dans une liste — elle se découvre sur la
 * carte, ou pire, sur place. Ce module la débusque avant.
 *
 * Deux temps, délibérément séparés :
 *
 *   1. `analyserVoyage` — hors ligne, instantané, gratuit. Il repère ce qui
 *      cloche par pure géométrie : un lieu à 800 km du voyage n'est pas le bon.
 *   2. `chercherCorrections` — en ligne, lent, poli. Il ne part que sur demande
 *      et seulement pour ce que le premier a signalé.
 *
 * Rien n'est jamais appliqué d'office : la fonction rend des propositions,
 * l'utilisateur tranche (principe produit — force de proposition, en pop-up).
 */

// Un voyage tient rarement dans plus de 150 km autour de sa destination. Au
// delà on ne conclut pas à l'erreur, on demande.
const SEUIL_KM = 150;

const geolocalisee = (a) => Number.isFinite(a?.lat) && Number.isFinite(a?.lon);
// Un repas n'est pas un lieu : il n'a ni adresse ni horaires à corriger.
const verifiable = (a) => a && !a.isMeal && (a.title || '').trim().length >= 3;

/**
 * Empreinte de ce qui a été vérifié.
 *
 * Chercher en ligne coûte une seconde par lieu : refaire le tour complet à
 * chaque ouverture est du temps perdu, pour l'utilisateur comme pour
 * OpenStreetMap. On retient donc ce qu'on a déjà examiné — mais sous forme
 * d'empreinte, pas de simple drapeau : si le nom ou la position changent,
 * c'est un autre lieu et il faut le revérifier.
 */
export function signaturePlace(a) {
  const c = (v) => (Number.isFinite(v) ? v.toFixed(4) : '-');
  return `${(a.title || '').trim().toLowerCase()}|${c(a.lat)}|${c(a.lon)}`;
}

const dejaVu = (a) => !!a.placeCheckSig && a.placeCheckSig === signaturePlace(a);

/**
 * Toutes les activités du voyage, avec leur emplacement pour pouvoir les
 * modifier ensuite.
 */
function toutesLesActivites(trip) {
  const out = [];
  (trip.days || []).forEach((d, i) => (d.activities || []).forEach(a => {
    out.push({ activite: a, emplacement: { type: 'day', dayId: d.id }, ou: `Jour ${i + 1}` });
  }));
  (trip.reserve || []).forEach(a => {
    out.push({ activite: a, emplacement: { type: 'reserve' }, ou: 'Réserve' });
  });
  return out;
}

/**
 * Que faut-il vérifier dans ce voyage ? Aucune requête réseau.
 *
 * @param {object} trip
 * @param {{lat:number, lon:number}|null} ancre  coordonnées de la destination
 * @returns {{ecartes: Array, incompletes: Array, total: number}}
 */
export function analyserVoyage(trip, ancre) {
  const toutes = toutesLesActivites(trip).filter(x => verifiable(x.activite));
  const reperes = toutes.filter(x => geolocalisee(x.activite));

  const ecartes = [], incompletes = [];

  for (const x of toutes) {
    const a = x.activite;

    if (!geolocalisee(a)) {
      // Sans coordonnées, impossible de dire si le lieu est bon — mais on sait
      // déjà qu'il manque de quoi s'y rendre.
      if (!a.address || !a.openingHours) {
        incompletes.push({ ...x, manque: manquants(a) });
      }
      continue;
    }

    const dAncre = ancre ? distKm(ancre.lat, ancre.lon, a.lat, a.lon) : null;

    // Un road trip s'étale : la distance à la destination ne veut plus rien
    // dire. Ce qui reste parlant, c'est l'isolement — un point seul, loin de
    // tous les autres, est presque toujours une erreur de géocodage.
    const dVoisin = reperes.reduce((min, y) => {
      if (y.activite === a) return min;
      const d = distKm(a.lat, a.lon, y.activite.lat, y.activite.lon);
      return d < min ? d : min;
    }, Infinity);

    const loinDeTout = trip.roadTripMode
      ? (dAncre == null || dAncre > SEUIL_KM) && dVoisin > SEUIL_KM
      : dAncre != null && dAncre > SEUIL_KM;

    if (loinDeTout) {
      ecartes.push({
        ...x, dejaVerifie: dejaVu(a),
        distanceKm: dAncre, isolementKm: Number.isFinite(dVoisin) ? dVoisin : null,
      });
    } else if (!a.address || !a.openingHours) {
      incompletes.push({ ...x, dejaVerifie: dejaVu(a), manque: manquants(a) });
    }
  }

  const neufs = (l) => l.filter(x => !x.dejaVerifie);
  return {
    ecartes, incompletes,
    total: ecartes.length + incompletes.length,
    // Ce qui n'a jamais été examiné — c'est ce chiffre qui alerte. Un lieu
    // déjà passé en revue ne doit plus réclamer l'attention, même s'il reste
    // imparfait : sinon le bandeau devient du bruit permanent.
    nouveaux: neufs(ecartes).length + neufs(incompletes).length,
    ecartesNeufs: neufs(ecartes).length,
  };
}

/**
 * La liste à passer en revue en ligne. Par défaut, seulement ce qui n'a jamais
 * été examiné ; `tout` force la reprise complète.
 */
export function aExaminer(analyse, tout = false) {
  const l = [...analyse.ecartes, ...analyse.incompletes];
  return tout ? l : l.filter(x => !x.dejaVerifie);
}

function manquants(a) {
  const m = [];
  if (!a.address) m.push('adresse');
  if (!geolocalisee(a)) m.push('position');
  if (!a.openingHours) m.push('horaires');
  return m;
}

/**
 * Cherche en ligne de quoi corriger ce que l'analyse a signalé.
 *
 * Les requêtes passent par `lookupPlace`, déjà sérialisé et espacé d'une
 * seconde : on ne bombarde pas un service public et gratuit. C'est lent par
 * construction, d'où `onProgres` pour que l'écran le montre.
 *
 * @param {Array} aVerifier   sortie d'`aExaminer`
 * @param {object} opts       {destination, ancre, onProgres, arret}
 * @returns {Promise<{propositions: Array, examines: Array}>}
 *   `propositions` : ce qu'il y a à montrer et à trancher.
 *   `examines` : les fiches passées en revue sans rien à proposer. Rien à
 *   afficher, mais il faut s'en souvenir — sinon la prochaine ouverture
 *   redépense une seconde par lieu pour retrouver le même vide.
 */
export async function chercherCorrections(aVerifier, { destination, ancre, onProgres, arret } = {}) {
  const propositions = [];
  const examines = [];

  for (let i = 0; i < aVerifier.length; i++) {
    if (arret?.aborted) break;
    const item = aVerifier[i];
    const a = item.activite;
    onProgres?.({ fait: i, total: aVerifier.length, titre: a.title });

    const estEcarte = item.distanceKm !== undefined;

    // Un lieu signalé puis abandonné sans un mot est le pire des deux mondes :
    // l'utilisateur voit l'erreur persister et ne sait pas pourquoi. Quand la
    // recherche ne donne rien d'exploitable, on le dit et on renvoie vers la
    // fiche — corriger à la main reste possible.
    const introuvable = (raison) => propositions.push({
      id: a.id, emplacement: item.emplacement, titre: a.title, ou: item.ou,
      motif: 'introuvable', raison,
      distanceKm: item.distanceKm,
      avant: { address: a.address || '—' },
      patch: { placeCheckSig: signaturePlace(a) },
    });

    let trouve = null;
    let panne = false;
    try {
      trouve = await lookupPlace(a.title, destination, { lat: ancre?.lat, lon: ancre?.lon });
    } catch { panne = true; }
    // Une coupure réseau n'est pas un lieu introuvable : on ne marque rien.
    if (panne) continue;

    const rienAProposer = () => examines.push({
      id: a.id, emplacement: item.emplacement,
      patch: { placeCheckSig: signaturePlace(a) },
    });

    if (!trouve) {
      // Un lieu mal situé mérite qu'on le dise ; une fiche simplement
      // incomplète qu'on n'a pas su compléter n'a rien d'alarmant.
      if (estEcarte) introuvable('aucun'); else rienAProposer();
      continue;
    }

    if (estEcarte) {
      // Pour un lieu mal situé, remplir les trous ne sert à rien : c'est la
      // position elle-même qui est fausse. On ne propose donc le remplacement
      // que si la nouvelle est, elle, cohérente avec le voyage.
      if (!Number.isFinite(trouve.lat)) { introuvable('aucun'); continue; }
      const dNouvelle = ancre ? distKm(ancre.lat, ancre.lon, trouve.lat, trouve.lon) : 0;
      // Le nom l'emporte souvent sur la ville dans un géocodeur : chercher
      // « Casa de Mozart, Vienne » ramène la maison de Salzbourg. On ne
      // remplace pas une erreur par la même.
      if (dNouvelle > SEUIL_KM) { introuvable('loin'); continue; }
      const bouge = distKm(a.lat, a.lon, trouve.lat, trouve.lon);
      if (bouge < 1) { introuvable('identique'); continue; }

      propositions.push({
        id: a.id,
        emplacement: item.emplacement,
        titre: a.title,
        ou: item.ou,
        motif: 'ecarte',
        distanceKm: item.distanceKm,
        avant: { address: a.address || '—', lat: a.lat, lon: a.lon },
        apres: {
          address: trouve.address || a.address || '—',
          lat: trouve.lat, lon: trouve.lon,
        },
        patch: {
          lat: trouve.lat, lon: trouve.lon,
          ...(trouve.address ? { address: trouve.address } : {}),
          ...(trouve.openingHours && !a.openingHours ? { openingHours: trouve.openingHours } : {}),
          // L'empreinte se calcule sur la version corrigée : accepter cette
          // proposition clôt le sujet pour ce lieu.
          placeCheckSig: signaturePlace({ ...a, lat: trouve.lat, lon: trouve.lon }),
        },
      });
      continue;
    }

    // Fiche incomplète : on ne remplit que les trous, jamais ce que
    // l'utilisateur a saisi lui-même.
    const patch = missingFieldsFrom(a, trouve);
    if (!patch) { rienAProposer(); continue; }
    propositions.push({
      id: a.id,
      emplacement: item.emplacement,
      titre: a.title,
      ou: item.ou,
      motif: 'incomplete',
      ajouts: Object.keys(patch).filter(k => k !== 'lon'),
      apres: {
        address: patch.address || a.address || '—',
        openingHours: patch.openingHours || a.openingHours || '',
      },
      patch: {
        ...patch,
        placeCheckSig: signaturePlace({ ...a, lat: patch.lat ?? a.lat, lon: patch.lon ?? a.lon }),
      },
    });
  }

  onProgres?.({ fait: aVerifier.length, total: aVerifier.length, titre: null });
  return { propositions, examines };
}

/** Formule la distance comme on la dit. */
export function formatKm(km) {
  if (!Number.isFinite(km)) return null;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km).toLocaleString('fr-FR')} km`;
}
