/**
 * Qui a le droit d'appeler nos fonctions Edge.
 *
 * Ce garde-fou existait, écrit une fois dans `extract-place`, et les trois
 * fonctions ajoutées ensuite ne l'ont pas repris — `read-booking`,
 * `read-receipt` et `enrich-place` appellent pourtant toutes le modèle payant.
 * La clé publiable voyage dans le paquet du navigateur : n'importe qui peut la
 * lire, donc n'importe quel site pouvait faire dépenser le crédit du compte.
 *
 * D'où ce fichier partagé plutôt qu'une quatrième copie : une règle recopiée
 * finit par ne plus suivre. Le dossier `_shared` n'a pas d'`index.ts`, la
 * boucle de déploiement l'ignore donc comme fonction, et le CLI l'embarque
 * dans chaque paquet qui l'importe.
 *
 * CE QUE ÇA NE FAIT PAS. L'en-tête `Origin` n'est imposé que par les
 * navigateurs : un appel en ligne de commande peut l'omettre ou en inventer
 * un. Ce contrôle ferme l'abus depuis un autre SITE — le vecteur réaliste
 * d'une dépense massive — pas l'appel forgé. Pour celui-là il faudrait exiger
 * un jeton d'utilisateur connecté, ce qui est un autre chantier.
 */
export const ORIGINES_AUTORISEES = [
  /^https:\/\/provo-tbens\.vercel\.app$/,
  /^https:\/\/provo-[a-z0-9-]+-tbens\.vercel\.app$/,
  /^https:\/\/localhost(:\d+)?$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^capacitor:\/\//,
  /^https:\/\/localhost$/,
];

export function origineAutorisee(req: Request): boolean {
  const o = req.headers.get("origin") || "";
  // Une application native n'envoie pas d'origine : on ne la bloque pas, mais
  // elle n'ouvre pas non plus la porte à un navigateur tiers.
  if (!o) return true;
  return ORIGINES_AUTORISEES.some((re) => re.test(o));
}
