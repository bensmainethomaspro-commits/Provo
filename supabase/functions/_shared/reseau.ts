/**
 * Où nos fonctions ont le droit d'aller chercher une page.
 *
 * Ce filtre a vécu six jours dans `enrich-place` seulement, pendant que
 * `extract-place` récupérait des URL fournies par l'utilisateur sans aucun
 * contrôle — deux fonctions qui font la même chose, une seule protégée. La
 * semaine précédente, c'est `origineAutorisee` qui avait dérivé de la même
 * façon. Une règle recopiée ne suit pas ; une règle partagée, si.
 *
 * CE QUE ÇA NE COUVRE PAS : un nom d'hôte public qui *résout* vers une adresse
 * interne (réattribution DNS). Le filtre lit le nom, pas l'adresse résolue.
 */
// Cette fonction télécharge une URL qu'elle n'a pas choisie. Sans contrôle,
// elle deviendrait un relais pour atteindre le réseau interne de l'hébergeur.
export const PRIVE =
  /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

export function urlSure(brut: string): URL | null {
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (PRIVE.test(u.hostname)) return null;
  // Un nom sans point est forcément une machine du réseau local.
  if (!u.hostname.includes(".")) return null;
  return u;
}
