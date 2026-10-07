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
 * Et deux cas du 30 septembre 2026, soir (amélioration « conflits ») :
 *  D · le même champ modifié ici ET ailleurs  → le serveur tranche, mais une
 *                                              feuille le dit et laisse
 *                                              remettre sa version ;
 *  E · seul un champ technique diverge        → rien ne s'ouvre.
 *
 * Et les pièces jointes, sorties du voyage (utils/pieces.js) :
 *  F · un voyage qui porte ses pièces en base64 → elles en sortent, partent
 *      dans le dossier du voyage, et s'affichent toujours ;
 *  G · un autre téléphone                      → il les rapatrie, et les garde
 *                                              sans réseau.
 *
 * Et deux cas de l'audit du 5 octobre 2026 :
 *  H · le nuage a le base64, le dépôt échoue   → le nuage GARDE sa copie tant
 *      (A-061)                                   que la pièce n'est pas dans
 *                                                son dossier ;
 *  I · une pièce pas encore déposée par        → elle est redemandée seule,
 *      l'autre téléphone (A-062)                 sans attendre une modification ;
 *  J · sans compte, pas de nuage               → les pièces sortent du voyage
 *                                                tout de suite, comme avant.
 *
 * Et dans TOUS les cas, à chaque écriture du voyage : une donnée que le nuage
 * avait ne disparaît jamais du voyage avant d'être dans son dossier (A-061).
 *
 * Demande l'aperçu lancé :  npx vite preview --port 4173
 * Usage :                   node scripts/verif-synchro-demarrage.mjs
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
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

// Les données lourdes d'un voyage (celles que l'app sort dans le dossier du
// nuage), et l'identifiant que l'app leur donne : 12 octets de SHA-256.
const DONNEES = /"(data:(?:image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,[^"]{2000,})"/g;
const donneesDe = (o) => new Set([...JSON.stringify(o ?? null).matchAll(DONNEES)].map(m => m[1]));
const idPiece = (data) => createHash('sha256').update(data).digest('hex').slice(0, 24);

/**
 * Un téléphone, et un nuage simulé qu'on peut couper. `stockage` amorce le
 * stockage local au premier chargement SEULEMENT : les rechargements suivants
 * doivent retrouver ce que l'app y a écrit elle-même.
 */
async function telephone({ stockage, nuage, delai = 0, pieces = new Map(), connecte = true }) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  // `copiesPerdues` : chaque donnée qu'une écriture a retirée du nuage alors
  // que sa pièce n'était pas encore dans le dossier du voyage (A-061).
  const etat = { nuage, panne: false, ecritures: [], pieces, stockageCoupe: false, lectures: 0, copiesPerdues: [] };
  await p.route('**/*', async (r) => {
    const u = r.request().url(), m = r.request().method();
    if (u.startsWith(U)) return r.fallback();
    // Le dossier des pièces jointes (Supabase Storage), partagé entre les
    // téléphones d'un même cas : ce que l'un dépose, l'autre le rapatrie.
    const chemin = /\/storage\/v1\/object\/pieces\/(.+)$/.exec(u)?.[1];
    if (chemin) {
      if (etat.stockageCoupe) return r.abort('internetdisconnected');
      const cle = decodeURIComponent(chemin);
      if (m === 'POST') {
        if (etat.pieces.has(cle)) return r.fulfill({ status: 400, contentType: 'application/json',
          body: JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }) });
        etat.pieces.set(cle, { corps: r.request().postDataBuffer(), type: r.request().headers()['content-type'] });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `pieces/${cle}` }) });
      }
      etat.lectures++;
      const piece = etat.pieces.get(cle);
      return piece ? r.fulfill({ status: 200, contentType: piece.type, body: piece.corps })
        : r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ statusCode: '404', error: 'not_found' }) });
    }
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
        const avant = etat.nuage?.id === corps.data?.id ? donneesDe(etat.nuage) : new Set();
        const apres = donneesDe(corps.data);
        for (const d of avant) {
          if (!apres.has(d) && !etat.pieces.has(`${corps.data.id}/${idPiece(d)}`)) etat.copiesPerdues.push(idPiece(d));
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
    if (sess) localStorage.setItem(cle, sess);
  }, [stockage, `sb-${REF}-auth-token`, connecte ? JSON.stringify(session) : null]);
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

// ── D ─────────────────────────────────────────────────────────────────────────
console.log('D · le même montant corrigé ici hors ligne ET ailleurs : on le dit, on laisse choisir');
{
  const avec = (montant) => ({ ...base, expenses: base.expenses.map(e => e.id === 'e1'
    ? { ...e, amount: montant, eurAmount: montant } : e) });
  const { p, ctx, etat } = await telephone({
    stockage: amorce(avec(150), { provo_synchro: JSON.stringify({ [base.id]: { base: avec(148) } }) }),
    nuage: avec(160), delai: 300,
  });
  const montantLocal = () => p.evaluate(() =>
    JSON.parse(localStorage.getItem('provo_trips'))[0]?.expenses.find(e => e.id === 'e1')?.amount);
  await p.goto(U + '/'); await p.waitForTimeout(2500);
  await p.locator('.trip-card').first().click(); await p.waitForTimeout(1200);
  const carte = p.locator('.conflit-card');
  verifier('une feuille montre le conflit en ouvrant le voyage', await carte.count() === 1, `${await carte.count()} carte(s)`);
  const texte = (await carte.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  verifier('avec la dépense et les deux montants', /Billets de train/.test(texte) && /Ailleurs : 160 EUR/.test(texte)
    && /Toi : 150 EUR/.test(texte), texte);
  verifier('la version d’ailleurs est en place tant qu’on n’a rien choisi', await montantLocal() === 160, await montantLocal());
  await p.locator('.conflit-card button', { hasText: 'Remettre la mienne' }).click();
  await p.waitForTimeout(2000);
  verifier('« Remettre la mienne » la remet ici', await montantLocal() === 150, await montantLocal());
  verifier('et l’envoie au nuage', etat.nuage?.expenses?.find(e => e.id === 'e1')?.amount === 150,
    etat.nuage?.expenses?.find(e => e.id === 'e1')?.amount);
  verifier('la feuille se ferme', !(await p.locator('.conflit-card').count()));
  await ctx.close();
}

// ── E ─────────────────────────────────────────────────────────────────────────
console.log('E · seul un champ technique diverge : aucune feuille');
{
  const marque = (n) => ({ ...base, reserve: base.reserve.map((r, i) => (i ? r : { ...r, enrichAt: n })) });
  const { p, ctx } = await telephone({
    stockage: amorce(marque(2), { provo_synchro: JSON.stringify({ [base.id]: { base: marque(1) } }) }),
    nuage: marque(3), delai: 300,
  });
  await p.goto(U + '/'); await p.waitForTimeout(2500);
  await p.locator('.trip-card').first().click(); await p.waitForTimeout(1200);
  verifier('rien ne s’ouvre pour une empreinte technique', !(await p.locator('.conflit-card').count()));
  await ctx.close();
}

// ── F et G : les pièces jointes ───────────────────────────────────────────────
const octets = (n, graine) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + graine) % 256));
const JPEG = `data:image/jpeg;base64,${octets(3000, 7).toString('base64')}`;
const PDF = `data:application/pdf;base64,${Buffer.concat([Buffer.from('%PDF-1.4\n'), octets(4000, 9)]).toString('base64')}`;
const lourd = { ...base, coverPhoto: JPEG, documents: [{ id: 'doc1', nom: 'Billet de train.pdf', image: false, data: PDF }] };
const dossier = new Map();
let nuageAllege = null;

console.log('F · les pièces sortent du voyage, partent au nuage, et restent affichées');
{
  const { p, ctx, etat } = await telephone({ stockage: amorce(lourd), nuage: lourd, delai: 200, pieces: dossier });
  await p.goto(U + '/'); await p.waitForTimeout(7000);
  const stocke = await p.evaluate(() => localStorage.getItem('provo_trips'));
  // Le voyage de référence garde ses vignettes SVG, et c'est voulu : seuls
  // les JPEG et les PDF sortent (le dossier du nuage ne prend qu'eux).
  const lourdes = /data:(image\/jpeg|application\/pdf);base64,/;
  verifier('le voyage gardé sur le téléphone ne contient plus les pièces',
    !lourdes.test(stocke) && /pj:[0-9a-f]{24}/.test(stocke), `${stocke.length} caractères`);
  const envoye = JSON.stringify(etat.nuage);
  const allege = JSON.stringify(lourd).length - envoye.length;
  verifier('le voyage envoyé au nuage non plus : il s’allège du poids des deux pièces',
    !lourdes.test(envoye) && allege > (JPEG.length + PDF.length) * 0.95,
    `${allege} caractères en moins pour ${JPEG.length + PDF.length} de pièces`);
  const deposees = [...dossier.keys()].filter(k => k.startsWith(`${base.id}/`));
  verifier('les deux pièces sont déposées dans le dossier du voyage', deposees.length === 2, [...dossier.keys()].join(', '));
  const src = await p.locator('.trip-card__cover-blur').first().getAttribute('src').catch(() => null);
  verifier('la photo de couverture s’affiche toujours', src === JPEG, (src || '(aucune)').slice(0, 40));
  verifier('le nuage n’a jamais perdu une pièce avant de l’avoir dans son dossier',
    !etat.copiesPerdues.length, `retirées avant dépôt : ${etat.copiesPerdues.join(', ')}`);
  nuageAllege = etat.nuage;
  await ctx.close();
}

console.log('G · un autre téléphone rapatrie les pièces, et les garde sans réseau');
{
  const { p, ctx, etat } = await telephone({
    stockage: { provo_trips: '[]', provo_settings: JSON.stringify(SETTINGS), provo_onboarded: '1' },
    nuage: nuageAllege, delai: 200, pieces: dossier,
  });
  await p.goto(U + '/'); await p.waitForTimeout(6000);
  const src = () => p.locator('.trip-card__cover-blur').first().getAttribute('src').catch(() => null);
  verifier('la photo de couverture arrive du nuage', (await src()) === JPEG, ((await src()) || '(aucune)').slice(0, 40));
  // Plus de réseau pour les pièces : ce qui est arrivé reste là.
  etat.stockageCoupe = true;
  await p.reload(); await p.waitForTimeout(2500);
  verifier('elle reste affichée sans réseau, après relance', (await src()) === JPEG, ((await src()) || '(aucune)').slice(0, 40));
  await p.evaluate(() => { window.__ouverts = []; window.open = (u) => { window.__ouverts.push(String(u)); return null; }; });
  await p.locator('.trip-card').first().click(); await p.waitForTimeout(600);
  await p.locator('button[aria-label="Options du voyage"]').click(); await p.waitForTimeout(300);
  await p.locator('.trip-header-menu__item', { hasText: /Notes/ }).click(); await p.waitForTimeout(500);
  await p.locator('.trip-doc__ouvrir', { hasText: 'Billet de train' }).click(); await p.waitForTimeout(800);
  const ouverts = await p.evaluate(() => window.__ouverts);
  verifier('le billet s’ouvre sans réseau', ouverts.length === 1 && ouverts[0].startsWith('blob:'), JSON.stringify(ouverts));
  await ctx.close();
}

// ── H et I : l'audit du 5 octobre 2026 ────────────────────────────────────────
const attendre = async (p, condition, ms) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await p.waitForTimeout(250);
  }
  return condition();
};

console.log('H · le dépôt échoue : le nuage garde ses pièces en clair, puis les reçoit (A-061)');
{
  const { p, ctx, etat } = await telephone({ stockage: amorce(lourd), nuage: lourd, delai: 200, pieces: new Map() });
  etat.stockageCoupe = true;
  await p.goto(U + '/'); await p.waitForTimeout(5000);
  const lourdes = /data:(image\/jpeg|application\/pdf);base64,/;
  verifier('tant que le dépôt échoue, le nuage garde le billet et la photo en clair',
    donneesDe(etat.nuage).size === 2, `${donneesDe(etat.nuage).size} donnée(s) sur 2`);
  verifier('aucune écriture ne les lui a retirées', !etat.copiesPerdues.length, etat.copiesPerdues.join(', '));
  const src = await p.locator('.trip-card__cover-blur').first().getAttribute('src').catch(() => null);
  verifier('la photo s’affiche pendant ce temps', src === JPEG, (src || '(aucune)').slice(0, 40));
  // Le réseau revient pour le dossier.
  etat.stockageCoupe = false;
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  const allege = await attendre(p, () => etat.pieces.size === 2 && !lourdes.test(JSON.stringify(etat.nuage)), 8000);
  verifier('le réseau revenu, les pièces sont déposées puis le nuage s’allège', allege,
    `${etat.pieces.size} pièce(s) déposée(s), nuage ${lourdes.test(JSON.stringify(etat.nuage)) ? 'encore lourd' : 'allégé'}`);
  verifier('dans cet ordre : rien n’a été retiré avant d’être déposé', !etat.copiesPerdues.length, etat.copiesPerdues.join(', '));
  const stocke = await p.evaluate(() => localStorage.getItem('provo_trips'));
  verifier('le téléphone aussi garde le voyage allégé', !lourdes.test(stocke) && /pj:[0-9a-f]{24}/.test(stocke),
    `${stocke.length} caractères`);
  await ctx.close();
}

console.log('I · la pièce arrive dans le dossier APRÈS l’ouverture : elle est redemandée seule (A-062)');
{
  const photo = `data:image/jpeg;base64,${octets(3000, 11).toString('base64')}`;
  const id = idPiece(photo);
  const voyage = { ...base, id: 'voyage-2', coverPhoto: `pj:${id}` };
  const { p, ctx, etat } = await telephone({
    stockage: { provo_trips: '[]', provo_settings: JSON.stringify(SETTINGS), provo_onboarded: '1' },
    nuage: voyage, delai: 200, pieces: new Map(),
  });
  await p.goto(U + '/');
  const demandee = await attendre(p, () => etat.lectures > 0, 6000);
  verifier('la pièce absente est demandée une première fois', demandee, `${etat.lectures} lecture(s)`);
  // L'autre téléphone finit son dépôt. Personne ne touche au voyage.
  etat.pieces.set(`voyage-2/${id}`, { corps: octets(3000, 11), type: 'image/jpeg' });
  const avant = etat.lectures;
  const src = () => p.locator('.trip-card__cover-blur').first().getAttribute('src').catch(() => null);
  const arrivee = await attendre(p, async () => (await src()) === photo, 9000);
  verifier('elle arrive sans qu’on modifie le voyage', arrivee,
    `${etat.lectures - avant} nouvelle(s) lecture(s), image ${((await src()) || '(aucune)').slice(0, 30)}`);
  await ctx.close();
}

console.log('J · sans compte : les pièces sortent du voyage tout de suite');
{
  const { p, ctx } = await telephone({ stockage: amorce(lourd), nuage: null, connecte: false });
  await p.goto(U + '/'); await p.waitForTimeout(3000);
  const stocke = await p.evaluate(() => localStorage.getItem('provo_trips'));
  verifier('le voyage gardé sur le téléphone est allégé',
    !/data:(image\/jpeg|application\/pdf);base64,/.test(stocke) && /pj:[0-9a-f]{24}/.test(stocke), `${stocke.length} caractères`);
  const src = await p.locator('.trip-card__cover-blur').first().getAttribute('src').catch(() => null);
  verifier('et la photo s’affiche', src === JPEG, (src || '(aucune)').slice(0, 40));
  await ctx.close();
}

await nav.close();
if (echecs) { console.log(`\n${echecs} échec(s)`); process.exit(1); }
console.log('\ntous les cas passent');
