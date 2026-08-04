// Vérification : la carte garde son zoom, et tout le reste marche encore.
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { trip as base, settings } from './ui-fixture.mjs';

const trouverChromium = () => {
  const racine = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(racine)) return undefined;
  for (const d of readdirSync(racine).filter(x => x.startsWith('chromium')).sort())
    for (const b of ['chrome-linux/chrome', 'chrome-linux/headless_shell'])
      if (existsSync(`${racine}/${d}/${b}`)) return `${racine}/${d}/${b}`;
};

const URL_BASE = 'http://localhost:4173';
const trip = { ...base, accommodationAddress: 'Hotel Sacher, Vienne', accommodationLat: 48.2036, accommodationLon: 16.3690 };

const nav = await chromium.launch({ executablePath: trouverChromium() });
const ctx = await nav.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  hasTouch: true, isMobile: true, locale: 'fr-FR',
  permissions: ['geolocation'], geolocation: { latitude: 48.2082, longitude: 16.3738 },
});
const p = await ctx.newPage();
const err = [];
p.on('pageerror', e => err.push(String(e).slice(0, 200)));
await p.route('**/*', r => r.request().url().startsWith(URL_BASE) ? r.fallback() : r.abort());
await p.addInitScript(([t, s]) => {
  localStorage.setItem('provo_trips', t);
  localStorage.setItem('provo_settings', s);
  localStorage.setItem('provo_theme', 'light');
  localStorage.setItem('provo_geo_active', '0');   // on l'allume depuis l'écran
}, [JSON.stringify([trip]), JSON.stringify(settings)]);

const ongletCarte = async () => {
  let t = p.locator('.tab-btn', { hasText: /Carte/i });
  if (!(await t.count())) {
    await p.locator('.tab-btn', { hasText: '⋯' }).click();
    await p.waitForTimeout(400);
    t = p.locator('button', { hasText: /Carte/i });
  }
  await t.first().click();
  await p.waitForTimeout(1600);
};

await p.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(900);
await p.locator('.trip-card').first().click();
await p.waitForTimeout(800);
await ongletCarte();

// `ok` est le verdict, `detail` ce qu'on a mesuré : les mélanger laisserait un
// objet non vide passer pour une réussite.
let ratés = 0;
const dire = (n, ok, detail) => {
  if (!ok) ratés++;
  console.log(`${ok ? '✓' : '✗'} ${n}`,
    detail === undefined ? '' : `→ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};

// Le vrai niveau de zoom, lu dans l'URL des tuiles (…/{z}/{x}/{y}.png). La
// transformation du calque, elle, revient à 1 dès que Leaflet redessine :
// la comparer d'un bout à l'autre du parcours ne prouverait rien.
const zoom = () => p.evaluate(() => {
  const t = [...document.querySelectorAll('.leaflet-tile')].map(n => n.src)
    .map(s => s.match(/\/(\d+)\/\d+\/\d+\.png/)).filter(Boolean).map(m => Number(m[1]));
  return t.length ? Math.max(...t) : null;
});

// 1. Les épingles sont là, hébergement compris.
const pins = await p.evaluate(() => ({
  marqueurs: document.querySelectorAll('.leaflet-marker-icon').length,
  maison: [...document.querySelectorAll('.leaflet-marker-icon')].filter(n => n.textContent.includes('🏠')).length,
}));
dire('épingles dessinées', pins.marqueurs >= 12 && pins.maison === 1, pins);

// 2. Le cadrage initial a bien eu lieu : les épingles tiennent dans la zone.
const cadre = await p.evaluate(() => {
  const c = document.querySelector('.map-canvas').getBoundingClientRect();
  const m = [...document.querySelectorAll('.leaflet-marker-icon')].map(n => n.getBoundingClientRect());
  return { total: m.length, dedans: m.filter(r => r.x >= c.x - 20 && r.right <= c.right + 20
    && r.y >= c.y - 20 && r.bottom <= c.bottom + 20).length };
});
dire('cadrage initial : tout tient dans la zone', cadre.dedans === cadre.total, cadre);

const z0 = await zoom();

// 3. « Me situer » : point bleu, ligne du plus proche, et hauteur qui change.
const hAvant = await p.evaluate(() => Math.round(document.querySelector('.map-canvas').getBoundingClientRect().height));
await p.locator('.map-moi-btn').tap();
await p.waitForTimeout(1500);
const apres = await p.evaluate(() => ({
  h: Math.round(document.querySelector('.map-canvas').getBoundingClientRect().height),
  moi: !!document.querySelector('.map-moi'),
  proche: document.querySelector('.map-proche')?.textContent?.trim() || null,
}));
dire('point « moi » affiché', apres.moi);
dire('ligne du plus proche', typeof apres.proche === 'string' && apres.proche.length > 10, apres.proche);
dire('la zone de carte a bien rétréci', apres.h < hAvant, `${hAvant} → ${apres.h} px`);

// Leaflet doit connaître la nouvelle hauteur, sinon il zoome autour d'un centre
// périmé : le point visé s'échappe sous le doigt. On le vérifie par l'effet —
// un zoom conserve le centre, donc un repère à N px du centre passe à 2N.
const ecart = () => p.evaluate(() => {
  const c = document.querySelector('.map-canvas').getBoundingClientRect();
  const m = document.querySelector('.leaflet-marker-icon').getBoundingClientRect();
  return { dx: (m.x + m.width / 2) - (c.x + c.width / 2), dy: (m.y + m.height / 2) - (c.y + c.height / 2) };
});
const e1 = await ecart();
await p.locator('.leaflet-control-zoom-in').tap();
await p.waitForTimeout(1000);
const e2 = await ecart();
const derive = Math.hypot(e2.dx - 2 * e1.dx, e2.dy - 2 * e1.dy);
dire('zoom centré malgré le changement de hauteur', derive < 5, `dérive ${derive.toFixed(1)} px`);

// 4. Le zoom manuel tient pendant que le GPS envoie de nouvelles positions.
const zAvant = await zoom();
for (let i = 1; i <= 4; i++) {
  await ctx.setGeolocation({ latitude: 48.2082 + i * 0.0005, longitude: 16.3738 + i * 0.0005 });
  await p.waitForTimeout(700);
}
const zApres = await zoom();
dire('zoom conservé pendant que le GPS bouge',
  zAvant !== null && zAvant === zApres && zApres > z0, { depart: z0, avant: zAvant, apres: zApres });

// 4 bis. La hauteur rechange (« Me situer » éteint), mais l'utilisateur a déjà
// zoomé : son cadrage doit tenir.
const zGarde = await zoom();
await p.locator('.map-moi-btn').tap();
await p.waitForTimeout(1300);
const apresExtinction = await p.evaluate(() => ({
  h: Math.round(document.querySelector('.map-canvas').getBoundingClientRect().height),
  proche: !!document.querySelector('.map-proche'),
  moi: !!document.querySelector('.map-moi'),
}));
dire('éteindre « Me situer » retire le point bleu', !apresExtinction.moi);
dire('… et la ligne du plus proche', !apresExtinction.proche, `${apresExtinction.h} px`);
dire('la vue de l\'utilisateur survit au changement de hauteur',
  (await zoom()) === zGarde, { avant: zGarde, apres: await zoom() });
await p.locator('.map-moi-btn').tap();
await p.waitForTimeout(1200);

// 5. Bulle : « Ouvrir la fiche » ouvre bien la fiche.
await p.locator('.leaflet-marker-icon').first().tap();
await p.waitForTimeout(700);
dire('bouton « Ouvrir la fiche » dans la bulle',
  await p.evaluate(() => !!document.querySelector('.map-popup__edit')));
await p.locator('.map-popup__edit').tap();
await p.waitForTimeout(900);
const fiche = await p.evaluate(() => {
  const s = document.querySelector('.sheet');
  return s ? (s.querySelector('.sheet__title')?.textContent || '').trim() : null;
});
dire('la fiche s\'ouvre depuis l\'épingle', !!fiche, fiche);
await p.evaluate(() => document.querySelector('.sheet__close')?.click());
await p.waitForTimeout(700);

// 6. Piocher depuis une épingle de la Réserve : les épingles se mettent à jour,
//    et la vue ne repart pas de zéro.
const zPioche = await zoom();
const trouve = await p.evaluate(async () => {
  for (const i of document.querySelectorAll('.leaflet-marker-icon')) {
    i.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    i.click();
    await new Promise(r => setTimeout(r, 220));
    if (document.querySelector('.map-popup__pick')) return true;
  }
  return false;
});
dire('bulle « Ajouter à aujourd\'hui » atteignable', trouve);
if (trouve) {
  const nAvant = await p.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length);
  await p.evaluate(() => document.querySelector('.map-popup__pick').click());
  await p.waitForTimeout(1300);
  const n = await p.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length);
  dire('piocher depuis la carte : aucune épingle perdue', n === nAvant, { avant: nAvant, apres: n });
  const z3 = await zoom();
  dire('zoom conservé après avoir pioché', z3 === zPioche, { avant: zPioche, apres: z3 });
}

// 7. Quitter l'onglet puis revenir recadre à nouveau.
await p.locator('.tab-btn', { hasText: /Planning/i }).first().click().catch(() => {});
await p.waitForTimeout(800);
await ongletCarte();
const zRetour = await zoom();
dire('retour sur l\'onglet : cadrage refait', zRetour === z0, { attendu: z0, obtenu: zRetour });

console.log('\nerreurs JS :', err.length ? err : 'aucune');
console.log(ratés ? `\n${ratés} vérification(s) en échec` : '\nTout passe.');
await p.screenshot({ path: '/tmp/claude-0/-home-user-Provo/2608866b-29f4-5a36-8e48-207a0c764372/scratchpad/map-apres.png' });
await nav.close();
process.exit(ratés ? 1 : 0);
