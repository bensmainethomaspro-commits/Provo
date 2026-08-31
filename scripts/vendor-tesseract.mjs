/**
 * Copie le moteur OCR dans `public/tesseract/`, pour qu'il vienne de CHEZ NOUS.
 *
 * POURQUOI. Par défaut, tesseract.js va chercher son worker, son cœur WebAssembly
 * et son modèle de langue sur un CDN public. Trois raisons de ne pas faire ça
 * ici :
 *
 *  1. Provo tient hors ligne. Servi depuis notre origine, le moteur passe par le
 *     service worker et se garde comme le reste de l'app : le deuxième ticket se
 *     lit sans réseau. Depuis un CDN, il ne se garde qu'au bon vouloir du cache
 *     HTTP du navigateur.
 *  2. L'app Android (Capacitor) sert `dist/` en local, sans origine distante.
 *     Un CDN y serait un aller-retour réseau au milieu d'un dîner à l'étranger.
 *  3. Rien d'autre dans cette app ne dépend d'un tiers pour fonctionner. Ce
 *     n'est pas ici qu'on va commencer.
 *
 * CE QUI EST COPIÉ, ET POURQUOI TROIS CŒURS. tesseract.js choisit son cœur au
 * démarrage selon ce que le processeur du téléphone sait faire (SIMD relâché,
 * SIMD, rien). On ne peut pas le deviner à la compilation : on livre les trois,
 * et chaque appareil n'en télécharge qu'un seul (~3,7 Mo, puis en cache).
 * Seules les variantes `-lstm` sont copiées : l'app demande OEM 1, le moteur
 * moderne, et les variantes complètes emportent en plus l'ancien moteur qui ne
 * servirait jamais.
 *
 * Le dossier produit n'est PAS versionné (voir .gitignore) — il se reconstruit
 * depuis node_modules. Ce script tourne en `prebuild`, donc `npm run build`
 * suffit ; il échoue bruyamment plutôt que de livrer une app dont le bouton
 * « photographier le ticket » tomberait dans le vide.
 *
 * Usage :  node scripts/vendor-tesseract.mjs
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(RACINE, 'node_modules');
const VERS = join(RACINE, 'public', 'tesseract');

// [source, destination]. Les noms de destination sont ceux que tesseract.js
// reconstruit lui-même à partir du dossier : ils ne peuvent pas être changés.
const FICHIERS = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  // Le modèle « best_int » : celui qu'attend OEM 1. Six fois plus léger que le
  // modèle complet (0,7 Mo contre 6 Mo) parce qu'il laisse tomber l'ancien
  // moteur — que l'app n'utilise pas.
  ['@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz', 'lang/fra.traineddata.gz'],
];

let octets = 0;
for (const [depuis, vers] of FICHIERS) {
  const src = join(MODULES, depuis);
  if (!existsSync(src)) {
    console.error(`\n✗ introuvable : ${depuis}`);
    console.error('  Le moteur OCR vient de node_modules. Lance `npm install`.\n');
    process.exit(1);
  }
  const dst = join(VERS, vers);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  octets += statSync(dst).size;
}

console.log(`moteur OCR copié dans public/tesseract/ (${(octets / 1048576).toFixed(1)} Mo, `
  + `dont ~${((statSync(join(VERS, 'core/tesseract-core-simd-lstm.wasm.js')).size
    + statSync(join(VERS, 'lang/fra.traineddata.gz')).size
    + statSync(join(VERS, 'worker.min.js')).size) / 1048576).toFixed(1)} Mo par appareil)`);
