// Combien de temps l'app met-elle à répondre quand le voyage grossit ?
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { trip as TRIP, settings as SETTINGS } from './ui-fixture.mjs';
const chrome=(()=>{const r='/opt/pw-browsers';for(const d of readdirSync(r).filter(x=>x.startsWith('chromium')).sort())for(const b of ['chrome-linux/chrome','chrome-linux/headless_shell'])if(existsSync(`${r}/${d}/${b}`))return `${r}/${d}/${b}`;})();
const U='http://localhost:4173';
const jour=k=>{const d=new Date();d.setDate(d.getDate()+k);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

const gros = (nbJours, parJour, nbReserve, nbDepenses) => ({
  ...TRIP,
  startDate: jour(0), endDate: jour(nbJours - 1),
  days: Array.from({ length: nbJours }, (_, i) => ({
    id: `d${i}`, date: jour(i), startTime: '09:00', notes: '',
    activities: Array.from({ length: parJour }, (_, j) => ({
      id: `a${i}-${j}`, title: `Activité ${i + 1}.${j + 1}`, category: ['visite','resto','balade','fun'][j % 4],
      status: 'todo', durationHours: 1, durationMinutes: 30,
      address: `Rue ${j}, Vienne, Autriche`, lat: 48.20 + j * 0.001, lon: 16.37 + i * 0.001,
      price: String(10 + j), travelerIds: [],
    })),
  })),
  reserve: Array.from({ length: nbReserve }, (_, i) => ({
    id: `r${i}`, title: `Idée ${i + 1}`, category: ['visite','resto','balade','fun'][i % 4],
    status: 'todo', durationHours: 1, durationMinutes: 0,
    address: `Place ${i}, Vienne`, lat: 48.21 + i * 0.0005, lon: 16.36 + i * 0.0005, travelerIds: [],
  })),
  expenses: Array.from({ length: nbDepenses }, (_, i) => ({
    id: `e${i}`, description: `Dépense ${i + 1}`, amount: 10 + i, eurAmount: 10 + i,
    currency: 'EUR', expenseCategory: ['transport','repas','verre','activite'][i % 4],
    payerId: i % 2 ? 't1' : 't2', date: jour(i % nbJours), participantIds: ['t1','t2'],
  })),
});

const TAILLES = [
  { nom: 'petit  (6 j × 3)', t: gros(6, 3, 8, 10) },
  { nom: 'moyen  (14 j × 6)', t: gros(14, 6, 40, 60) },
  { nom: 'gros   (30 j × 8)', t: gros(30, 8, 120, 200) },
];

const nav = await chromium.launch({ executablePath: chrome });
console.log('taille'.padEnd(18) + 'activités'.padEnd(11) + 'ouverture'.padEnd(12)
  + 'Planning'.padEnd(11) + 'Réserve'.padEnd(11) + 'Dépenses'.padEnd(11)
  + 'filtre'.padEnd(11) + 'point GPS');
console.log('─'.repeat(95));

for (const { nom, t } of TAILLES) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: true, locale: 'fr-FR',
    permissions: ['geolocation'], geolocation: { latitude: 48.2082, longitude: 16.3738 } });
  const p = await ctx.newPage();
  await p.route('**/*', r => r.request().url().startsWith(U) ? r.fallback() : r.abort());
  await p.addInitScript(([tr, s]) => {
    localStorage.setItem('provo_trips', tr); localStorage.setItem('provo_settings', s);
    localStorage.setItem('provo_theme', 'light'); localStorage.setItem('provo_onboarded', '1');
    localStorage.setItem('provo_geo_active', '1');   // en voyage, on marche avec
  }, [JSON.stringify([t]), JSON.stringify(SETTINGS)]);
  // Un Chromium de bureau n'est pas un iPhone : on bride le processeur pour
  // approcher ce que l'utilisateur sent vraiment sur son téléphone.
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.goto(U + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1000);

  // Le temps entre le geste et l'écran prêt : c'est ce que l'utilisateur sent.
  const mesurer = async (action) => {
    const t0 = Date.now();
    await action();
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    return Date.now() - t0;
  };

  const onglet = (re) => async () => {
    let l = p.locator('.tab-btn', { hasText: re });
    if (!(await l.count())) { const m = p.locator('.tab-btn', { hasText: '⋯' });
      if (await m.count()) { await m.click(); await p.waitForTimeout(250); }
      l = p.locator('button', { hasText: re }); }
    await l.first().click();
  };

  const ouverture = await mesurer(async () => { await p.locator('.trip-card').first().click(); });
  const planning = await mesurer(onglet(/Planning/i));
  const reserve  = await mesurer(onglet(/Réserve/i));
  const depenses = await mesurer(onglet(/Dépenses/i));
  await onglet(/Réserve/i)();
  await p.waitForTimeout(400);
  const filtre = await mesurer(async () => {
    const f = p.locator('.reserve-filter__pill').nth(3);
    if (await f.count()) await f.click();
  });

  // Ce qui compte en voyage : le GPS envoie un point toutes les secondes ou
  // deux pendant qu'on marche. Si chaque point coûte cher, l'app rame en
  // permanence, pas seulement à l'ouverture.
  await onglet(/Réserve/i)();
  await p.waitForTimeout(600);
  const t0 = Date.now();
  for (let i = 1; i <= 5; i++) {
    await ctx.setGeolocation({ latitude: 48.2082 + i * 0.0004, longitude: 16.3738 + i * 0.0004 });
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  const parPoint = Math.round((Date.now() - t0) / 5);

  const nbActs = t.days.reduce((s, d) => s + d.activities.length, 0);
  const c = (n) => `${n} ms`.padEnd(11);
  console.log(nom.padEnd(18) + String(nbActs).padEnd(11) + c(ouverture) + c(planning)
    + c(reserve) + c(depenses) + c(filtre) + `${parPoint} ms`);
  await ctx.close();
}
await nav.close();
