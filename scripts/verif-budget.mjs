/**
 * Le budget de temps des fonctions Edge : un appel entier tient en 20 s.
 *
 * Le défaut refermé (audit A-012, côté serveur) : chaque requête sortante
 * avait son délai, mais `extract-place` en enchaîne plusieurs, et leurs
 * délais s'additionnaient au-delà de la minute. L'app coupe à 25 s ; le
 * serveur continuait pour une réponse que personne n'attendait.
 *
 * Deux étages :
 *  1. le module `_shared/budget.ts`, importé tel quel (Node retire les types) ;
 *  2. le VRAI gestionnaire d'`extract-place` et d'`enrich-place`, exécuté sous
 *     Node avec un réseau qui ne répond jamais : c'est le pire cas, et le seul
 *     qui prouve que le budget borne l'appel entier. Une requête partie sans
 *     signal y attendrait pour toujours : le test le verrait aussi.
 *
 * Aucun réseau réel. Environ 25 s, à cause du budget réel de 20 s.
 * Usage :  node scripts/verif-budget.mjs
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let casses = 0;
const verifier = (nom, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : `  (${detail})`}`);
  if (!ok) casses++;
};

// ── Un réseau qui ne répond jamais : seule une annulation rend la main ───────
const appels = [];
globalThis.fetch = (url, init = {}) => new Promise((_, rejeter) => {
  appels.push(String(url));
  const s = init.signal;
  const couper = () => rejeter(new DOMException('annulé', 'AbortError'));
  if (s?.aborted) return couper();
  s?.addEventListener('abort', couper, { once: true });
});
const attendre = (ms) => new Promise(r => setTimeout(r, ms));

const { dansLeBudget, withTimeout, budgetActif, BUDGET_MS } =
  await import('../supabase/functions/_shared/budget.ts');

// ── 1 · Le module ────────────────────────────────────────────────────────────
{
  const t0 = Date.now();
  await dansLeBudget(300, null, async () => {
    const { signal } = withTimeout(5000);
    await fetch('https://a.test', { signal }).catch(() => {});
  });
  const duree = Date.now() - t0;
  verifier('une requête de 5 s est coupée à la fin d’un budget de 300 ms', duree < 700, `${duree} ms`);
}
{
  let apres = -1;
  await dansLeBudget(200, null, async () => {
    await attendre(250);
    const t0 = Date.now();
    const { signal } = withTimeout(5000);
    await fetch('https://b.test', { signal }).catch(() => {});
    apres = Date.now() - t0;
  });
  verifier('budget épuisé : la requête suivante échoue tout de suite', apres >= 0 && apres < 50, `${apres} ms`);
}
{
  const t0 = Date.now();
  const { signal } = withTimeout(200);
  await fetch('https://c.test', { signal }).catch(() => {});
  const duree = Date.now() - t0;
  verifier('hors budget, le délai de la requête reste le sien', duree >= 180 && duree < 600, `${duree} ms`);
}
{
  const client = new AbortController();
  setTimeout(() => client.abort(), 150);
  const t0 = Date.now();
  await dansLeBudget(5000, client.signal, async () => {
    const { signal } = withTimeout(5000);
    await fetch('https://d.test', { signal }).catch(() => {});
  });
  const duree = Date.now() - t0;
  verifier('l’appelant qui raccroche arrête le travail', duree < 600, `${duree} ms`);
}
{
  // Deux appels simultanés : le budget court de l'un ne coupe pas l'autre.
  let dureeLong = 0;
  const long = dansLeBudget(1200, null, async () => {
    await attendre(10);
    const t0 = Date.now();
    const { signal } = withTimeout(5000);
    await fetch('https://e.test', { signal }).catch(() => {});
    dureeLong = Date.now() - t0;
  });
  const court = dansLeBudget(150, null, async () => {
    const { signal } = withTimeout(5000);
    await fetch('https://f.test', { signal }).catch(() => {});
  });
  await Promise.all([long, court]);
  verifier('deux appels simultanés gardent chacun leur budget', dureeLong > 1000 && dureeLong < 1500, `${dureeLong} ms`);
}
{
  let vu = false;
  await dansLeBudget(500, null, async () => { await attendre(5); vu = budgetActif(); });
  verifier('le budget suit l’appel à travers les `await`', vu);
}

// ── 2 · Les vrais gestionnaires, réseau muet ─────────────────────────────────
// Copie temporaire à côté de l'original (ses imports relatifs doivent
// résoudre), sans la ligne `jsr:` que Node ne sait pas charger.
const gestionnaires = {};
globalThis.Deno = { serve: (h) => { gestionnaires.dernier = h; }, env: { get: () => undefined } };
async function charger(nom) {
  const dossier = new URL(`../supabase/functions/${nom}/`, import.meta.url);
  const source = readFileSync(new URL('index.ts', dossier), 'utf8').replace(/^import "jsr:.*$/m, '');
  const copie = new URL('_verif_budget_tmp.ts', dossier);
  writeFileSync(copie, source);
  try {
    await import(copie.href);
  } finally {
    rmSync(copie, { force: true });
  }
  return gestionnaires.dernier;
}

const extraire = await charger('extract-place');
const enrichir = await charger('enrich-place');
const requete = (corps, signal) => new Request('http://localhost/', {
  method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' }, signal,
});

{
  const client = new AbortController();
  setTimeout(() => client.abort(), 1500);
  const chrono = async (h, corps, signal) => {
    const t0 = Date.now();
    const r = await h(requete(corps, signal));
    return { duree: Date.now() - t0, corps: await r.json().catch(() => null) };
  };
  appels.length = 0;
  // Les trois en même temps : ~20 s en tout, et la preuve que le client qui
  // raccroche ne coupe que SON appel.
  const [ext, enr, parti] = await Promise.all([
    chrono(extraire, { url: 'https://www.example.com/un-lieu', destination: 'Vienne' }),
    chrono(enrichir, { name: 'Café Central', lat: 48.21, lon: 16.36, website: 'https://www.example.com/' }),
    chrono(extraire, { url: 'https://www.example.com/autre', destination: 'Vienne' }, client.signal),
  ]);
  const plafond = BUDGET_MS + 1500;
  verifier(`extract-place rend la main avant ${plafond / 1000} s, réseau muet`, ext.duree < plafond,
    `${(ext.duree / 1000).toFixed(1)} s`);
  verifier('et répond quelque chose de lisible', !!ext.corps && typeof ext.corps === 'object', JSON.stringify(ext.corps));
  verifier(`enrich-place rend la main avant ${plafond / 1000} s, réseau muet`, enr.duree < plafond,
    `${(enr.duree / 1000).toFixed(1)} s`);
  verifier('un appelant qui raccroche à 1,5 s libère son appel aussitôt', parti.duree < 3000,
    `${(parti.duree / 1000).toFixed(1)} s`);
  verifier('les appels ont bien tenté le réseau (le test a porté)', appels.length > 3, `${appels.length} appel(s)`);
}

console.log(casses ? `\n${casses} cas cassé(s)` : '\nles 11 cas passent');
process.exit(casses ? 1 : 0);
