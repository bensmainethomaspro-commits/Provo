/**
 * Toute requête de l'app a un délai. Vérifié au grep, sur tout `src/`.
 *
 * La règle est née dans `enrich.js` (audit A-045 : une seule requête que le
 * navigateur ne réglait jamais arrêtait la complétion de toute la session).
 * Elle n'y vivait que là : le 30 septembre 2026, 20 `fetch` et les 4 appels de
 * fonctions Edge de `src/` n'en avaient toujours pas (règle E13 : une règle
 * posée quelque part se cherche partout ailleurs). Ce contrôle empêche qu'un
 * nouvel appel reparte sans.
 *
 * Accepté :
 *  · `avecDelai(…)` (src/utils/reseau.js), qui est le seul `fetch` nu admis ;
 *  · un `fetch` qui reçoit un `signal` dans les lignes qui suivent (il gère
 *    son propre délai) ;
 *  · un `functions.invoke(…)` qui porte `timeout`.
 *
 * Usage :  node scripts/verif-delais.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RACINE = new URL('..', import.meta.url).pathname;
const fichiers = [];
(function parcourir(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) parcourir(p);
    else if (/\.(js|jsx)$/.test(f)) fichiers.push(p);
  }
})(join(RACINE, 'src'));

const fautes = [];
let vus = 0, parAvecDelai = 0;
for (const f of fichiers) {
  const rel = relative(RACINE, f);
  const lignes = readFileSync(f, 'utf8').split('\n');
  lignes.forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    if (/avecDelai\(/.test(l) && rel !== 'src/utils/reseau.js') parAvecDelai++;
    if (/(^|[^.\w])fetch\(/.test(l)) {
      vus++;
      if (rel === 'src/utils/reseau.js') return;
      if (!/signal/.test(lignes.slice(i, i + 4).join('\n'))) fautes.push(`${rel}:${i + 1}  fetch sans délai`);
    }
    if (/functions\s*\.invoke\(/.test(l)) {
      vus++;
      // L'appel se referme sur une ligne qui COMMENCE par « }) » : un `{})`
      // au milieu du corps de la requête ne le termine pas.
      let fin = i;
      while (fin < lignes.length - 1 && fin - i < 30 && !/^\s*\}\)/.test(lignes[fin])) fin++;
      if (!/timeout\s*:/.test(lignes.slice(i, fin + 1).join('\n'))) fautes.push(`${rel}:${i + 1}  fonction Edge sans timeout`);
    }
  });
}

if (fautes.length) {
  console.log(fautes.map(f => `✗ ${f}`).join('\n'));
  console.log(`\n${fautes.length} appel(s) sans délai. Passer par avecDelai (src/utils/reseau.js) ou ajouter timeout: DELAI_FONCTION_MS.`);
  process.exit(1);
}
console.log(`${parAvecDelai} appels par avecDelai, ${vus} autres (signal ou timeout) : tous ont un délai`);
