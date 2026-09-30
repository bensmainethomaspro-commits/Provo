/**
 * Toute requête a un délai. Sans exception.
 *
 * Un appel que le navigateur ne règle jamais (bascule Wi-Fi/4G, portail captif
 * d'hôtel, réseau qui s'évanouit dans le métro) ne rend ni réponse ni erreur :
 * l'écran qui l'attend reste figé, la roue tourne pour toujours. Le dépôt l'a
 * appris dans `enrich.js` (audit A-045 : une seule requête coincée arrêtait la
 * complétion de toute la session), mais la règle n'y vivait que là. Elle vit
 * maintenant ici, et tout `fetch` de `src/` passe par elle (règle E13 : une
 * règle posée quelque part se cherche partout ailleurs).
 */

/** Pour un service tiers ordinaire (géocodage, météo, change…). */
export const DELAI_FETCH_MS = 12000;

/**
 * Pour les fonctions Edge. `extract-place` enchaîne plusieurs services côté
 * serveur et peut, au pire, dépasser la minute (audit A-012) : au-delà de
 * 25 s, on rend la main et l'écran propose la saisie à la main.
 */
export const DELAI_FONCTION_MS = 25000;

/**
 * `fetch` avec un délai. Au-delà, la requête est annulée et rejette — ce que
 * le `catch` de chaque appelant sait déjà traiter.
 *
 * Un signal fourni par l'appelant (recherche à la frappe annulée par la
 * suivante) est respecté en plus du délai.
 */
export async function avecDelai(url, ms = DELAI_FETCH_MS, init = {}) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), ms);
  const externe = init.signal;
  const suivre = () => ctrl.abort();
  if (externe) {
    if (externe.aborted) ctrl.abort();
    else externe.addEventListener('abort', suivre, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(minuteur);
    externe?.removeEventListener('abort', suivre);
  }
}
