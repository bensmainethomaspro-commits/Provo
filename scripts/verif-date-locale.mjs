/**
 * Vérifie que la date d'aujourd'hui est celle du voyageur, pas celle de
 * Greenwich.
 *
 * Le bug : `new Date().toISOString().slice(0, 10)` rend la date UTC. Une app
 * de voyage s'utilise par définition sous d'autres fuseaux, et l'écart se voit
 * dans les deux sens :
 *
 *   · à Tokyo (UTC+9), toute la matinée est encore « hier » pour UTC — un café
 *     noté au petit-déjeuner se rangeait la veille ;
 *   · à New York (UTC−5), toute la soirée est déjà « demain » — un dîner se
 *     rangeait le lendemain.
 *
 * Les deux fois, la dépense atterrit le mauvais jour et rien ne le signale.
 *
 * La fonction est découpée dans `helpers.js`, jamais recopiée.
 *
 * Usage :  node scripts/verif-date-locale.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/utils/helpers.js', import.meta.url), 'utf8');
const bloc = src.slice(src.indexOf('export function dateLocale')).replace(/export /g, '');
const { dateLocale } = new Function(`${bloc}; return { dateLocale };`)();

// Instant précis + fuseau → la date que le voyageur lit sur son téléphone.
const cas = [
  ['Asia/Tokyo', '2026-08-31T23:00:00Z', '2026-09-01',
    "8 h du matin à Tokyo : UTC dit encore la veille"],
  ['Asia/Tokyo', '2026-08-31T15:30:00Z', '2026-09-01',
    'minuit trente à Tokyo : le jour a changé là-bas, pas ici'],
  ['Asia/Tokyo', '2026-08-31T02:00:00Z', '2026-08-31',
    'onze heures du matin à Tokyo : les deux sont d\'accord'],
  ['America/New_York', '2026-09-01T02:00:00Z', '2026-08-31',
    'dix heures du soir à New York : UTC est déjà demain'],
  ['America/New_York', '2026-08-31T16:00:00Z', '2026-08-31',
    'midi à New York : les deux sont d\'accord'],
  ['Pacific/Auckland', '2026-08-31T20:00:00Z', '2026-09-01',
    'huit heures du matin à Auckland (UTC+12)'],
  ['Europe/Paris', '2026-08-31T22:30:00Z', '2026-09-01',
    "minuit trente à Paris en été : même l'heure d'été suffit à décaler"],
  ['UTC', '2026-08-31T12:00:00Z', '2026-08-31', 'à Greenwich, rien ne change'],
];

let casses = 0;
for (const [fuseau, instant, attendu, quoi] of cas) {
  process.env.TZ = fuseau;
  const d = new Date(instant);
  const rendu = dateLocale(d);
  const utc = d.toISOString().slice(0, 10);
  const ok = rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${fuseau.padEnd(18)} ${instant} → ${attendu}`
    + `${utc === attendu ? '' : `   (UTC dirait ${utc})`}`);
  console.log(`   ${quoi}`);
  if (!ok) console.log(`   rendu : ${rendu}`);
}

// Sans argument, c'est maintenant — et ça doit rester cohérent avec l'horloge
// locale, quel que soit le fuseau où tourne le test.
process.env.TZ = 'Asia/Tokyo';
{
  const n = new Date();
  const attendu = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  const ok = dateLocale() === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} sans argument, c'est aujourd'hui ici et maintenant`);
}

const total = cas.length + 1;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
