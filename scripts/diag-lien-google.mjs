// Sonde : que tirer, gratuitement et depuis un serveur, d'un lien de partage Google ?
//
// Le 11 novembre 2026, un lien `share.google` vers un restaurant de Rome, collé
// dans un voyage à Biarritz, est ressorti en fiche nue : un titre, ni adresse ni
// point, catégorie par défaut — et l'app annonçait que le lieu « n'est pas
// répertorié dans la carte ouverte ». Il l'est. Le banc d'avant (`diag-verify`)
// ne l'a jamais vu, parce qu'il n'envoyait pas la destination du voyage, ou
// seulement celle où se trouve le lieu : il ne mesurait pas ce que l'app envoie.
//
// Cette sonde répond aux questions dont dépend le correctif, depuis un
// exécuteur — IP de centre de données, comme la fonction Edge :
//   1 · la chaîne de redirections, saut par saut, avec les en-têtes de la fonction ;
//   2 · ce que la page d'arrivée porte SANS exécuter de JavaScript ;
//   3 · ce qu'un lecteur tiers (r.jina.ai, déjà un échelon de la chaîne TikTok)
//       en rend une fois la page exécutée ;
//   4 · quelles adresses Google Maps donnent nom, adresse et point à un serveur ;
//   5 · ce que répondent les géocodeurs au nom seul, puis au nom « situé » sur
//       une destination qui n'est pas la bonne ;
//   6 · ce que rend la fonction en production, avec et sans cette destination.
//
// Usage :  node scripts/diag-lien-google.mjs [lien] [destination]

const LIEN = process.argv[2] || 'https://share.google/y4QMh42nQx6DiSBfZ';
const DESTINATION = process.argv[3] || 'Biarritz';

const UA_FONCTION = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_BUREAU = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const UA_ROBOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const UA_PROVO = 'Provo-Travel-App/1.0 (+https://github.com/bensmainethomaspro-commits/Provo)';
const TEMOIN = 'CONSENT=YES+cb.20240101-00-p0.fr+FX+000; '
  + 'SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmZyIAEaBgiA0K2tBg';

const titre = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const court = (s, n = 150) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const entetes = (ua) => (u) => ({
  'User-Agent': ua,
  'Accept-Language': 'fr,en;q=0.8',
  ...(/google\.|goo\.gl/i.test(u.hostname) ? { Cookie: TEMOIN } : {}),
});

/** Suit les redirections à la main, pour voir chaque saut. */
async function chaine(url, pour, max = 8) {
  const sauts = [];
  let courant = url;
  try {
    for (let i = 0; i < max; i++) {
      const u = new URL(courant);
      const r = await fetch(courant, { redirect: 'manual', headers: pour(u), signal: AbortSignal.timeout(20000) });
      const loc = r.headers.get('location');
      sauts.push({ url: courant, status: r.status, location: loc });
      if (r.status >= 300 && r.status < 400 && loc) {
        await r.body?.cancel().catch(() => {});
        courant = new URL(loc, courant).toString();
        continue;
      }
      const html = await r.text();
      return { sauts, finalUrl: courant, status: r.status, html, type: r.headers.get('content-type') || '' };
    }
  } catch (e) {
    return { sauts, finalUrl: courant, status: 0, html: '', type: '', erreur: String(e).slice(0, 120) };
  }
  return { sauts, finalUrl: courant, status: 0, html: '', type: '', erreur: 'trop de sauts' };
}

/** Ce qu'un texte (HTML ou markdown) porte d'utile pour remplir une fiche. */
function signaux(texte) {
  const s = {
    'titre de page': /<title[^>]*>([^<]{2,120})<\/title>/i,
    'og:title': /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']{2,200})["']|<meta[^>]+content=["']([^"']{2,200})["'][^>]+(?:property|name)=["']og:title["']/i,
    'og:description': /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']{2,200})["']|<meta[^>]+content=["']([^"']{2,200})["'][^>]+(?:property|name)=["']og:description["']/i,
    'og:image (centre)': /staticmap[^"']{0,200}?center=(-?\d{1,3}\.\d{3,})(?:%2C|,)(-?\d{1,3}\.\d{3,})/i,
    '@lat,lon': /@(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})/,
    '!3d!4d': /!3d(-?\d{1,3}\.\d{4,})!4d(-?\d{1,3}\.\d{4,})/,
    'paire décimale': /\[(?:null,)*(-?\d{1,2}\.\d{5,}),(-?\d{1,3}\.\d{5,})\]/,
    'identifiant de fiche (0x…:0x…)': /0x[0-9a-f]{8,16}:0x[0-9a-f]{8,16}/i,
    'ludocid / cid': /(?:ludocid|[?&]cid)=(\d{6,22})/,
    'kgmid': /kgmid=([^&"'\\ ]{4,40})/,
    '/maps/place/': /\/maps\/place\/([^/@?"'\\]{2,80})/,
    'adresse (Maroniti)': /.{0,60}Maroniti.{0,60}/i,
    'code postal 00187': /.{0,50}00187.{0,40}/,
    'JSON-LD lieu': /"@type"\s*:\s*"(?:Restaurant|LocalBusiness|Place|TouristAttraction|FoodEstablishment)"/,
    'horaires (lundi…)': /(?:lundi|monday|lunedì)[^\n]{0,60}\d{1,2}[:h]\d{2}/i,
    'catégorie « Restaurant »': /.{0,30}\bRestaurant\b.{0,30}/,
    'mur de consentement': /consent\.google\.|before you continue|avant d.accéder/i,
    'mur anti-robot': /\/sorry\/|unusual traffic|trafic inhabituel|captcha/i,
    'JavaScript exigé': /enablejs|<noscript>[\s\S]{0,300}?(?:refresh|javascript)/i,
  };
  for (const [nom, re] of Object.entries(s)) {
    const m = texte.match(re);
    console.log(`    ${nom.padEnd(32)} ${m ? '✅ ' + court(m[0], 130) : '—'}`);
  }
}

// ── 1 & 2 · La chaîne, et ce que porte l'arrivée sans JavaScript ──────────────
titre(`1 · REDIRECTIONS de ${LIEN}`);
const parAgent = {};
for (const [nom, ua] of [['mobile (la fonction)', UA_FONCTION], ['bureau', UA_BUREAU], ['robot social', UA_ROBOT]]) {
  const c = await chaine(LIEN, entetes(ua));
  parAgent[nom] = c;
  console.log(`\n  ■ agent : ${nom}`);
  for (const s of c.sauts) console.log(`    ${s.status}  ${court(s.url, 110)}${s.location ? `\n         → ${court(s.location, 200)}` : ''}`);
  console.log(`    arrivée : ${c.status} · ${c.type} · ${c.html.length} o${c.erreur ? ` · ${c.erreur}` : ''}`);
  console.log(`    URL finale : ${court(c.finalUrl, 260)}`);
  signaux(c.html);
  await pause(1500);
}

const arrivee = parAgent['mobile (la fonction)'];
let nom = '', kgmid = '';
try {
  const u = new URL(arrivee.finalUrl);
  nom = (u.searchParams.get('q') || '').trim();
  kgmid = (u.searchParams.get('kgmid') || '').trim();
} catch { /* pas d'URL */ }
if (!nom) nom = 'ADEVA Cucina Moderna';
console.log(`\n  nom lu dans l'URL finale : « ${nom} » · kgmid : ${kgmid || '—'}`);

// ── 3 · Le lecteur tiers, qui exécute la page ─────────────────────────────────
titre('3 · LECTEUR TIERS (r.jina.ai) — la page une fois exécutée');
async function lecteur(cible, entetesPlus = {}) {
  try {
    const debut = Date.now();
    const r = await fetch(`https://r.jina.ai/${cible}`, { headers: entetesPlus, signal: AbortSignal.timeout(45000) });
    const t = await r.text();
    console.log(`\n  ■ ${court(cible, 120)}${Object.keys(entetesPlus).length ? `  ${JSON.stringify(entetesPlus)}` : ''}`);
    console.log(`    ${r.status} · ${t.length} o · ${Date.now() - debut} ms`);
    console.log(`    début : ${court(t, 220)}`);
    signaux(t);
    return t;
  } catch (e) { console.log(`\n  ■ ${court(cible, 100)}\n    ERREUR ${String(e).slice(0, 120)}`); return ''; }
}
const viaLien = await lecteur(LIEN);
await pause(2000);
const viaFinale = arrivee.finalUrl !== LIEN ? await lecteur(arrivee.finalUrl) : '';
await pause(2000);
// Demander un pays de sortie proche de l'utilisateur change-t-il la langue du panneau ?
await lecteur(LIEN, { 'X-Locale': 'fr-FR' });
const rendu = [viaLien, viaFinale].sort((a, b) => b.length - a.length)[0] || '';
if (rendu) {
  console.log('\n  ── lignes du panneau qui serviraient à remplir la fiche ──');
  for (const l of rendu.split('\n')) {
    if (/Maroniti|00187|^\|\s*(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|Restaurant|€|Adresse|Téléphone|Phone|Address|Hours|Horaires/i.test(l)
      && l.trim().length < 400) console.log(`    | ${court(l, 210)}`);
  }
}

// ── 4 · Les adresses Google Maps qui parlent à un serveur ─────────────────────
titre('4 · GOOGLE MAPS — quelles adresses donnent nom, adresse et point à un serveur ?');
const q = encodeURIComponent(nom).replace(/%20/g, '+');
const fiche = (arrivee.html.match(/0x[0-9a-f]{8,16}:0x[0-9a-f]{8,16}/i) || rendu.match(/0x[0-9a-f]{8,16}:0x[0-9a-f]{8,16}/i) || [])[0]
  || '0x132f61c6720a265f:0x81d280db9067d060';
const cid = (arrivee.html.match(/(?:ludocid|[?&]cid)=(\d{6,22})/) || rendu.match(/(?:ludocid|[?&]cid)=(\d{6,22})/) || [])[1]
  || '9354681056510857312';
console.log(`  identifiant de fiche utilisé : ${fiche} · cid : ${cid}`);
const formes = [
  ['recherche officielle (api=1&query)', `https://www.google.com/maps/search/?api=1&query=${q}`],
  ['maps?q=nom', `https://www.google.com/maps?q=${q}`],
  ['maps/place/nom', `https://www.google.com/maps/place/${q}`],
  ['maps?q=nom&kgmid', kgmid ? `https://www.google.com/maps?q=${q}&kgmid=${encodeURIComponent(kgmid)}` : ''],
  ['maps/place//data=!…1s<fiche>', `https://www.google.com/maps/place//data=!4m2!3m1!1s${fiche}`],
  ['maps?cid=', `https://www.google.com/maps?cid=${cid}`],
  ['maps.google.com/?cid=', `https://maps.google.com/?cid=${cid}`],
  ['maps?ftid=', `https://www.google.com/maps?ftid=${fiche}`],
].filter(([, u]) => u);
for (const [etiquette, u] of formes) {
  for (const [nomAgent, ua] of [['mobile', UA_FONCTION], ['robot social', UA_ROBOT]]) {
    const c = await chaine(u, entetes(ua));
    console.log(`\n  ■ ${etiquette} · agent ${nomAgent}`);
    console.log(`    ${c.sauts.map((s) => s.status).join(' → ')} · ${c.html.length} o${c.erreur ? ` · ${c.erreur}` : ''}`);
    console.log(`    URL finale : ${court(c.finalUrl, 240)}`);
    signaux(c.finalUrl + '\n' + c.html);
    await pause(1500);
  }
}

// ── 5 · Les géocodeurs : le nom seul, puis le nom « situé » au mauvais endroit ──
titre(`5 · GÉOCODEURS — « ${nom} » seul, puis situé sur « ${DESTINATION} »`);
async function photon(requete, pres = null) {
  let u = `https://photon.komoot.io/api/?q=${encodeURIComponent(requete)}&limit=5&lang=fr`;
  if (pres) u += `&lat=${pres.lat}&lon=${pres.lon}`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA_PROVO }, signal: AbortSignal.timeout(15000) });
    const d = r.ok ? await r.json() : null;
    return { status: r.status, liste: (d?.features || []).map((f) => {
      const p = f.properties || {};
      return `${p.name || '(sans nom)'} · ${[p.housenumber, p.street].filter(Boolean).join(' ')} · ${p.city || p.county || ''} · ${p.country || ''} [${p.osm_key}/${p.osm_value}] @${f.geometry?.coordinates?.[1]?.toFixed?.(4)},${f.geometry?.coordinates?.[0]?.toFixed?.(4)}`;
    }) };
  } catch (e) { return { status: 'ERR ' + String(e).slice(0, 60), liste: [] }; }
}
async function nominatim(requete, pays = '') {
  const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(requete)}`
    + `&format=json&addressdetails=1&extratags=1&namedetails=1&limit=5${pays ? `&countrycodes=${pays}` : ''}`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA_PROVO, 'Accept-Language': 'fr' }, signal: AbortSignal.timeout(15000) });
    const d = r.ok ? await r.json() : null;
    return { status: r.status, liste: (Array.isArray(d) ? d : []).map((p) =>
      `${p.name || '(sans nom)'} · ${court(p.display_name, 90)} [${p.class}/${p.type}] horaires:${p.extratags?.opening_hours ? 'oui' : 'non'} @${Number(p.lat).toFixed(4)},${Number(p.lon).toFixed(4)}`) };
  } catch (e) { return { status: 'ERR ' + String(e).slice(0, 60), liste: [] }; }
}
const dire = (etiquette, r) => {
  console.log(`\n  ■ ${etiquette} → ${r.status} · ${r.liste.length} résultat(s)`);
  for (const l of r.liste) console.log(`      ${l}`);
};
const ancre = (await photon(DESTINATION)).liste[0] || '';
const m = ancre.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
const pres = m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
console.log(`  ancre « ${DESTINATION} » : ${ancre || '(introuvable)'}`);
dire(`Photon · « ${nom} » (monde entier)`, await photon(nom));
dire(`Photon · « ${nom} » biaisé vers ${DESTINATION}`, await photon(nom, pres));
dire(`Photon · « ${nom}, ${DESTINATION} » biaisé vers ${DESTINATION} — ce que fait l'app`, await photon(`${nom}, ${DESTINATION}`, pres));
await pause(1200);
dire(`Nominatim · « ${nom} » (monde entier)`, await nominatim(nom));
await pause(1200);
dire(`Nominatim · « ${nom}, ${DESTINATION} »`, await nominatim(`${nom}, ${DESTINATION}`));
await pause(1200);
dire('Nominatim · « Via dei Maroniti 29, Roma » (l\'adresse lue chez Google)', await nominatim('Via dei Maroniti 29, Roma'));
dire('Photon · « Via dei Maroniti 29, 00187 Roma » (l\'adresse lue chez Google)', await photon('Via dei Maroniti 29, 00187 Roma'));

// ── 6 · La fonction en production, telle que l'app l'appelle ──────────────────
titre('6 · FONCTION EN PRODUCTION — avec et sans la destination du voyage');
const EDGE = process.env.EDGE_URL || 'https://usztistixgzdrvjzplqx.supabase.co/functions/v1/extract-place';
const CLE = 'sb_publishable_yaO8Y2s2j2WspT4gYsRmlw_SO7m92nD';
async function fonction(corps) {
  const debut = Date.now();
  try {
    const r = await fetch(EDGE, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLE}`, apikey: CLE,
        Origin: 'https://provo-tbens.vercel.app' },
      body: JSON.stringify(corps),
    });
    const t = await r.text();
    console.log(`\n  ■ ${JSON.stringify(corps)}\n    ${r.status} · ${Date.now() - debut} ms · ${t.length} o\n    ${t.slice(0, 900)}`);
  } catch (e) { console.log(`\n  ■ ${JSON.stringify(corps)}\n    ERREUR ${String(e).slice(0, 120)}`); }
}
await fonction({ url: LIEN });
await pause(3000);
await fonction({ url: LIEN, destination: DESTINATION });
await pause(3000);
await fonction({ url: LIEN, destination: 'Rome' });
await pause(3000);
// Le même lieu par son nom seul, collé comme une légende courte ne l'est pas :
// c'est le lien Maps « sans coordonnées » qui porte le nom.
await fonction({ url: `https://www.google.com/maps/search/?api=1&query=${q}`, destination: DESTINATION });

// ── 7 & 8 · Le vrai code de l'app, sur les fiches restées sans point ──────────
//
// `lookupPlace` (src/utils/enrich.js) est ce qui complète une fiche après
// l'ajout. Il est importé tel quel : ce qui est mesuré ici est ce que fait le
// téléphone, à l'adresse IP près.
titre('7 · FICHES SANS POINT d\'un voyage à l\'étranger — le code de complétion de l\'app');
const { lookupPlace } = await import('../src/utils/enrich.js');
/** L'ancre telle que `useTripAnchor` la calcule : premier résultat de Nominatim. */
async function ancreClient(destination) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': UA_PROVO, 'Accept-Language': 'fr' }, signal: AbortSignal.timeout(15000) });
    const d = r.ok ? await r.json() : null;
    if (!d?.[0]) return null;
    console.log(`  ancre « ${destination} » → ${court(d[0].display_name, 90)} @${Number(d[0].lat).toFixed(4)},${Number(d[0].lon).toFixed(4)} (${d[0].address?.country_code})`);
    return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
  } catch (e) { console.log(`  ancre « ${destination} » : ERREUR ${String(e).slice(0, 80)}`); return null; }
}
const fiche7 = (t, r) => console.log(`    ${r?.lat != null ? '✅' : '❌'} ${t.padEnd(54)} ${r ? `${court(r.address, 60) || '(sans adresse)'} · horaires:${r.openingHours ? 'oui' : 'non'} · @${r.lat?.toFixed?.(4)},${r.lon?.toFixed?.(4)}` : 'rien'}`);
// Les titres EXACTS de la Réserve du voyage, relevés le 11 novembre 2026 :
// quatre n'ont aucune coordonnée, dont trois monuments que tout le monde connaît.
const SANS_POINT = [
  'Vienna state opera',
  'Palais du Belvedere',
  'Karlskirche',
  'Hofburg Imperial Palace - 1st District, Innere Stadt',
];
const AVEC_POINT = ['Schönbrunner Palais', 'Gerstner K café', 'Café bel étage, Kärntner Straße 38, 1010 Vienna Austria'];
for (const destination of ['Vienne Autriche', 'Vienne, Autriche', 'Vienne']) {
  console.log(`\n  ■ destination du voyage : « ${destination} »`);
  await pause(1200);
  const a = await ancreClient(destination);
  for (const t of [...SANS_POINT, ...(destination === 'Vienne Autriche' ? AVEC_POINT : [])]) {
    fiche7(t, await lookupPlace(t, destination, a || {}).catch((e) => ({ address: `ERREUR ${String(e).slice(0, 60)}` })));
  }
}

titre('8 · COMPLÉTER UNE FICHE DÉJÀ SITUÉE loin du voyage — autour du voyage, ou autour d\'elle ?');
await pause(1200);
const ancreB = await ancreClient(DESTINATION);
console.log(`\n  ■ comme aujourd'hui : « ${nom} », destination « ${DESTINATION} », point du VOYAGE`);
fiche7(nom, await lookupPlace(nom, DESTINATION, ancreB || {}).catch(() => null));
console.log(`\n  ■ autour du point de la FICHE (41.9021, 12.4847), sans la destination`);
fiche7(nom, await lookupPlace(nom, '', { lat: 41.9021142, lon: 12.484738 }).catch(() => null));
