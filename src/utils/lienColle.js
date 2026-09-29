/**
 * Ce qu'on colle quand on partage un lieu depuis une autre application.
 *
 * Presque jamais un lien nu. Le menu Partager de Plans donne « Taverna
 * Platanos » puis le lien sur la ligne suivante ; Google Maps, « Regarde ce
 * lieu : https://maps.app.goo.gl/… » ; Android, une adresse `geo:`.
 * Le champ traitait tout le texte comme une seule adresse web : il préfixait
 * `https://` à la phrase entière, et l'extraction échouait sur une URL
 * impossible. Le nom du lieu, écrit en toutes lettres juste à côté, était
 * jeté.
 */

// Ce qui, dans le texte d'accompagnement, parle de l'application et pas du lieu.
const BRUIT = new RegExp([
  // « Regarde ce lieu : », « Check out this place: »
  String.raw`\b(regarde|voici|découvre|decouvre|check (this|it) out|look at)\b(\s+(ce|cet|cette|this)\s+(lieu|endroit|resto|restaurant|spot|place))?\s*[:：]?`,
  // « sur Google Maps », « shared via Waze » — la préposition seulement
  // devant un nom d'application : « Bar in Rome » garde son « in ».
  String.raw`\b(partag[ée]e?|shared?|via|sur|on|dans|in|from|de)\s+(google maps|apple maps|plans|waze|tripadvisor|booking(\.com)?|thefork|yelp)\b`,
  String.raw`\b(google maps|apple maps|waze)\b`,
].join('|'), 'gi');

/** Le premier lien web du texte, sans la ponctuation qui le suit. */
export function premierLien(texte) {
  const m = String(texte || '').match(/https?:\/\/[^\s<>"'«»]+/i);
  return m ? m[0].replace(/[).,;:!?»]+$/, '') : null;
}

/**
 * Une adresse `geo:` (Android) : `geo:lat,lon?q=Nom` ou
 * `geo:0,0?q=lat,lon(Nom)`.
 */
export function lireGeo(texte) {
  const m = String(texte || '').match(/\bgeo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[^?\s]*)?(?:\?([^\s]*))?/i);
  if (!m) return null;
  let lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  let nom = null;
  const q = m[3] ? new URLSearchParams(m[3]).get('q') : null;
  if (q) {
    const pq = q.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*(?:\((.*)\))?$/);
    if (pq) {
      lat = parseFloat(pq[1]); lon = parseFloat(pq[2]);
      nom = pq[3]?.trim() || null;
    } else {
      nom = q.trim() || null;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    return nom ? { lat: null, lon: null, nom } : null;
  }
  return { lat, lon, nom };
}

/**
 * Le texte collé contient-il un lien de lieu, et quoi d'autre ?
 *
 * Ne répond que pour un texte COURT : une légende de vidéo ou une
 * confirmation de réservation contient aussi des liens, mais elles ont leur
 * propre lecture, bien plus riche. Rend `{ lien, indice }` — `indice` est le
 * nom écrit à côté du lien, qui servira si le lien ne dit rien.
 */
export function lienPartage(texte) {
  const t = String(texte || '').trim();
  const lien = premierLien(t);
  if (!lien) return null;
  const reste = t.replace(lien, ' ');
  // Plus de trois lignes ou de 160 caractères autour : ce n'est plus un
  // partage, c'est un texte qui cite un lien.
  const lignes = reste.split('\n').map(l => l.trim()).filter(Boolean);
  if (lignes.length > 3 || reste.replace(/\s+/g, ' ').trim().length > 160) return null;
  const indice = lignes
    .map(l => l.replace(BRUIT, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[\s:：\-–—|•.,;!?()]+$/g, '').replace(/^[\s:：\-–—|•]+/g, '').replace(/\s+/g, ' ').trim())
    .find(l => l.length >= 2) || null;
  return { lien, indice };
}
