/**
 * La dette ESLint ne monte plus.
 *
 * Le dépôt porte des erreurs de lint connues, jugées non bloquantes, avec une
 * seule consigne : ne pas aggraver (`.audit/contexte.md`). Jusqu'ici, elle ne
 * se vérifiait qu'à la main, à chaque audit. Ce contrôle la tient à chaque
 * `npm run verif`, donc à chaque PR (`.github/workflows/verif.yml`).
 *
 * Le plafond ne se relève JAMAIS : quand la dette baisse, on l'abaisse ici.
 * 47 erreurs au 30 septembre 2026 avant l'audit Pareto, 40 après.
 *
 * Usage :  node scripts/verif-lint.mjs
 */
import { ESLint } from 'eslint';

const PLAFOND = 40;

const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
const resultats = await eslint.lintFiles(['.']);
const erreurs = resultats.reduce((s, r) => s + r.errorCount, 0);

if (erreurs > PLAFOND) {
  const fautifs = resultats.filter(r => r.errorCount)
    .map(r => `  ${r.filePath.replace(/.*\/Provo\//, '')} : ${r.errorCount}`).join('\n');
  console.log(`✗ ${erreurs} erreurs ESLint pour un plafond de ${PLAFOND} : la dette a monté.\n${fautifs}`);
  process.exit(1);
}
console.log(erreurs < PLAFOND
  ? `${erreurs} erreurs, sous le plafond de ${PLAFOND} : abaisse PLAFOND à ${erreurs}`
  : `${erreurs} erreurs, au plafond : la dette n'a pas monté`);
