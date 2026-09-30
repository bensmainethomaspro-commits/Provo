/**
 * Ce qui n'est pas encore parti chez Supabase, et qui doit survivre à la
 * fermeture de l'app.
 *
 * LE BUG QUE ÇA FERME (audit du 30 septembre 2026, reproduit) : au chargement,
 * la version du nuage REMPLAÇAIT chaque voyage local. Or ce chargement ne se
 * produit pas qu'au démarrage : la bibliothèque d'authentification émet
 * `SIGNED_IN` à chaque retour dans l'app. Une dépense notée dans le métro,
 * hors ligne, disparaissait donc au premier passage par WhatsApp une fois le
 * réseau revenu. Et dans l'autre sens, un téléphone en retard réécrivait le
 * nuage avec sa vieille version, parce que l'écriture différée partait quand
 * même.
 *
 * Ce qu'il manquait pour trancher, c'est de savoir, APRÈS un redémarrage,
 * quels voyages portent des modifications jamais envoyées, et quelle était la
 * dernière version connue des deux côtés. Sans cette base, une fusion ne
 * distingue pas « ajouté ici » de « supprimé là-bas ». Les deux vivent ici,
 * dans le stockage local, sous une clé à part.
 *
 * Pur, sans import : vérifié par `scripts/verif-synchro.mjs`.
 */

export const CLE_ATTENTE = 'provo_synchro';

/** `{ [idVoyage]: { base } }` : les voyages modifiés ici et pas encore envoyés. */
export function lireAttente(stockage) {
  try {
    const brut = JSON.parse(stockage.getItem(CLE_ATTENTE) || '{}');
    return brut && typeof brut === 'object' && !Array.isArray(brut) ? brut : {};
  } catch {
    return {};
  }
}

/**
 * Rend `true` si tout a été gardé, `false` si les bases ont dû être lâchées.
 *
 * Le stockage local peut se remplir (photos et billets y restent en base64
 * quand IndexedDB manque, voir utils/pieces.js). Plutôt
 * que de tout perdre, on garde au moins la LISTE des voyages en attente : au
 * chargement suivant, ce qui a été saisi ici l'emporte, faute de base pour
 * fusionner. C'est le « dernier qui écrit gagne » que le projet assume déjà,
 * en faveur de ce que la personne a tapé sur ce téléphone.
 */
export function ecrireAttente(stockage, attente) {
  const ids = Object.keys(attente);
  try {
    if (!ids.length) stockage.removeItem(CLE_ATTENTE);
    else stockage.setItem(CLE_ATTENTE, JSON.stringify(attente));
    return true;
  } catch {
    try {
      stockage.setItem(CLE_ATTENTE, JSON.stringify(Object.fromEntries(ids.map(id => [id, { base: null }]))));
    } catch { /* plus rien à faire : le voyage lui-même n'a pas pu être écrit non plus */ }
    return false;
  }
}

/**
 * Le voyage à garder quand le nuage répond au chargement.
 *
 *  · rien en attente ici   → le nuage fait foi (il peut avoir avancé ailleurs) ;
 *  · en attente, base connue → fusion à trois voies : les ajouts des deux
 *    côtés survivent, une suppression reste une suppression ;
 *  · en attente, base perdue → ce qui a été saisi ici l'emporte.
 *
 * `fusionner` est `fusionnerVoyages` (helpers.js), passé en paramètre pour que
 * ce fichier reste sans dépendance et se vérifie sans navigateur.
 */
export function reconcilier(local, distant, attente, fusionner) {
  if (!local) return distant;
  if (!distant) return local;
  if (!attente) return distant;
  if (attente.base) return fusionner(attente.base, local, distant);
  return local;
}
