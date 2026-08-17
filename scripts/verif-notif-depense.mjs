/**
 * Vérifie ce qui s'affiche quand un voyageur note une dépense commune.
 *
 * Une notification est le seul écran de l'app qu'on ne peut pas corriger après
 * coup : elle sonne une fois, sur un écran verrouillé, et si elle n'aide pas,
 * on coupe les notifications — en emportant celles qui servaient. Deux choses
 * se vérifient ici :
 *
 *   1. QUI on dérange — une dépense pour soi seul ne concerne personne ;
 *   2. CE QU'ON ÉCRIT — le titre et le montant demandés, avec le bon verbe
 *      selon qu'il s'agit d'une dépense, d'une rentrée d'argent (montant
 *      négatif) ou d'un remboursement.
 *
 * Les deux fonctions sont découpées dans la fonction Edge, jamais recopiées :
 * un test qui recopie le code qu'il teste ne teste plus rien. Le reste de la
 * fonction — authentification, appartenance au voyage, envoi — demande
 * Supabase et des clés VAPID ; il n'est pas rejoué ici.
 *
 * Usage :  node scripts/verif-notif-depense.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../supabase/functions/notifier-depense/index.ts', import.meta.url), 'utf8');
const debut = src.indexOf('/** Un montant en euros');
const fin = src.indexOf('const dors =');
// Le fichier est du TypeScript : les annotations tombent, la logique reste.
// Le type de retour se retire d'abord — il porte des accolades, et les
// annotations de paramètres se nettoient ensuite sans lui marcher dessus.
const bloc = src.slice(debut, fin)
  .replace(/\)\s*:\s*\{[^}]*\}\s*\{/g, ') {')
  .replace(/:\s*(any|string|number|boolean)\b/g, '');
const { doitNotifier, messageDepense } = new Function(
  `${bloc}; return { doitNotifier, messageDepense };`)();

const voyage = {
  name: 'Vienne', emoji: '🇦🇹',
  tripTravelers: [
    { id: 't1', name: 'Thomas', emoji: '🧔' },
    { id: 't2', name: 'Léa', emoji: '👩' },
  ],
};

// ── 1 · Qui on dérange ───────────────────────────────────────────────────────
const qui = [
  [{ participantIds: ['t1', 't2'] }, true, 'une dépense partagée à deux'],
  [{ participantIds: ['t1'] }, false, 'une dépense pour soi seul'],
  [{ participantIds: [] }, false, 'une dépense sans participant'],
  [{}, false, "une dépense d'une version antérieure, sans le champ"],
  [{ participantIds: ['t1'], isSettlement: true }, true,
    "un remboursement, même à un seul destinataire : il change ce que l'autre doit"],
  [null, false, 'rien du tout'],
];

// ── 2 · Ce qu'on écrit ───────────────────────────────────────────────────────
const textes = [
  [{ description: 'Dîner Figlmüller', eurAmount: 52.4, payerId: 't2',
    participantIds: ['t1', 't2'] },
    '👩 Léa a ajouté « Dîner Figlmüller » — 52,40 €',
    'le titre et le montant, comme demandé'],
  [{ description: 'Taxi', eurAmount: 30, payerId: 't1', participantIds: ['t1', 't2'] },
    '🧔 Thomas a ajouté « Taxi » — 30 €',
    'un compte rond reste rond'],
  [{ description: 'Remboursement', eurAmount: 26, payerId: 't1',
    participantIds: ['t2'], isSettlement: true },
    '🧔 Thomas a noté un remboursement de 26 €',
    "un remboursement n'a pas de titre à annoncer"],
  [{ description: 'Caution rendue', eurAmount: -40, payerId: 't2',
    participantIds: ['t1', 't2'] },
    '👩 Léa a noté une rentrée de « Caution rendue » — 40 €',
    'un revenu est stocké en négatif : le verbe suit le signe, pas « a ajouté −40 € »'],
  [{ description: '   ', eurAmount: 12, payerId: 't1', participantIds: ['t1', 't2'] },
    '🧔 Thomas a ajouté « Dépense » — 12 €',
    'un titre vide ne laisse pas de trou'],
  [{ description: 'Café', eurAmount: 8, payerId: 'inconnu',
    participantIds: ['t1', 't2'] },
    "Quelqu'un a ajouté « Café » — 8 €",
    'un payeur retiré du voyage ne sort pas son identifiant technique'],
  [{ description: 'Musée', amount: 21, payerId: 't1', participantIds: ['t1', 't2'] },
    '🧔 Thomas a ajouté « Musée » — 21 €',
    'sans `eurAmount`, le montant fait foi'],
];

// `Intl` sépare le montant de son symbole par une espace insécable étroite
// (U+202F). Invisible à la lecture, fatale à une comparaison de chaînes : on
// compare donc à espacement normalisé, sinon le test échoue sur ce qui se lit
// exactement pareil.
const plat = (s) => String(s).replace(/[\u202f\u00a0]/g, ' ');

let casses = 0;
for (const [dep, attendu, quoi] of qui) {
  const rendu = doitNotifier(dep);
  const ok = rendu === attendu;
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} on ${attendu ? 'prévient' : 'se tait'} — ${quoi}`);
  if (!ok) console.log(`   rendu : ${rendu}`);
}

for (const [dep, attendu, quoi] of textes) {
  const m = messageDepense(voyage, dep);
  const ok = plat(m.corps) === plat(attendu) && m.titre === '🇦🇹 Vienne';
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} « ${attendu} »   ${quoi}`);
  if (!ok) console.log(`   rendu : « ${m.titre} » / « ${m.corps} »`);
}

const total = qui.length + textes.length;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}\n` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
