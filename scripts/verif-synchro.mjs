/**
 * Vérifie ce que garde l'app quand le nuage répond au chargement.
 *
 * Le bug qu'elle ferme est de la PERTE DE DONNÉES, reproduit le 30 septembre
 * 2026 : la version du nuage remplaçait le voyage local, y compris les
 * modifications faites hors ligne et jamais envoyées. Et ce chargement a lieu
 * à chaque retour dans l'app, pas seulement au démarrage.
 *
 * `reconcilier` et la file d'attente sont importés de `src/utils/synchro.js` ;
 * la fusion est découpée dans `helpers.js`, comme dans `verif-fusion.mjs`.
 * Rien n'est recopié ici.
 *
 * Usage :  node scripts/verif-synchro.mjs
 */
import { readFileSync } from 'node:fs';
import { reconcilier, lireAttente, ecrireAttente, CLE_ATTENTE } from '../src/utils/synchro.js';

const src = readFileSync(new URL('../src/utils/helpers.js', import.meta.url), 'utf8');
const bloc = src.slice(src.indexOf('// ── Fusion de deux versions')).replace(/export /g, '');
const { fusionnerVoyages } = new Function(`${bloc}; return { fusionnerVoyages };`)();

const dep = (id, amount) => ({ id, amount, description: id });
const voyage = (expenses, extra = {}) => ({ id: 't', name: 'Vienne', expenses, ...extra });
const ids = (v) => (v?.expenses || []).map(e => e.id).join(',');

let echecs = 0, total = 0;
const verifier = (nom, ok, detail = '') => {
  total++;
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : `  (${detail})`}`);
  if (!ok) echecs++;
};

// ── reconcilier ───────────────────────────────────────────────────────────────
const base = voyage([dep('e1', 10)]);

{
  const nuage = voyage([dep('e1', 10), dep('B', 20)]);
  const r = reconcilier(base, nuage, undefined, fusionnerVoyages);
  verifier('rien en attente ici : le nuage fait foi (il a avancé ailleurs)', r === nuage, ids(r));
}
{
  const local = voyage([dep('e1', 10), dep('METRO', 7)]);
  const r = reconcilier(local, base, { base }, fusionnerVoyages);
  verifier('LE BUG : une dépense notée hors ligne survit au chargement', ids(r) === 'e1,METRO', ids(r));
}
{
  const local = voyage([dep('e1', 10), dep('ICI', 7)]);
  const nuage = voyage([dep('e1', 10), dep('LA', 20)]);
  const r = reconcilier(local, nuage, { base }, fusionnerVoyages);
  verifier('chacun a ajouté la sienne : les deux restent', ids(r) === 'e1,LA,ICI', ids(r));
}
{
  const local = voyage([]);
  const r = reconcilier(local, base, { base }, fusionnerVoyages);
  verifier('supprimée ici hors ligne : elle ne ressuscite pas', ids(r) === '', ids(r));
}
{
  const local = voyage([dep('e1', 10)]);
  const nuage = voyage([]);
  const r = reconcilier(local, nuage, { base }, fusionnerVoyages);
  verifier('supprimée ailleurs, rien changé ici : elle reste supprimée', ids(r) === '', ids(r));
}
{
  const local = voyage([dep('e1', 10)], { name: 'Vienne ✏️' });
  const r = reconcilier(local, base, { base }, fusionnerVoyages);
  verifier('un renommage hors ligne survit', r.name === 'Vienne ✏️', r.name);
}
{
  const local = voyage([dep('ICI', 7)]);
  const nuage = voyage([dep('LA', 20)]);
  const r = reconcilier(local, nuage, { base: null }, fusionnerVoyages);
  verifier('base perdue (stockage plein) : ce qui a été saisi ici l’emporte', r === local, ids(r));
}
{
  const nuage = voyage([dep('e1', 10)]);
  verifier('voyage absent du téléphone : celui du nuage', reconcilier(undefined, nuage, { base }, fusionnerVoyages) === nuage);
}

// ── la file d'attente dans le stockage ────────────────────────────────────────
const stockage = (limite = Infinity) => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > limite) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    brut: m,
  };
};
{
  const s = stockage();
  ecrireAttente(s, { t: { base } });
  const relu = lireAttente(s);
  verifier('la file survit à un redémarrage, base comprise', ids(relu.t?.base) === 'e1', JSON.stringify(relu));
}
{
  const s = stockage();
  ecrireAttente(s, { t: { base } });
  ecrireAttente(s, {});
  verifier('file vide : la clé disparaît', !s.brut.has(CLE_ATTENTE));
}
{
  const s = stockage(60);
  const gros = voyage(Array.from({ length: 50 }, (_, i) => dep(`e${i}`, i)));
  const ok = ecrireAttente(s, { t: { base: gros } });
  const relu = lireAttente(s);
  verifier('stockage plein : la liste des voyages en attente est gardée sans base',
    ok === false && relu.t && relu.t.base === null, JSON.stringify(relu));
}
{
  const s = stockage();
  s.setItem(CLE_ATTENTE, '{pas du json');
  verifier('clé corrompue : file vide, pas de plantage', Object.keys(lireAttente(s)).length === 0);
  s.setItem(CLE_ATTENTE, '[1,2]');
  verifier('clé d’un autre format : file vide', Object.keys(lireAttente(s)).length === 0);
}

if (echecs) { console.log(`\n${echecs} échec(s)`); process.exit(1); }
console.log(`\nles ${total} cas passent`);
