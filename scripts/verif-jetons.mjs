/**
 * Le design system ne se ré-empile pas.
 *
 * Jusqu'au 1er octobre 2026, `src/index.css` empilait quatre « design
 * systems » successifs : `--text-muted` y était déclaré huit fois, le bouton
 * flottant de l'accueil décrit par cinq couches, et chaque correctif de
 * couleur commençait par chercher laquelle gagnait (règle B5 du playbook,
 * cinq occurrences). Les jetons vivent maintenant dans `src/styles/tokens.css`,
 * une fois chacun.
 *
 * Deux sortes de contrôles :
 *  · des INTERDITS, qui font échouer tout de suite : un jeton racine déclaré
 *    hors de tokens.css, un jeton déclaré deux fois pour le même thème, une
 *    `transition: all`, une police chargée depuis un tiers ;
 *  · des PLAFONDS, comme `verif-lint` : couleurs en dur, ombres, dégradés,
 *    `!important`. Ils ne se relèvent JAMAIS ; quand le compte baisse, on les
 *    abaisse ici.
 *
 * Usage :  node scripts/verif-jetons.mjs
 */
import { readFileSync } from 'node:fs';

const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const sansCommentaires = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = sansCommentaires(lire('src/index.css'));
const jetons = sansCommentaires(lire('src/styles/tokens.css'));
const html = lire('index.html');

// Plafonds au 1er octobre 2026, après la refonte. Avant : 310 couleurs
// hexadécimales, 369 rgba(), 91 ombres distinctes, 31 dégradés, 68 !important.
const PLAFONDS = {
  'couleurs hexadécimales en dur': 210,
  'couleurs rgba() en dur': 189,
  'ombres (box-shadow) distinctes': 59,
  'dégradés': 14,
  '!important': 59,
};

let fautes = 0;
const faute = (msg) => { console.log(`✗ ${msg}`); fautes++; };

// ── Interdits ───────────────────────────────────────────────────────────────
// Un bloc racine (:root, [data-theme="…"]) qui déclare un jeton, hors tokens.css.
for (const m of css.matchAll(/(^|\})\s*((?::root|html)?(?:\[data-theme="(?:dark|light)"\])?)\s*\{([^{}]*)\}/g)) {
  const sel = m[2].trim();
  if (!sel) continue;
  const noms = [...m[3].matchAll(/(--[\w-]+)\s*:/g)].map(x => x[1]);
  if (noms.length) faute(`index.css redéclare ${noms.join(', ')} dans « ${sel} » : les jetons vivent dans styles/tokens.css`);
}
// Dans tokens.css, chaque jeton une seule fois par thème.
for (const m of jetons.matchAll(/(:root|\[data-theme="dark"\])\s*\{([^{}]*)\}/g)) {
  const vus = new Set();
  for (const [, nom] of m[2].matchAll(/(--[\w-]+)\s*:/g)) {
    if (vus.has(nom)) faute(`tokens.css déclare ${nom} deux fois dans ${m[1]}`);
    vus.add(nom);
  }
}
if (/transition\s*:\s*all\b/.test(css)) faute('« transition: all » : nommer les propriétés animées');
if (/fonts\.googleapis|fonts\.gstatic/.test(html + css)) {
  faute('police chargée depuis Google : le service worker ne la garde pas, l\'app change de police hors ligne');
}

// ── Plafonds ────────────────────────────────────────────────────────────────
const comptes = {
  'couleurs hexadécimales en dur': (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length,
  'couleurs rgba() en dur': (css.match(/rgba?\(/g) || []).length,
  'ombres (box-shadow) distinctes': new Set([...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map(m => m[1].trim())).size,
  'dégradés': (css.match(/(?:linear|radial)-gradient\(/g) || []).length,
  '!important': (css.match(/!important/g) || []).length,
};
const baisses = [];
for (const [nom, n] of Object.entries(comptes)) {
  const plafond = PLAFONDS[nom];
  if (n > plafond) faute(`${nom} : ${n} pour un plafond de ${plafond}, la dette a monté`);
  else if (n < plafond) baisses.push(`${nom} ${n} (plafond ${plafond})`);
}

if (fautes) process.exit(1);
console.log(baisses.length
  ? `jetons uniques, plafonds tenus · abaisse : ${baisses.join(', ')}`
  : 'jetons uniques, plafonds tenus');
