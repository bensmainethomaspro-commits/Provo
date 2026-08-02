// Banc de mesure de la détection de lieux.
//
// L'environnement de développement ne joint aucun hôte externe : ce script est
// fait pour tourner sur un exécuteur GitHub, qui a un vrai réseau.
//
//   node scripts/diag-places.mjs search    → comparaison des géocodeurs
//   node scripts/diag-places.mjs links     → résolution et extraction des liens
//   node scripts/diag-places.mjs all
//
// Il ne modifie rien : il mesure et il imprime.

const UA = 'Provo-Travel-App/1.0 (diagnostic; https://github.com/bensmainethomaspro-commits/Provo)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, opts = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), opts.timeout || 20000);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      redirect: opts.redirect || 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr', ...(opts.headers || {}) },
    });
    return r;
  } finally { clearTimeout(t); }
}

// ── Jeu de requêtes ────────────────────────────────────────────────────────
// Chaque entrée : [requête, indice attendu dans le résultat]
// « nu » = sans ville, le cas qui échoue le plus souvent dans l'app.

const NOMS_FR = [
  ['Bouillon Chartier, Paris', 'chartier'],
  ['Café de Flore, Paris', 'flore'],
  ['Le Comptoir du Relais, Paris', 'comptoir'],
  ['Chez Janou, Paris', 'janou'],
  ['La Cité du Vin, Bordeaux', 'cité du vin'],
  ['Les Machines de l\'île, Nantes', 'machines'],
  ['Le Petit Nice, Marseille', 'petit nice'],
  ['Boulangerie Utopie, Paris', 'utopie'],
];

const NOMS_INTL = [
  ['Katz\'s Delicatessen, New York', 'katz'],
  ['Sagrada Familia, Barcelona', 'sagrada'],
  ['teamLab Planets, Tokyo', 'teamlab'],
  ['Da Enzo al 29, Roma', 'enzo'],
  ['Bar Ramón, Barcelona', 'ram'],
  ['Agapii Mou, Athens', 'agapii'],
];

// Le cas critique : un nom seul, tel qu'un lien partagé le donne.
const NOMS_NUS = [
  ['Bouillon Chartier', 'chartier'],
  ['Agapii Mou', 'agapii'],
  ['teamLab Planets', 'teamlab'],
  ['Katz\'s Delicatessen', 'katz'],
];

const ADRESSES_FR = [
  ['2 rue du Helder, Paris', 'helder'],
  ['12 rue de Rivoli, Paris', 'rivoli'],
  ['50 avenue des Champs-Élysées, Paris', 'champs'],
  ['1 place Bellecour, Lyon', 'bellecour'],
  ['15 rue Sainte-Catherine, Bordeaux', 'catherine'],
];

const ADRESSES_INTL = [
  ['Skoufa 55, Athens', 'skoufa'],
  ['350 5th Ave, New York', '5th'],
  ['Plaça de Catalunya 1, Barcelona', 'catalunya'],
  ['Via del Corso 12, Roma', 'corso'],
];

// ── Fournisseurs ───────────────────────────────────────────────────────────

async function nominatim(q, bias) {
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}`
    + `&format=json&addressdetails=1&extratags=1&limit=5`;
  if (bias) url += `&viewbox=${bias.lon - 0.7},${bias.lat + 0.7},${bias.lon + 0.7},${bias.lat - 0.7}`;
  const r = await get(url);
  if (!r.ok) return { err: `HTTP ${r.status}` };
  const d = await r.json();
  if (!Array.isArray(d) || !d.length) return { hits: [] };
  return {
    hits: d.map(p => ({
      title: p.name || String(p.display_name || '').split(',')[0],
      addr: String(p.display_name || '').split(',').slice(0, 4).join(',').trim(),
      lat: +p.lat, lon: +p.lon,
      kind: `${p.class}/${p.type}`,
      oh: (p.extratags || {}).opening_hours || '',
    })),
  };
}

// Photon : géocodeur libre bâti sur les données OSM, mais indexé pour la
// recherche approximative (Elasticsearch) — là où Nominatim fait du décodage
// d'adresse strict. Gratuit, sans clé, CORS ouvert.
async function photon(q, bias) {
  let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=fr`;
  if (bias) url += `&lat=${bias.lat}&lon=${bias.lon}`;
  const r = await get(url);
  if (!r.ok) return { err: `HTTP ${r.status}` };
  const d = await r.json();
  const f = d?.features || [];
  if (!f.length) return { hits: [] };
  return {
    hits: f.map(x => {
      const p = x.properties || {};
      return {
        title: p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || '',
        addr: [[p.housenumber, p.street].filter(Boolean).join(' '), p.city, p.country].filter(Boolean).join(', '),
        lat: x.geometry?.coordinates?.[1], lon: x.geometry?.coordinates?.[0],
        kind: `${p.osm_key}/${p.osm_value}`,
        oh: '',
      };
    }),
  };
}

const PROVIDERS = { nominatim, photon };

function judge(hits, needle) {
  if (!hits?.length) return { ok: false, why: 'aucun résultat' };
  const n = needle.toLowerCase();
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const idx = hits.findIndex(h => norm(`${h.title} ${h.addr}`).includes(norm(n)));
  if (idx === -1) return { ok: false, why: `hors sujet (« ${hits[0].title} »)` };
  return { ok: true, rank: idx + 1 };
}

async function runSearch() {
  const groups = [
    ['NOM + VILLE — France', NOMS_FR, null],
    ['NOM + VILLE — international', NOMS_INTL, null],
    ['NOM SEUL (cas des liens partagés)', NOMS_NUS, null],
    ['ADRESSE — France', ADRESSES_FR, null],
    ['ADRESSE — international', ADRESSES_INTL, null],
  ];
  const score = {};
  for (const name of Object.keys(PROVIDERS)) score[name] = { ok: 0, total: 0, rank1: 0 };

  for (const [label, set, bias] of groups) {
    console.log(`\n${'='.repeat(72)}\n${label}\n${'='.repeat(72)}`);
    for (const [q, needle] of set) {
      console.log(`\n▸ ${q}`);
      for (const [name, fn] of Object.entries(PROVIDERS)) {
        let res;
        try { res = await fn(q, bias); } catch (e) { res = { err: String(e).slice(0, 60) }; }
        await sleep(1100); // politesse Nominatim : 1 req/s maximum
        if (res.err) { console.log(`   ${name.padEnd(10)} ERREUR ${res.err}`); score[name].total++; continue; }
        const v = judge(res.hits, needle);
        score[name].total++;
        if (v.ok) { score[name].ok++; if (v.rank === 1) score[name].rank1++; }
        const top = res.hits[0];
        const mark = v.ok ? (v.rank === 1 ? '✅' : `⚠️ rang ${v.rank}`) : '❌';
        console.log(`   ${name.padEnd(10)} ${mark} ${top ? `« ${top.title} » [${top.kind}] ${top.addr}` : v.why}`);
      }
    }
  }

  console.log(`\n${'='.repeat(72)}\nBILAN\n${'='.repeat(72)}`);
  for (const [name, s] of Object.entries(score)) {
    const pct = s.total ? Math.round(100 * s.ok / s.total) : 0;
    const p1 = s.total ? Math.round(100 * s.rank1 / s.total) : 0;
    console.log(`${name.padEnd(12)} trouvé ${s.ok}/${s.total} (${pct}%)  ·  en 1ʳᵉ position ${p1}%`);
  }
}

// ── Liens ──────────────────────────────────────────────────────────────────

async function chain(url) {
  // Suit les redirections une par une pour montrer où ça casse.
  const steps = [];
  let cur = url;
  for (let i = 0; i < 8; i++) {
    let r;
    try { r = await get(cur, { redirect: 'manual', timeout: 15000 }); }
    catch (e) { steps.push(`${cur} → ERREUR ${String(e).slice(0, 50)}`); break; }
    const loc = r.headers.get('location');
    steps.push(`${r.status} ${cur.slice(0, 110)}`);
    if (!loc) break;
    cur = new URL(loc, cur).toString();
  }
  return { steps, finalUrl: cur };
}

async function discoverTikTok() {
  // Des liens TikTok réels et vivants, sinon la mesure ne vaut rien.
  const out = [];
  for (const handle of ['parisjetaime', 'visitgreece', 'natgeo']) {
    try {
      const r = await get(`https://www.tiktok.com/@${handle}`, { timeout: 20000 });
      if (!r.ok) { console.log(`   @${handle} : HTTP ${r.status}`); continue; }
      const html = await r.text();
      const ids = [...html.matchAll(/"video[/:]?[iI]d"\s*:\s*"(\d{15,25})"/g)].map(m => m[1]);
      const alt = [...html.matchAll(/\/@[\w.]+\/video\/(\d{15,25})/g)].map(m => m[1]);
      const id = ids[0] || alt[0];
      if (id) out.push(`https://www.tiktok.com/@${handle}/video/${id}`);
      else console.log(`   @${handle} : aucun identifiant de vidéo dans la page (${html.length} o)`);
    } catch (e) { console.log(`   @${handle} : ${String(e).slice(0, 60)}`); }
  }
  return out;
}

async function tiktokOembed(url) {
  const r = await get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { timeout: 15000 });
  if (!r.ok) return { err: `HTTP ${r.status}` };
  const d = await r.json();
  return { title: d.title, author: d.author_name };
}

const EDGE = 'https://usztistixgzdrvjzplqx.supabase.co/functions/v1/extract-place';
const KEY = 'sb_publishable_yaO8Y2s2j2WspT4gYsRmlw_SO7m92nD';

async function edge(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 45000);
  try {
    const r = await fetch(EDGE, {
      method: 'POST', signal: c.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`, apikey: KEY,
        Origin: 'https://provo-tbens.vercel.app',
      },
      body: JSON.stringify({ url }),
    });
    const txt = await r.text();
    return { status: r.status, body: txt.slice(0, 400) };
  } catch (e) { return { status: 'ERR', body: String(e).slice(0, 120) };
  } finally { clearTimeout(t); }
}

async function runLinks() {
  console.log(`\n${'='.repeat(72)}\nDÉCOUVERTE DE LIENS TIKTOK RÉELS\n${'='.repeat(72)}`);
  const tt = await discoverTikTok();
  console.log(tt.length ? tt.map(u => `   ${u}`).join('\n') : '   AUCUN — TikTok bloque l\'exécuteur');

  for (const u of tt) {
    console.log(`\n▸ oEmbed ${u}`);
    console.log('   ', JSON.stringify(await tiktokOembed(u)).slice(0, 300));
  }

  const links = [
    ['share.google', 'https://share.google/WNSiI0AooI1HiDmyD'],
    ['maps complet', 'https://www.google.com/maps/place/Bouillon+Chartier/@48.8719,2.3428,17z'],
    ...tt.map((u, i) => [`tiktok ${i + 1}`, u]),
  ];

  for (const [label, u] of links) {
    console.log(`\n${'='.repeat(72)}\n${label} — ${u}\n${'='.repeat(72)}`);
    const c = await chain(u);
    c.steps.forEach(s => console.log('   ' + s));
    console.log(`   FINAL : ${c.finalUrl.slice(0, 200)}`);
    const e = await edge(u);
    console.log(`   FONCTION EDGE → ${e.status}\n   ${e.body}`);
  }
}

const mode = process.argv[2] || 'all';
if (mode === 'search' || mode === 'all') await runSearch();
if (mode === 'links' || mode === 'all') await runLinks();
