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

const REDIRECTIONS = new Set([301, 302, 303, 307, 308]);
const SAUTS_MAX = 5;

/**
 * Joindre une URL en suivant les redirections À LA MAIN, chaque saut
 * repassant par `urlSure`.
 *
 * `redirect: "follow"` ne valide que l'URL de départ : une adresse publique
 * qui renvoie vers `http://169.254.169.254` faisait traverser le garde-fou à
 * l'arrivée (A-019 dans `enrich-place`, puis le même trou dans
 * `extract-place`, remonté deux fois par l'audit). Écrit une fois ici pour
 * que la deuxième fonction ne dérive plus de la première.
 *
 * `entetes` reçoit l'URL de CHAQUE saut : un lien court goo.gl mène à
 * google.com, qui veut son cookie de consentement, alors que le départ n'en
 * voulait pas.
 *
 * CE QUE ÇA NE COUVRE PAS : un nom d'hôte public qui *résout* vers une adresse
 * interne (réattribution DNS).
 */
// `reponse` vaut null quand la chaîne s'arrête (saut refusé, boucle, réseau) ;
// le tout vaut null quand l'URL de départ elle-même est refusée.
export async function joindre(
  depart: string,
  signal: AbortSignal,
  entetes: (u: URL) => Record<string, string>,
): Promise<{ reponse: Response | null; urlFinale: URL } | null> {
  let courante = urlSure(depart);
  if (!courante) return null;
  for (let saut = 0; saut <= SAUTS_MAX; saut++) {
    let r: Response;
    try {
      r = await fetch(courante.toString(), {
        signal, redirect: "manual", headers: entetes(courante),
      });
    } catch {
      // Réseau coupé ou délai dépassé : l'URL atteinte sert encore (un lien
      // court Maps porte ses coordonnées dans l'URL d'arrivée).
      return { reponse: null, urlFinale: courante };
    }
    if (!REDIRECTIONS.has(r.status)) return { reponse: r, urlFinale: courante };
    // Le corps d'une redirection ne sert à rien, mais ouvert il retient la
    // connexion.
    await r.body?.cancel().catch(() => {});
    const cible = r.headers.get("location");
    if (!cible) return { reponse: null, urlFinale: courante };
    // Une `Location` peut être relative : la résoudre avant de la juger.
    let resolue: string;
    try {
      resolue = new URL(cible, courante).toString();
    } catch {
      return { reponse: null, urlFinale: courante };
    }
    const sure = urlSure(resolue);
    // Saut refusé : on s'arrête AVANT de le joindre. `urlFinale` reste le
    // dernier saut sûr, jamais l'adresse interne.
    if (!sure) return { reponse: null, urlFinale: courante };
    courante = sure;
  }
  // Plus de sauts que permis : une boucle, ou quelqu'un qui joue.
  return { reponse: null, urlFinale: courante };
}

/**
 * Lire au plus `max` octets du corps, puis couper la connexion.
 *
 * `(await r.text()).slice(0, max)` charge TOUT le corps en mémoire avant de
 * le couper : un serveur qui annonce du HTML et sert un gigaoctet faisait
 * tomber la fonction sur sa limite mémoire. Ici on s'arrête au plafond.
 * Le délai de l'appelant doit rester armé pendant la lecture : c'est son
 * `AbortSignal` qui borne un serveur qui envoie au compte-gouttes.
 */
export async function lireCorps(r: Response, max: number): Promise<string> {
  if (!r.body) return "";
  const lecteur = r.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      total += value.length;
    }
  } finally {
    await lecteur.cancel().catch(() => {});
  }
  const tout = new Uint8Array(Math.min(total, max));
  let pos = 0;
  for (const m of morceaux) {
    const reste = tout.length - pos;
    if (reste <= 0) break;
    tout.set(reste < m.length ? m.subarray(0, reste) : m, pos);
    pos += Math.min(reste, m.length);
  }
  // `fatal: false` : un caractère coupé en deux au plafond devient �, sans
  // lever.
  return new TextDecoder("utf-8", { fatal: false }).decode(tout);
}
