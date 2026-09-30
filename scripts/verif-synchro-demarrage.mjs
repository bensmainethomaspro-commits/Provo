/**
 * Ce que devient un voyage au démarrage, quand le nuage répond.
 *
 * Reproduction du bug du 30 septembre 2026, gardée comme garde-fou. Supabase
 * est simulé (le bac à sable ne joint pas le projet) : session posée dans le
 * stockage, lecture et écriture de la table `trips` rejouées, panne réseau au
 * choix. Trois cas, tous vus sur le code d'avant :
 *
 *  A · modifié hors ligne ici, réseau lent   → la modification était PERDUE ;
 *  B · ce téléphone en retard sur un autre    → il RÉÉCRIVAIT le nuage avec sa
 *                                              vieille version ;
 *  C · le vrai geste : écrire hors ligne dans les notes, relancer l'app avec
 *      le réseau revenu                       → la note doit arriver au nuage.
 *
 * Demande l'aperçu lancé :  npx vite preview --port 4173
 * Usage :                   node scripts/verif-synchro-demarrage.mjs
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { trip as TRIP, settings as SETTINGS } from './ui-fixture.mjs';

const U = 'http://localhost:4173';
const REF = 'usztistixgzdrvjzplqx';
const chrome = (() => {
  const r = '/opt/pw-browsers';
  if (!existsSync(r)) return undefined;
  for (const d of readdirSync(r).filter(x => x.startsWith('chromium')).sort())
    for (const b of ['chrome-linux/chrome', 'chrome-linux/headless_shell'])
      if (existsSync(`${r}/${d}/${b}`)) return `${r}/${d}/${b}`;
  return undefined;
})();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
const session = { access_token: jwt, refresh_token: 'r', expires_at: exp, expires_in: 3600, token_type: 'bearer',
  user: { id: 'u1', aud: 'authenticated', email: 'a@b.c', user_metadata: {} } };

let echecs = 0;
const verifier = (nom, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${ok ? '' : `  (${detail})`}`);
  if (!ok) echecs++;
};

const nav = await chromium.launch({ executablePath: chrome });

/**
 * Un téléphone, et un nuage simulé qu'on peut couper. `stockage` amorce le
 * stockage local au premier chargement SEULEMENT : les rechargements suivants
 * doivent retrouver ce que l'app y a écrit elle-même.
 */
async function telephone({ stockage, nuage, delai = 0 }) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const etat = { nuage, panne: false, ecritures: [] };
  await p.route('**/*', async (r) => {
    const u = r.request().url(), m = r.request().method();
    if (u.startsWith(U)) return r.fallback();
    if (u.includes('/rest/v1/trips')) {
      if (etat.panne) return r.abort('internetdisconnected');
      if (m === 'GET') {
        await new Promise(res => setTimeout(res, delai));
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(etat.nuage ? [{ id: etat.nuage.id, data: etat.nuage }] : []) });
      }
      if (m === 'PATCH' || m === 'POST') {
        const corps = JSON.parse(r.request().postData() || '{}');
        // Comme la vraie base : créer un voyage qui existe déjà est refusé.
        if (m === 'POST' && etat.nuage?.id === corps.id) {
          return r.fulfill({ status: 409, contentType: 'application/json',
            body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "trips_pkey"' }) });
        }
        etat.ecritures.push(corps.data);
        etat.nuage = corps.data;
        return r.fulfill({ status: m === 'POST' ? 201 : 200, contentType: 'application/json',
          body: JSON.stringify([{ id: corps.data?.id }]) });
      }
    }
    if (u.includes('/rest/v1/')) return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    return r.abort();
  });
  await p.addInitScript(([s, cle, sess]) => {
    if (sessionStorage.getItem('amorce')) return;
    sessionStorage.setItem('amorce', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    localStorage.setItem(cle, sess);
  }, [stockage, `sb-${REF}-auth-token`, JSON.stringify(session)]);
  return { p, ctx, etat };
}

const base = { ...TRIP, id: 'voyage-1' };
const amorce = (local, extra = {}) => ({
  provo_trips: JSON.stringify([local]), provo_settings: JSON.stringify(SETTINGS),
  provo_onboarded: '1', ...extra,
});
const nomEnMemoire = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('provo_trips'))[0]?.name);

// ── A ─────────────────────────────────────────────────────────────────────────
console.log('A · modifié hors ligne sur ce téléphone, réseau lent (1,5 s)');
{
  const ancien = { ...base, name: 'Vienne' };
  const local = { ...base, name: 'Vienne (renommé hors ligne)' };
  const { p, ctx, etat } = await telephone({
    stockage: amorce(local, { provo_synchro: JSON.stringify({ [base.id]: { base: ancien } }) }),
    nuage: ancien, delai: 1500,
  });
  await p.goto(U + '/'); await p.waitForTimeout(4000);
  verifier('la modification est encore à l’écran', (await p.locator('.trip-card').first().innerText()).includes('renommé'));
  verifier('et dans le stockage local', (await nomEnMemoire(p))?.includes('renommé'), await nomEnMemoire(p));
  verifier('elle est partie vers le nuage', etat.nuage?.name?.includes('renommé'), etat.nuage?.name);
  await ctx.close();
}

// ── B ─────────────────────────────────────────────────────────────────────────
console.log('B · modifié sur un AUTRE appareil, ce téléphone en retard, réseau rapide');
{
  const local = { ...base, name: 'Vienne' };
  const nuage = { ...base, name: 'Vienne (modifié ailleurs)' };
  const { p, ctx, etat } = await telephone({ stockage: amorce(local), nuage, delai: 200 });
  await p.goto(U + '/'); await p.waitForTimeout(3000);
  verifier('l’écran montre la version de l’autre appareil', (await p.locator('.trip-card').first().innerText()).includes('ailleurs'));
  verifier('le nuage n’a PAS été réécrit avec la vieille version',
    !etat.ecritures.some(d => d?.name === 'Vienne'), etat.ecritures.map(d => d?.name).join(' · '));
  await ctx.close();
}

// ── C ─────────────────────────────────────────────────────────────────────────
console.log('C · écrire hors ligne dans les notes, relancer avec le réseau revenu');
{
  const { p, ctx, etat } = await telephone({ stockage: amorce(base), nuage: base, delai: 1500 });
  await p.goto(U + '/'); await p.waitForTimeout(3500);
  etat.panne = true;
  await p.locator('.trip-card').first().click(); await p.waitForTimeout(600);
  await p.locator('button[aria-label="Options du voyage"]').click(); await p.waitForTimeout(300);
  await p.locator('.trip-header-menu__item', { hasText: /Notes/ }).click(); await p.waitForTimeout(500);
  await p.locator('textarea').first().fill('Billets du métro dans la poche avant');
  await p.waitForTimeout(1500);
  const enAttente = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('provo_synchro') || '{}')));
  verifier('le voyage est noté « à envoyer » dans le stockage', enAttente.includes(base.id), JSON.stringify(enAttente));
  etat.panne = false;
  await p.reload(); await p.waitForTimeout(4000);
  const noteLocale = await p.evaluate(() => JSON.parse(localStorage.getItem('provo_trips'))[0]?.tripNotes);
  verifier('la note est toujours sur le téléphone', noteLocale === 'Billets du métro dans la poche avant', String(noteLocale));
  verifier('après la relance, la note est arrivée au nuage',
    etat.nuage?.tripNotes === 'Billets du métro dans la poche avant', String(etat.nuage?.tripNotes));
  const reste = await p.evaluate(() => localStorage.getItem('provo_synchro'));
  verifier('et plus rien n’attend', !reste, reste);
  await ctx.close();
}

await nav.close();
if (echecs) { console.log(`\n${echecs} échec(s)`); process.exit(1); }
console.log('\ntous les cas passent');
