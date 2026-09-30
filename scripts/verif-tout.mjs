/**
 * Toutes les vérifications qui ne demandent ni réseau ni serveur, d'un coup.
 *
 * Quinze suites existaient, sept sans entrée dans package.json : un correctif
 * était vérifié le jour où il était écrit, et plus jamais (audit du
 * 30 septembre 2026). Ce script les enchaîne toutes et s'arrête au premier
 * échec, avec son nom.
 *
 * Hors de cette liste, parce qu'elles demandent l'aperçu lancé
 * (`npx vite preview --port 4173`) : verif-ui, verif-carte, verif-synchro-demarrage,
 * parcours.
 *
 * Usage :  npm run verif
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const AVEC_SERVEUR = new Set(['verif-ui.mjs', 'verif-carte.mjs', 'verif-tout.mjs', 'verif-synchro-demarrage.mjs']);
const suites = readdirSync(new URL('.', import.meta.url))
  .filter(f => /^verif-.*\.mjs$/.test(f) && !AVEC_SERVEUR.has(f))
  .sort();

for (const f of suites) {
  const r = spawnSync(process.execPath, [new URL(f, import.meta.url).pathname], { encoding: 'utf8' });
  const derniere = (r.stdout || '').trim().split('\n').pop();
  if (r.status !== 0) {
    console.log(`✗ ${f}\n${(r.stdout || '').slice(-2000)}${r.stderr || ''}`);
    process.exit(1);
  }
  console.log(`✓ ${f.padEnd(26)} ${derniere}`);
}
console.log(`\n${suites.length} suites, toutes vertes.`);
