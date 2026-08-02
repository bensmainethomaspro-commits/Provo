// Expérience décisive : quelle stratégie remplit le mieux une fiche ?
//
// Constat de la première mesure : quand un lien Google Maps porte des
// coordonnées, la fonction Edge fait un géocodage inverse. Elle récupère ce qui
// se trouve au pixel près — souvent la rue — et perd la catégorie, le numéro et
// les horaires, alors que le nom du lieu était dans l'URL.
//
// On compare quatre stratégies sur des liens Maps réels, plus deux sondes :
// le contenu d'une page de recherche Google (y a-t-il des coordonnées ?) et
// ce que TikTok laisse voir à un exécuteur.

const UA = 'Provo-Travel-App/1.0 (diagnostic; https://github.com/bensmainethomaspro-commits/Provo)';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function jget(url, headers = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr', ...headers } });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) { return { err: String(e).slice(0, 60) }; }
  finally { clearTimeout(t); }
}

const NOMI = 'https://nominatim.openstreetmap.org';

async function nomiSearch(q, limit = 5) {
  const { data, err } = await jget(`${NOMI}/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&extratags=1&limit=${limit}`);
  await sleep(1100);
  return err ? [] : (Array.isArray(data) ? data : []);
}

async function nomiReverse(lat, lon) {
  const { data, err } = await jget(`${NOMI}/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&extratags=1`);
  await sleep(1100);
  return err ? null : data;
}

// Overpass : tous les objets nommés dans un rayon, autour d'un point.
async function overpassNear(lat, lon, radius = 120) {
  const q = `[out:json][timeout:20];(node(around:${radius},${lat},${lon})["name"];way(around:${radius},${lat},${lon})["name"];);out center tags 40;`;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', signal: c.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.elements || []).map(e => ({
      name: e.tags?.name || '',
      tags: e.tags || {},
      lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon,
    })).filter(x => x.name);
  } catch { return []; }
  finally { clearTimeout(t); }
}

const fiche = p => {
  if (!p) return 'AUCUN';
  const a = p.address || {};
  const ex = p.extratags || {};
  const num = a.house_number ? `nº${a.house_number} ` : '';
  return `${p.name || '(sans nom)'} · ${p.class}/${p.type} · ${num}${a.road || ''} · `
    + `horaires:${ex.opening_hours ? '✅' : '—'} · site:${ex.website || ex['contact:website'] ? '✅' : '—'} · tel:${ex.phone || ex['contact:phone'] ? '✅' : '—'}`;
};

const score = p => {
  if (!p) return 0;
  const a = p.address || {}, ex = p.extratags || {};
  let s = 0;
  if (p.name) s += 3;                                   // un nom d'établissement
  if (p.class && !['place', 'highway', 'building', 'boundary'].includes(p.class)) s += 3; // un vrai POI
  if (a.house_number) s += 1;
  if (ex.opening_hours) s += 2;
  if (ex.website || ex['contact:website']) s += 1;
  if (ex.phone || ex['contact:phone']) s += 1;
  return s;
};

// Lieux réels, avec le nom et les coordonnées tels qu'un lien Maps les porte.
const CAS = [
  ['Bouillon Chartier', 48.8719, 2.3428],
  ["Katz's Delicatessen", 40.7223, -73.9874],
  ['Sagrada Familia', 41.4036, 2.1744],
  ['teamLab Planets', 35.6497, 139.7869],
  ['Chez Janou', 48.8567, 2.3672],
  ['Da Enzo al 29', 41.8887, 12.4776],
];

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

async function strategies() {
  const tot = { A: 0, B: 0, C: 0, D: 0 };
  for (const [nom, lat, lon] of CAS) {
    console.log(`\n${'='.repeat(74)}\n${nom}  (${lat}, ${lon})\n${'='.repeat(74)}`);

    // A — l'actuel : géocodage inverse sur les coordonnées.
    const a = await nomiReverse(lat, lon);
    console.log(`  A · inverse (actuel)      ${fiche(a)}`);

    // B — chercher le nom, sans contexte.
    const b = (await nomiSearch(nom, 1))[0] || null;
    console.log(`  B · nom seul              ${fiche(b)}`);

    // C — l'inverse donne la ville ; on cherche « nom, ville ».
    const ville = a?.address?.city || a?.address?.town || a?.address?.village
      || a?.address?.municipality || a?.address?.state || '';
    const c = ville ? ((await nomiSearch(`${nom}, ${ville}`, 1))[0] || null) : null;
    console.log(`  C · nom + ville (${ville || '?'})`.padEnd(28) + fiche(c));

    // D — Overpass autour du point, en retenant l'objet dont le nom colle.
    const near = await overpassNear(lat, lon, 150);
    const match = near.find(x => norm(x.name).includes(norm(nom)) || norm(nom).includes(norm(x.name)));
    const d = match ? {
      name: match.name, class: match.tags.amenity ? 'amenity' : (match.tags.tourism ? 'tourism' : (match.tags.shop ? 'shop' : 'x')),
      type: match.tags.amenity || match.tags.tourism || match.tags.shop || '?',
      address: { house_number: match.tags['addr:housenumber'], road: match.tags['addr:street'] },
      extratags: { opening_hours: match.tags.opening_hours, website: match.tags.website, phone: match.tags.phone },
    } : null;
    console.log(`  D · Overpass 150 m        ${fiche(d)}   (${near.length} objets nommés autour)`);

    const s = { A: score(a), B: score(b), C: score(c), D: score(d) };
    console.log(`  → points  A:${s.A}  B:${s.B}  C:${s.C}  D:${s.D}`);
    for (const k of Object.keys(tot)) tot[k] += s[k];
  }
  console.log(`\n${'='.repeat(74)}\nTOTAL — A(inverse actuel):${tot.A}  B(nom seul):${tot.B}  C(nom+ville):${tot.C}  D(Overpass):${tot.D}\n${'='.repeat(74)}`);
}

// ── Sonde : une page de recherche Google porte-t-elle des coordonnées ? ────
async function sondeGoogle() {
  console.log(`\n${'='.repeat(74)}\nSONDE — page de recherche Google (share.google)\n${'='.repeat(74)}`);
  const url = 'https://share.google/WNSiI0AooI1HiDmyD';
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(url, {
      signal: c.signal, redirect: 'follow',
      headers: {
        'User-Agent': MOBILE_UA, 'Accept-Language': 'fr,en;q=0.8',
        Cookie: 'CONSENT=YES+cb.20240101-00-p0.fr+FX+000; SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmZyIAEaBgiA0K2tBg',
      },
    });
    const html = await r.text();
    console.log(`  final : ${r.url.slice(0, 140)}`);
    console.log(`  taille : ${html.length} o`);
    const sondes = {
      '@lat,lon': /@(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})/,
      '!3d!4d': /!3d(-?\d{1,3}\.\d{4,})!4d(-?\d{1,3}\.\d{4,})/,
      'll= / center=': /[?&](?:ll|center|sll)=(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})/,
      'paire décimale isolée': /\[(-?\d{1,2}\.\d{5,}),(-?\d{1,3}\.\d{5,})\]/,
      'maps/place': /\/maps\/place\/([^/@?"'\\]{2,60})/,
      'adresse postale': /"address"\s*:\s*"([^"]{10,90})"/,
      'JSON-LD lieu': /"@type"\s*:\s*"(?:Restaurant|LocalBusiness|Place|TouristAttraction)"/,
      'kgmid': /kgmid=([^&"']+)/,
      'Athènes / Athens': /Ath[eè]n(?:es|s)|Αθήν/i,
      'rue grecque': /Σκουφά|Skoufa/i,
    };
    for (const [label, re] of Object.entries(sondes)) {
      const m = html.match(re);
      console.log(`  ${label.padEnd(24)} ${m ? '✅ ' + String(m[0]).slice(0, 70) : '—'}`);
    }
  } catch (e) { console.log('  ERREUR', String(e).slice(0, 120)); }
  finally { clearTimeout(t); }
}

// ── Sonde : que voit-on de TikTok depuis un exécuteur ? ───────────────────
async function sondeTikTok() {
  console.log(`\n${'='.repeat(74)}\nSONDE — TikTok\n${'='.repeat(74)}`);
  for (const handle of ['parisjetaime', 'natgeo']) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 25000);
    try {
      const r = await fetch(`https://www.tiktok.com/@${handle}`, {
        signal: c.signal,
        headers: { 'User-Agent': MOBILE_UA, 'Accept-Language': 'fr,en;q=0.8' },
      });
      const html = await r.text();
      console.log(`\n  @${handle} → HTTP ${r.status}, ${html.length} o`);
      console.log(`    <title> : ${(html.match(/<title[^>]*>([^<]{0,90})/i)?.[1] || '—')}`);
      for (const [label, re] of Object.entries({
        'captcha / verify': /captcha|verify|security check|Accès refusé/i,
        '/video/<id>': /\/video\/(\d{15,25})/,
        '"id":"<19 chiffres>"': /"id"\s*:\s*"(\d{19})"/,
        'og:title': /<meta[^>]+og:title[^>]+content="([^"]{0,80})/i,
        'SIGI_STATE / UNIVERSAL': /SIGI_STATE|__UNIVERSAL_DATA_FOR_REHYDRATION__/,
      })) {
        const m = html.match(re);
        console.log(`    ${label.padEnd(24)} ${m ? '✅ ' + String(m[1] || m[0]).slice(0, 60) : '—'}`);
      }
      const id = html.match(/\/video\/(\d{15,25})/)?.[1] || html.match(/"id"\s*:\s*"(\d{19})"/)?.[1];
      if (id) {
        const u = `https://www.tiktok.com/@${handle}/video/${id}`;
        console.log(`    lien reconstruit : ${u}`);
        const o = await jget(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`);
        console.log(`    oEmbed : ${o.err ? '❌ ' + o.err : '✅ ' + JSON.stringify({ t: o.data.title?.slice(0, 90), a: o.data.author_name })}`);
      }
    } catch (e) { console.log(`  @${handle} ERREUR ${String(e).slice(0, 90)}`); }
    finally { clearTimeout(t); }
  }
}

const mode = process.argv[2] || 'all';
if (mode === 'strat' || mode === 'all') await strategies();
if (mode === 'google' || mode === 'all') await sondeGoogle();
if (mode === 'tiktok' || mode === 'all') await sondeTikTok();
