/**
 * Vérifie la fusion à trois voies d'un voyage.
 *
 * Le bug qu'elle corrige est de la PERTE DE DONNÉES : deux appareils sur le
 * même compte s'écrasaient l'un l'autre, et la dépense du perdant disparaissait
 * de partout. Les cas ci-dessous couvrent les deux erreurs symétriques —
 * perdre ce qui vient d'être ajouté, et ressusciter ce qui vient d'être
 * supprimé. La seconde est le piège habituel des fusions à deux voies.
 *
 * La fonction est découpée dans `helpers.js`, jamais recopiée ici.
 *
 * Usage :  node scripts/verif-fusion.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/utils/helpers.js', import.meta.url), 'utf8');
const bloc = src.slice(src.indexOf('// ── Fusion de deux versions')).replace(/export /g, '');
const { fusionnerVoyages } = new Function(`${bloc}; return { fusionnerVoyages };`)();

const dep = (id, amount) => ({ id, amount, description: id });
const voyage = (expenses, extra = {}) => ({
  id: 't', name: 'Vienne', initialBudget: 800, expenses, ...extra,
});
const ids = (v) => (v.expenses || []).map(e => e.id).join(',');

const cas = [
  {
    nom: 'LE BUG : chacun ajoute une dépense — aucune ne disparaît',
    base: voyage([dep('e1', 10)]),
    local: voyage([dep('e1', 10), dep('X', 30)]),
    distant: voyage([dep('e1', 10), dep('Y', 20)]),
    attendu: (r) => ids(r).split(',').sort().join(',') === 'X,Y,e1',
  },
  {
    nom: 'une suppression distante ne ressuscite pas',
    base: voyage([dep('e1', 10), dep('e2', 20)]),
    local: voyage([dep('e1', 10), dep('e2', 20)]),
    distant: voyage([dep('e1', 10)]),
    attendu: (r) => ids(r) === 'e1',
  },
  {
    nom: 'une suppression locale reste supprimée',
    base: voyage([dep('e1', 10), dep('e2', 20)]),
    local: voyage([dep('e1', 10)]),
    distant: voyage([dep('e1', 10), dep('e2', 20)]),
    attendu: (r) => ids(r) === 'e1',
  },
  {
    nom: 'supprimé ici, ajouté là-bas : les deux gestes sont respectés',
    base: voyage([dep('e1', 10), dep('e2', 20)]),
    local: voyage([dep('e1', 10)]),
    distant: voyage([dep('e1', 10), dep('e2', 20), dep('Z', 5)]),
    attendu: (r) => ids(r).split(',').sort().join(',') === 'Z,e1',
  },
  {
    nom: 'une modification locale seule survit à la réception',
    base: voyage([dep('e1', 10)]),
    local: voyage([dep('e1', 10)], { name: 'Vienne en hiver' }),
    distant: voyage([dep('e1', 10)]),
    attendu: (r) => r.name === 'Vienne en hiver',
  },
  {
    nom: 'une modification distante seule est appliquée',
    base: voyage([dep('e1', 10)]),
    local: voyage([dep('e1', 10)]),
    distant: voyage([dep('e1', 10)], { initialBudget: 950 }),
    attendu: (r) => r.initialBudget === 950,
  },
  {
    nom: 'les deux modifient le même champ : le serveur tranche',
    base: voyage([dep('e1', 10)]),
    local: voyage([dep('e1', 10)], { initialBudget: 900 }),
    distant: voyage([dep('e1', 10)], { initialBudget: 950 }),
    attendu: (r) => r.initialBudget === 950,
  },
  {
    nom: 'le montant modifié ici et le partage changé là-bas tiennent ensemble',
    base: voyage([{ id: 'e1', amount: 10, parts: {} }]),
    local: voyage([{ id: 'e1', amount: 42, parts: {} }]),
    distant: voyage([{ id: 'e1', amount: 10, parts: { a: 2 } }]),
    attendu: (r) => r.expenses[0].amount === 42 && r.expenses[0].parts.a === 2,
  },
  {
    nom: 'une activité ajoutée dans un jour survit (collection imbriquée)',
    base: voyage([], { days: [{ id: 'd1', activities: [{ id: 'a1', title: 'Musée' }] }] }),
    local: voyage([], { days: [{ id: 'd1', activities: [{ id: 'a1', title: 'Musée' }, { id: 'a2', title: 'Café' }] }] }),
    distant: voyage([], { days: [{ id: 'd1', activities: [{ id: 'a1', title: 'Musée' }, { id: 'a3', title: 'Opéra' }] }] }),
    attendu: (r) => r.days[0].activities.map(a => a.id).sort().join(',') === 'a1,a2,a3',
  },
  {
    nom: 'sans base connue, on se rabat sur le distant — pas de régression',
    base: null,
    local: voyage([dep('e1', 10), dep('X', 30)]),
    distant: voyage([dep('e1', 10)]),
    attendu: (r) => ids(r) === 'e1',
  },
];

let casses = 0;
for (const c of cas) {
  let r, jete = '';
  try { r = fusionnerVoyages(c.base, c.local, c.distant); }
  catch (e) { jete = String(e.message || e); }
  const ok = !jete && c.attendu(r);
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${c.nom}`);
  if (jete) console.log(`   a jeté : ${jete}`);
  else if (!ok) console.log(`   rendu : ${JSON.stringify(r).slice(0, 200)}`);
}

// Refusionner un résultat déjà fusionné ne doit plus rien changer : sans ça,
// deux appareils se renverraient des versions différentes indéfiniment.
{
  const base = voyage([dep('e1', 10)]);
  const A = voyage([dep('e1', 10), dep('X', 30)]);
  const B = voyage([dep('e1', 10), dep('Y', 20)]);
  const un = fusionnerVoyages(base, A, B);
  const deux = fusionnerVoyages(un, un, un);
  const ok = JSON.stringify(un) === JSON.stringify(deux);
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} refusionner ne change plus rien (les appareils convergent)`);
}

const total = cas.length + 1;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
