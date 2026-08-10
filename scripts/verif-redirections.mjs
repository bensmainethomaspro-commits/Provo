/**
 * Vérifie que `suivreRedirections` revalide CHAQUE saut, pas seulement le
 * premier — c'est tout l'objet du correctif.
 *
 * Le code est découpé dans `enrich-place`, jamais recopié ici : une copie
 * finirait par diverger, et le test cesserait de tester quoi que ce soit.
 * Seul `fetch` est simulé — impossible de faire autrement sans réseau, et
 * c'est justement la partie qu'on veut piloter.
 *
 * Usage :  node scripts/verif-redirections.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../supabase/functions/enrich-place/index.ts', import.meta.url), 'utf8');

/** L'accolade qui ouvre le CORPS, à partir de la fin de la liste de paramètres.
 *  Pas la première venue : `Promise<{ a: B }>` en contient une, et s'y arrêter
 *  tronquait la fonction au milieu de son type de retour. */
function debutDuCorps(texte, finParams) {
  let j = finParams + 1;
  while (j < texte.length && /\s/.test(texte[j])) j++;
  if (texte[j] !== ':') return j;
  let chevrons = 0;
  for (; j < texte.length; j++) {
    if (texte[j] === '<') chevrons++;
    else if (texte[j] === '>') chevrons--;
    else if (texte[j] === '{' && chevrons === 0) return j;
  }
  throw new Error('corps introuvable');
}

/** La fin de la liste de paramètres, en comptant les parenthèses. */
function finDesParametres(texte, depuis) {
  let i = texte.indexOf('(', depuis), p = 0;
  for (; i < texte.length; i++) {
    if (texte[i] === '(') p++;
    else if (texte[i] === ')' && --p === 0) return i;
  }
  throw new Error('parenthèses non refermées');
}

function decouper(nom) {
  let debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`introuvable : ${nom}`);
  // Garder `async` : sans lui, les `await` du corps ne compilent pas.
  if (src.slice(debut - 6, debut) === 'async ') debut -= 6;
  let i = debutDuCorps(src, finDesParametres(src, debut)), p = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') p++;
    else if (src[i] === '}' && --p === 0) return src.slice(debut, i + 1);
  }
  throw new Error(`accolades non refermées : ${nom}`);
}

const constante = (nom) => {
  const m = src.match(new RegExp(`const ${nom}\\s*=\\s*([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`constante introuvable : ${nom}`);
  return `const ${nom} = ${m[1]};`;
};

/**
 * Retirer les annotations de type d'une fonction découpée.
 *
 * Le type de retour ne se coupe pas au premier `{` : `Promise<{ a: B }>` en
 * contient. On suit donc la profondeur des chevrons, et le corps est la
 * première accolade rencontrée à profondeur zéro.
 */
function sansTypes(code) {
  const finParams = finDesParametres(code, 0);
  const corps = debutDuCorps(code, finParams);
  return (code.slice(0, finParams + 1) + ' ' + code.slice(corps))
    .replace(/(\w+)\s*:\s*(string|number|boolean|URL|AbortSignal|Response)\b/g, '$1');
}

const prelude = [
  constante('PRIVE'),
  constante('REDIRECTIONS'),
  constante('SAUTS_MAX'),
  "const UA = 'test';",
  sansTypes(decouper('urlSure')),
  sansTypes(decouper('suivreRedirections')),
].join('\n');

const fabriquer = (fetchSimule) =>
  new Function('fetch', `${prelude}; return { suivreRedirections, urlSure, SAUTS_MAX };`)(
    fetchSimule);

/** Un faux serveur : une carte URL → réponse. */
function serveur(routes) {
  const vus = [];
  const f = async (url) => {
    vus.push(url);
    const r = routes[url];
    if (!r) return { status: 404, headers: new Map(), body: null };
    const headers = new Map(Object.entries(r.headers || {}));
    return {
      status: r.status,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      body: r.status >= 300 && r.status < 400 ? { cancel: async () => {} } : null,
    };
  };
  return { f, vus };
}

const PUB = 'https://exemple.fr/';
const cas = [
  {
    nom: 'aucune redirection — rend la réponse et l’URL de départ',
    routes: { [PUB]: { status: 200 } },
    attendu: (r) => r && r.reponse.status === 200 && r.urlFinale.toString() === PUB,
  },
  {
    nom: 'redirection publique — suivie, et l’URL finale est celle d’arrivée',
    routes: {
      [PUB]: { status: 301, headers: { location: 'https://ailleurs.fr/page' } },
      'https://ailleurs.fr/page': { status: 200 },
    },
    attendu: (r) => r && r.urlFinale.toString() === 'https://ailleurs.fr/page',
  },
  {
    nom: 'redirection vers une adresse interne — REFUSÉE (la faille corrigée)',
    routes: {
      [PUB]: { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
      'http://169.254.169.254/latest/meta-data/': { status: 200 },
    },
    attendu: (r) => r === null,
    jamaisJoint: 'http://169.254.169.254/latest/meta-data/',
  },
  {
    nom: 'redirection vers localhost — refusée elle aussi',
    routes: { [PUB]: { status: 307, headers: { location: 'http://127.0.0.1:8000/' } } },
    attendu: (r) => r === null,
    jamaisJoint: 'http://127.0.0.1:8000/',
  },
  {
    nom: 'Location relative — résolue, pas refusée',
    routes: {
      [PUB]: { status: 302, headers: { location: '/fr/horaires' } },
      'https://exemple.fr/fr/horaires': { status: 200 },
    },
    attendu: (r) => r && r.urlFinale.toString() === 'https://exemple.fr/fr/horaires',
  },
  {
    nom: 'redirection sans Location — rend null sans jeter',
    routes: { [PUB]: { status: 302 } },
    attendu: (r) => r === null,
  },
];

let casses = 0;
for (const c of cas) {
  const { f, vus } = serveur(c.routes);
  const { suivreRedirections } = fabriquer(f);
  let r = null, jete = '';
  try { r = await suivreRedirections(new URL(PUB), undefined); }
  catch (e) { jete = String(e.message || e); }
  const fuite = c.jamaisJoint && vus.includes(c.jamaisJoint);
  const ok = !jete && !fuite && c.attendu(r);
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${c.nom}`);
  if (jete) console.log(`   a jeté : ${jete}`);
  else if (fuite) console.log(`   ADRESSE INTERNE JOINTE : ${c.jamaisJoint}`);
  else if (!ok) console.log(`   rendu : ${r && r.urlFinale}`);
}

// Une chaîne plus longue que la limite ne doit pas boucler indéfiniment.
{
  const routes = {};
  for (let i = 0; i < 20; i++) {
    routes[`https://exemple.fr/${i}`] =
      { status: 302, headers: { location: `https://exemple.fr/${i + 1}` } };
  }
  const { f, vus } = serveur(routes);
  const { suivreRedirections, SAUTS_MAX } = fabriquer(f);
  const r = await suivreRedirections(new URL('https://exemple.fr/0'), undefined);
  const ok = r === null && vus.length <= SAUTS_MAX + 1;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} chaîne sans fin — coupée à ${SAUTS_MAX} sauts `
    + `(${vus.length} requêtes)`);
}

const total = cas.length + 1;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
