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
const { fusionnerVoyages, regrouperConflits, restaurerConflit } = new Function(
  `${bloc}; return { fusionnerVoyages, regrouperConflits, restaurerConflit };`)();

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

// ── Conflits : ce que la fusion tranche contre ce téléphone se DIT ──────────
// Le serveur gagne toujours (rien ne change de ce côté-là), mais la fusion
// rend la liste de ce qu'elle a tranché, et on peut remettre sa version.
const voyageurs = [{ id: 't1', name: 'Thomas' }, { id: 't2', name: 'Léa' }];
const conflitsDe = (base, local, distant) => {
  const liste = [];
  const r = fusionnerVoyages(base, local, distant, liste);
  return { r, liste, groupes: regrouperConflits(r, liste) };
};
const casConflits = [
  {
    nom: 'le même montant corrigé des deux côtés : une fiche, deux versions, et on peut remettre la sienne',
    faire() {
      const base = voyage([{ id: 'e1', description: 'Dîner', amount: 40, eurAmount: 40 }], { tripTravelers: voyageurs });
      const local = voyage([{ id: 'e1', description: 'Dîner', amount: 45, eurAmount: 45 }], { tripTravelers: voyageurs });
      const distant = voyage([{ id: 'e1', description: 'Dîner', amount: 42, eurAmount: 42 }], { tripTravelers: voyageurs });
      const { r, groupes } = conflitsDe(base, local, distant);
      const g = groupes[0];
      const remis = restaurerConflit(r, g);
      return r.expenses[0].amount === 42 && groupes.length === 1
        && g.genre === 'Dépense' && g.nom === 'Dîner'
        && g.lignes.length === 1 && g.lignes[0].mien === '45 EUR' && g.lignes[0].leur === '42 EUR'
        // Le montant en euros suit le montant, même s'il ne se montre pas.
        && remis.expenses[0].amount === 45 && remis.expenses[0].eurAmount === 45;
    },
  },
  {
    nom: 'aucun conflit quand chacun touche à un champ différent',
    faire() {
      const base = voyage([{ id: 'e1', amount: 10, description: 'a' }]);
      const { liste } = conflitsDe(base,
        voyage([{ id: 'e1', amount: 12, description: 'a' }]),
        voyage([{ id: 'e1', amount: 10, description: 'b' }]));
      return liste.length === 0;
    },
  },
  {
    nom: 'aucun conflit quand les deux arrivent à la même valeur',
    faire() {
      const { liste } = conflitsDe(voyage([dep('e1', 10)]), voyage([dep('e1', 12)]), voyage([dep('e1', 12)]));
      return liste.length === 0;
    },
  },
  {
    nom: 'modifiée ici, supprimée là-bas : la suppression gagne, se dit, et se défait à sa place',
    faire() {
      const jour = (acts) => voyage([], { days: [{ id: 'd1', activities: acts }] });
      const a1 = { id: 'a1', title: 'Musée' }, a2 = { id: 'a2', title: 'Café' }, a3 = { id: 'a3', title: 'Opéra' };
      const { r, groupes } = conflitsDe(jour([a1, a2, a3]),
        jour([a1, { ...a2, title: 'Café Central' }, a3]), jour([a1, a3]));
      const g = groupes[0];
      const remis = restaurerConflit(r, g);
      return r.days[0].activities.length === 2 && groupes.length === 1 && g.supprime
        && g.genre === 'Activité' && g.nom === 'Café Central'
        && remis.days[0].activities.map(a => a.id).join(',') === 'a1,a2,a3'
        && remis.days[0].activities[1].title === 'Café Central';
    },
  },
  {
    nom: 'un champ technique en conflit ne dérange personne',
    faire() {
      const { liste, groupes } = conflitsDe(
        voyage([{ id: 'e1', amount: 10, enrichAt: 1 }]),
        voyage([{ id: 'e1', amount: 10, enrichAt: 2 }]),
        voyage([{ id: 'e1', amount: 10, enrichAt: 3 }]));
      return liste.length === 1 && groupes.length === 0;
    },
  },
  {
    nom: 'les voyageurs se lisent par leur prénom, pas par leur identifiant',
    faire() {
      const v = (payerId) => voyage([{ id: 'e1', payerId, description: 'Taxi' }], { tripTravelers: voyageurs });
      const { groupes } = conflitsDe(v('t1'), v('t2'), v('zz'));
      const l = groupes[0]?.lignes[0];
      return l?.champ === 'Payé par' && l.mien === 'Léa' && l.leur === 'voyageur retiré';
    },
  },
  {
    nom: 'un champ du voyage lui-même se range sous « Voyage »',
    faire() {
      const { groupes } = conflitsDe(voyage([], { initialBudget: 800 }),
        voyage([], { initialBudget: 900 }), voyage([], { initialBudget: 950 }));
      const remis = restaurerConflit(voyage([], { initialBudget: 950 }), groupes[0]);
      return groupes[0]?.genre === 'Voyage' && remis.initialBudget === 900;
    },
  },
  {
    nom: 'remettre sa version sur une fiche disparue entre-temps ne casse rien',
    faire() {
      const base = voyage([{ id: 'e1', amount: 10, description: 'x' }]);
      const { groupes } = conflitsDe(base, voyage([{ id: 'e1', amount: 11, description: 'x' }]),
        voyage([{ id: 'e1', amount: 12, description: 'x' }]));
      const apres = voyage([]);
      return JSON.stringify(restaurerConflit(apres, groupes[0])) === JSON.stringify(apres);
    },
  },
  {
    nom: 'sans collecteur, la fusion reste celle d\'avant',
    faire() {
      const base = voyage([dep('e1', 10)]);
      const a = fusionnerVoyages(base, voyage([dep('e1', 11)]), voyage([dep('e1', 12)]));
      return a.expenses[0].amount === 12;
    },
  },
];
for (const c of casConflits) {
  let ok = false, jete = '';
  try { ok = c.faire(); } catch (e) { jete = String(e.message || e); }
  if (!ok) casses++;
  console.log(`${ok ? '✓' : '✗'} ${c.nom}`);
  if (jete) console.log(`   a jeté : ${jete}`);
}

const total = cas.length + 1 + casConflits.length;
console.log(casses ? `\n${casses} cas cassé(s) sur ${total}` : `\nles ${total} cas passent\n`);
process.exit(casses ? 1 : 0);
