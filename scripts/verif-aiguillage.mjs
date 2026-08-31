/**
 * Vérifie le garde-fou SSRF de `extract-place` : quelle URL est acceptée, et
 * vers quel lecteur elle part.
 *
 * Le trou que ça referme : le routeur cherchait « tiktok.com » dans l'URL
 * ENTIÈRE, chemin compris. `POST {"url":"http://10.0.0.5/tiktok.com"}` partait
 * donc chez le lecteur TikTok — qui joint l'adresse telle quelle, depuis
 * l'hébergeur, à l'intérieur de son réseau. Un chemin n'est pas un domaine, et
 * c'est celui qui appelle qui écrit le chemin.
 *
 * Les deux fonctions sont découpées dans la source, jamais recopiées.
 *
 * Usage :  node scripts/verif-aiguillage.mjs
 */
import { readFileSync } from 'node:fs';

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');
// Le TypeScript est retiré à la main : le type de RETOUR d'abord — il peut
// porter des accolades ou des unions — puis les annotations de paramètres.
const ts = (bloc) => bloc
  .replace(/\)\s*:\s*[^{;]+\{/g, ') {')
  .replace(/:\s*(URL|string|number|boolean|any)\b/g, '')
  .replace(/export /g, '');

const reseau = lire('../supabase/functions/_shared/reseau.ts');
const extract = lire('../supabase/functions/extract-place/index.ts');
const blocAig = extract.slice(
  extract.indexOf('function aiguillage'),
  extract.indexOf('Deno.serve'));

const { urlSure, aiguillage } = new Function(
  `${ts(reseau.slice(reseau.indexOf('export const PRIVE')))}
   ${ts(blocAig)}
   return { urlSure, aiguillage };`)();

// ── 1 · Ce qui ne doit JAMAIS être joint ────────────────────────────────────
const refus = [
  ['http://10.0.0.5/tiktok.com', "l'attaque de l'audit : une adresse interne déguisée en chemin"],
  ['http://127.0.0.1/tiktok.com/video/1', 'la boucle locale'],
  ['http://localhost:8000/', 'la machine elle-même'],
  ['http://169.254.169.254/latest/meta-data/', 'le service de métadonnées de l\'hébergeur'],
  ['http://192.168.1.1/admin', 'le réseau domestique'],
  ['http://172.16.0.9/', 'la plage privée 172.16–172.31'],
  ['http://[::1]/', 'la boucle locale en IPv6'],
  ['http://supabase-db/', "un nom sans point : une machine du réseau local"],
  ['file:///etc/passwd', 'un autre protocole'],
  ['ftp://exemple.com/', 'un autre protocole, avec un hôte pourtant public'],
  ['pas une url', 'du texte'],
];

// ── 2 · Ce qui doit passer, et par quelle voie ──────────────────────────────
const voies = [
  ['https://www.tiktok.com/@moi/video/123', 'tiktok', 'un lien TikTok normal'],
  ['https://vm.tiktok.com/ZGabc/', 'tiktok', 'un lien TikTok court'],
  ['https://tiktok.com/@moi', 'tiktok', 'sans sous-domaine'],
  ['https://exemple.com/tiktok.com/piege', 'generique',
    "un chemin qui imite un domaine ne détourne plus l'aiguillage"],
  ['https://tiktok.com.pirate.net/x', 'generique',
    'un domaine qui COMMENCE par tiktok.com ne suffit pas'],
  ['https://maps.app.goo.gl/xyz', 'maps', 'un lien Google Maps court'],
  ['https://goo.gl/maps/abc', 'maps', "l'ancien format court"],
  ['https://share.google/abc', 'maps', 'le format de partage'],
  ['https://maps.google.com/?q=48.2,16.3', 'maps', 'Maps sans /maps dans le chemin'],
  ['https://www.google.com/maps/place/Vienne', 'maps', 'Maps sur google.com'],
  ['https://www.google.fr/maps/place/Paris', 'maps', 'Maps sur un google national'],
  ['https://www.google.com/search?q=vienne', 'generique',
    "une recherche Google n'est pas une carte"],
  ['https://goo.gl.pirate.net/maps/x', 'generique',
    'un domaine qui imite goo.gl ne passe pas pour une carte'],
  ['https://www.instagram.com/p/abc/', 'generique', 'tout le reste'],
];

let casses = 0;
for (const [entree, quoi] of refus) {
  const ok = urlSure(entree) === null;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} refusé : ${entree}   — ${quoi}`);
  if (!ok) console.log('   … a été acceptée');
}

for (const [entree, attendu, quoi] of voies) {
  const u = urlSure(entree);
  const rendu = u ? aiguillage(u) : '(refusée)';
  const ok = rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${attendu.padEnd(10)} ${entree}   — ${quoi}`);
  if (!ok) console.log(`   rendu : ${rendu}`);
}

const total = refus.length + voies.length;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
