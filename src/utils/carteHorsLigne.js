/**
 * Garder la carte du voyage lisible sans réseau.
 *
 * Le service worker range déjà les tuiles qu'on a regardées (`provo-tiles-v1`).
 * Mais « regardées » veut dire : avant de partir, en ayant pensé à ouvrir la
 * carte et à balayer la ville. Sur place, dans un métro ou avec un forfait
 * étranger, ce qu'on n'a pas ouvert n'existe pas.
 *
 * Deux limites tenues volontairement :
 *
 * 1. **On ne télécharge pas une région.** Les conditions d'utilisation des
 *    tuiles d'OpenStreetMap découragent explicitement le téléchargement en
 *    masse. On ne prend donc que le voisinage immédiat des lieux du voyage,
 *    plafonné, et étalé dans le temps — l'équivalent d'un utilisateur qui
 *    consulte sa carte, pas d'un aspirateur.
 * 2. **On ne décide pas à la place de l'utilisateur.** Quelques mégaoctets sur
 *    un forfait, c'est son affaire : l'app propose, chiffre le coût, et se tait
 *    si on refuse.
 */

const CACHE = 'provo-tiles-v1';
const MODELE = (z, x, y) => `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`;

// Deux niveaux : le quartier (z15) et la rue (z16). En dessous on ne lit plus
// les noms de rue, au-dessus le nombre de tuiles explose.
const ZOOMS = [15, 16];
// Un lieu et ce qu'il y a autour : de quoi se repérer en sortant du métro.
const RAYON = 1;
// Plafond dur. À ~15 ko la tuile, cela fait environ 4,5 Mo — assez pour une
// ville visitée, très loin d'un téléchargement de région.
const PLAFOND = 300;
const POIDS_TUILE = 15000;

// Débit volontairement modeste : six tuiles à la fois, une pause entre chaque
// salve. Un serveur communautaire n'a pas à payer notre confort.
const PAR_SALVE = 6;
const PAUSE_MS = 220;

function versTuile(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n);
  const rad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  return { x, y };
}

/** Tous les points du voyage qui ont une position. */
export function lieuxSitues(trip) {
  if (!trip) return [];
  const pts = [];
  const prendre = (a) => {
    if (Number.isFinite(a?.lat) && Number.isFinite(a?.lon)) pts.push({ lat: a.lat, lon: a.lon });
  };
  (trip.days || []).forEach(d => (d.activities || []).forEach(prendre));
  (trip.reserve || []).forEach(prendre);
  if (Number.isFinite(trip.accommodationLat)) {
    pts.push({ lat: trip.accommodationLat, lon: trip.accommodationLon });
  }
  return pts;
}

/**
 * Les tuiles à garder, dédoublonnées. Les lieux d'une même ville partagent
 * l'essentiel de leur voisinage : c'est ce qui rend le plafond tenable.
 */
export function tuilesDuVoyage(trip) {
  const pts = lieuxSitues(trip);
  const vues = new Set();
  const urls = [];
  for (const z of ZOOMS) {
    for (const p of pts) {
      const { x, y } = versTuile(p.lat, p.lon, z);
      for (let dx = -RAYON; dx <= RAYON; dx++) {
        for (let dy = -RAYON; dy <= RAYON; dy++) {
          const cle = `${z}/${x + dx}/${y + dy}`;
          if (vues.has(cle)) continue;
          vues.add(cle);
          urls.push(MODELE(z, x + dx, y + dy));
          if (urls.length >= PLAFOND) return urls;
        }
      }
    }
  }
  return urls;
}

/** Le poids annoncé, en mégaoctets, arrondi comme on l'annoncerait à l'oral. */
export function poidsEstime(nbTuiles) {
  return Math.max(1, Math.round(nbTuiles * POIDS_TUILE / 100000) / 10);
}

/** Combien de ces tuiles sont déjà rangées ? Sert à ne rien proposer d'inutile. */
export async function dejaEnCache(urls) {
  if (!('caches' in window) || !urls.length) return 0;
  try {
    const cache = await caches.open(CACHE);
    const presentes = await Promise.all(urls.map(u => cache.match(u).then(Boolean)));
    return presentes.filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Range les tuiles manquantes. Rend le nombre réellement obtenu — une tuile
 * qui n'arrive pas n'est pas une panne : la carte se contentera de la chercher
 * en ligne le jour venu.
 */
export async function telecharger(urls, { onProgres, arret } = {}) {
  if (!('caches' in window)) return 0;
  const cache = await caches.open(CACHE);
  let obtenues = 0, faites = 0;
  for (let i = 0; i < urls.length; i += PAR_SALVE) {
    if (arret?.aborted) break;
    const salve = urls.slice(i, i + PAR_SALVE);
    await Promise.all(salve.map(async (u) => {
      try {
        if (await cache.match(u)) { obtenues++; return; }
        const r = await fetch(u, { mode: 'cors' });
        if (r.ok) { await cache.put(u, r.clone()); obtenues++; }
      } catch { /* une tuile manquante ne casse rien */ }
    }));
    faites += salve.length;
    onProgres?.({ faites, total: urls.length });
    // Deux salves entières sans une seule tuile : le réseau ne répond pas, ou
    // le serveur nous refuse. Insister quarante-huit fois de plus ne ferait que
    // brûler de la batterie en silence — on s'arrête et on réessaiera à la
    // prochaine ouverture de la carte.
    if (faites >= PAR_SALVE * 2 && obtenues === 0) break;
    if (i + PAR_SALVE < urls.length) await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  return obtenues;
}

/**
 * Faut-il en parler ? Oui seulement si : on est en ligne, le voyage a des
 * lieux situés, il commence bientôt ou il est en cours, et la carte n'est pas
 * déjà rangée. Sinon on se tait — une proposition qui revient toujours devient
 * un clic réflexe.
 */
export async function aProposer(trip, { maintenant = new Date() } = {}) {
  if (!navigator.onLine || !trip) return null;
  const fait = trip.carteHorsLigne;
  // Déjà rangée : on n'y revient pas. Échec précédent : on réessaie, mais pas
  // avant six heures — un réseau qui refuse maintenant refusera dans dix
  // secondes, et l'utilisateur ouvre la carte plusieurs fois par jour.
  if (fait?.tuiles) return null;
  if (fait?.echec && Date.now() - new Date(fait.echec).getTime() < 6 * 3600000) return null;
  // Économiseur de données activé : c'est un refus explicite de l'utilisateur,
  // au niveau du système. On n'a pas à le contourner.
  if (navigator.connection?.saveData) return null;
  const debut = new Date(`${trip.startDate}T00:00:00`);
  const fin = new Date(`${trip.endDate}T23:59:59`);
  const joursAvant = Math.round((debut - maintenant) / 86400000);
  if (maintenant > fin) return null;
  if (joursAvant > 10) return null;
  const urls = tuilesDuVoyage(trip);
  if (urls.length < 12) return null;
  const dedans = await dejaEnCache(urls);
  if (dedans / urls.length > 0.8) return null;
  return { urls, poids: poidsEstime(urls.length - dedans), lieux: lieuxSitues(trip).length };
}
