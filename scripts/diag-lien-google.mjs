// Sonde : que tirer, gratuitement et depuis un serveur, d'un lien de partage Google
// et d'un nom de lieu étranger ?
//
// Le 11 novembre 2026, un lien `share.google` vers un restaurant de Rome, collé
// dans un voyage à Biarritz, est ressorti en fiche nue : un titre, ni adresse ni
// point, catégorie par défaut. Les bancs d'avant (`diagnose-link`, `diag-verify`)
// ne l'ont jamais vu : ils n'envoyaient pas la destination du voyage, ou
// seulement celle où se trouve le lieu. Ils ne mesuraient pas ce que l'app envoie.
//
// Première passe (même jour), acquise et consignée dans `.claude/project-notes.md` :
//   · la chaîne de redirections se suit sans JavaScript, et l'URL d'arrivée porte
//     `q=<nom>` et `kgmid=` ; la PAGE, elle, exige JavaScript et ne porte rien ;
//   · un lecteur tiers (r.jina.ai, déjà un échelon de la chaîne TikTok) rend le
//     panneau entier — adresse, catégorie, prix, horaires — pour le lien
//     `share.google`, mais refuse l'URL `www.google.com` d'arrivée ;
//   · Google Maps sert « Nom · Adresse » et « ★ · Catégorie » en balises `og:` à
//     un robot de messagerie quand on lui donne un identifiant de fiche, et le
//     POINT du lieu (centre de la vignette) quand on lui donne un nom.
//
// Cette passe-ci répond à ce qui reste à savoir pour construire :
//   A · le rendu complet du lecteur tiers, pour écrire le lecteur du panneau ;
//   B · la vignette Google Maps d'un nom : unique, ambigu, introuvable — quel
//       signal les distingue ?
//   C · pourquoi le code de l'app ne trouve pas « Vienna state opera » ;
//   D · Wikipédia et Wikidata connaissent-ils ces lieux dans toutes les langues ?
//
// Usage :  node scripts/diag-lien-google.mjs [lien] [destination]

const LIEN = process.argv[2] || 'https://share.google/y4QMh42nQx6DiSBfZ';
const DESTINATION = process.argv[3] || 'Biarritz';

const UA_FONCTION = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
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
      return { sauts, finalUrl: courant, status: r.status, html };
    }
  } catch (e) {
    return { sauts, finalUrl: courant, status: 0, html: '', erreur: String(e).slice(0, 120) };
  }
  return { sauts, finalUrl: courant, status: 0, html: '', erreur: 'trop de sauts' };
}

const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${prop}["']`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&') : '';
};

// ── 0 · La page que Google sert aux robots de messagerie pour un lien partagé ──
// À la première passe, ce robot était renvoyé vers `/knowledgegraphshares`, puis
// vers un captcha — mais c'était le troisième appel d'affilée. Ici il passe en
// premier, sur une adresse IP qui n'a encore rien demandé.
titre(`0 · CE QUE GOOGLE SERT À UN ROBOT DE MESSAGERIE pour ${LIEN}`);
{
  const c = await chaine(LIEN, entetes(UA_ROBOT));
  for (const s of c.sauts) console.log(`    ${s.status}  ${court(s.url, 120)}`);
  console.log(`    arrivée : ${c.status} · ${c.html.length} o${c.erreur ? ` · ${c.erreur}` : ''}`);
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:title', 'description']) {
    console.log(`    ${p.padEnd(18)} ${court(meta(c.html, p), 240) || '—'}`);
  }
  console.log(`    <title>            ${court((c.html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1], 120) || '—'}`);
  console.log(`    captcha ?          ${/\/sorry\/|captcha|unusual traffic/i.test(c.finalUrl + c.html) ? 'OUI' : 'non'}`);
}
await pause(2500);

// ── A · Le lecteur tiers, en entier ───────────────────────────────────────────
titre('A · LECTEUR TIERS (r.jina.ai), locale française — le rendu ENTIER du panneau');
async function lecteur(cible, entetesPlus = {}) {
  const debut = Date.now();
  try {
    const r = await fetch(`https://r.jina.ai/${cible}`, { headers: entetesPlus, signal: AbortSignal.timeout(45000) });
    const t = await r.text();
    console.log(`\n  ■ ${court(cible, 110)}  ${JSON.stringify(entetesPlus)}\n    ${r.status} · ${t.length} o · ${Date.now() - debut} ms`);
    return r.ok ? t : '';
  } catch (e) { console.log(`\n  ■ ${court(cible, 110)}\n    ERREUR ${String(e).slice(0, 120)} · ${Date.now() - debut} ms`); return ''; }
}
const rendu = await lecteur(LIEN, { 'X-Locale': 'fr-FR' });
console.log('<<<RENDU-DEBUT>>>');
console.log(rendu);
console.log('<<<RENDU-FIN>>>');
await pause(2500);
// Un second appel, pour le délai sans effet de cache… ou avec.
await lecteur(LIEN, { 'X-Locale': 'fr-FR' });
await pause(2500);
// Le lieu que la carte ouverte ne connaît pas (« Agapii Mou », Athènes) : c'est
// pour lui que lire l'adresse chez Google changerait tout.
const ATHENES = 'https://share.google/WNSiI0AooI1HiDmyD';
const renduAthenes = await lecteur(ATHENES, { 'X-Locale': 'fr-FR' });
console.log('<<<ATHENES-DEBUT>>>');
console.log(renduAthenes.slice(0, 14000));
console.log('<<<ATHENES-FIN>>>');
await pause(2500);

// ── B · La vignette Google Maps d'un nom ──────────────────────────────────────
titre('B · GOOGLE MAPS PAR LE NOM, vu par un robot de messagerie — où pointe la vignette ?');
const NOMS_B = [
  ['unique', 'ADEVA Cucina Moderna'],
  ['langue étrangère', 'Vienna state opera'],
  ['langue étrangère + ville', 'Vienna state opera Vienne'],
  ['français', 'Palais du Belvedere Vienne Autriche'],
  ['germanisé', 'Schönbrunner Palais Vienne'],
  ['absent de la carte ouverte', 'Agapii Mou Athènes'],
  ['AMBIGU', 'Café Central'],
  ['ambigu + ville', 'Café Central Vienne'],
  ['adresse', 'Via dei Maroniti 29, 00187 Roma'],
  ['INTROUVABLE', 'zzqxj plouf trattoria inexistante'],
];
for (const [genre, nom] of NOMS_B) {
  const u = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nom).replace(/%20/g, '+')}`;
  const c = await chaine(u, entetes(UA_ROBOT));
  const image = meta(c.html, 'og:image');
  const centre = (image.match(/center=(-?[\d.]+)(?:%2C|,)(-?[\d.]+)/) || []).slice(1).join(', ');
  const marque = (image.match(/markers=(-?[\d.]+)(?:%2C|,)(-?[\d.]+)/) || []).slice(1).join(', ');
  const zoom = (image.match(/zoom=(\d+)/) || [])[1] || '—';
  console.log(`\n  ■ ${genre.padEnd(28)} « ${nom} »`);
  console.log(`    ${c.sauts.map((s) => s.status).join(' → ')} · ${c.html.length} o${c.erreur ? ` · ${c.erreur}` : ''}`);
  console.log(`    og:title   ${court(meta(c.html, 'og:title'), 140) || '—'}`);
  console.log(`    og:desc    ${court(meta(c.html, 'og:description'), 100) || '—'}`);
  console.log(`    centre     ${centre || '—'} · zoom ${zoom} · épingle ${marque || '—'}`);
  console.log(`    og:image   ${court(image, 260) || '—'}`);
  // Le point du lieu est-il écrit ailleurs dans la page servie au robot ?
  const place = (c.html.match(/\/maps\/place\/[^"'\\ ]{2,160}/) || [])[0];
  const fiche = (c.html.match(/0x[0-9a-f]{8,16}:0x[0-9a-f]{8,16}/i) || [])[0];
  console.log(`    dans la page : /maps/place ${court(place, 130) || '—'} · fiche ${fiche || '—'}`);
  await pause(1800);
}

// ── C · Pourquoi l'app ne trouve pas « Vienna state opera » ───────────────────
titre('C · GÉOCODEURS BRUTS sur les noms que l\'app ne situe pas (voyage « Vienne Autriche »)');
const VIENNE = { lat: 48.2084, lon: 16.3725 };
async function photon(requete, pres = null, langue = 'fr') {
  let u = `https://photon.komoot.io/api/?q=${encodeURIComponent(requete)}&limit=5${langue ? `&lang=${langue}` : ''}`;
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
async function nominatim(requete) {
  const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(requete)}`
    + '&format=json&addressdetails=1&extratags=1&namedetails=1&limit=5';
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA_PROVO, 'Accept-Language': 'fr' }, signal: AbortSignal.timeout(15000) });
    const d = r.ok ? await r.json() : null;
    return { status: r.status, liste: (Array.isArray(d) ? d : []).map((p) => {
      const n = p.namedetails || {};
      const variantes = ['name', 'name:fr', 'name:en', 'name:de', 'alt_name', 'int_name', 'official_name']
        .filter((k) => n[k]).map((k) => `${k}=${n[k]}`).join(' | ');
      return `${p.name || '(sans nom)'} [${p.class}/${p.type}] @${Number(p.lat).toFixed(4)},${Number(p.lon).toFixed(4)} horaires:${p.extratags?.opening_hours ? 'oui' : 'non'}\n          ${court(variantes, 230)}`;
    }) };
  } catch (e) { return { status: 'ERR ' + String(e).slice(0, 60), liste: [] }; }
}
const dire = (etiquette, r) => {
  console.log(`\n  ■ ${etiquette} → ${r.status} · ${r.liste.length} résultat(s)`);
  for (const l of r.liste) console.log(`      ${l}`);
};
for (const nom of ['Vienna state opera', 'Palais du Belvedere', 'Schönbrunner Palais',
  'Café bel étage, Kärntner Straße 38, 1010 Vienna Austria']) {
  await pause(1300);
  dire(`Nominatim · « ${nom}, Vienne Autriche » — la 1re requête de l'app`, await nominatim(`${nom}, Vienne Autriche`));
  await pause(1300);
  dire(`Nominatim · « ${nom} » seul — la 2e`, await nominatim(nom));
  await pause(1300);
  dire(`Nominatim · « ${nom}, Wien » — la ville dans sa langue`, await nominatim(`${nom}, Wien`));
  dire(`Photon (fr) · « ${nom} » biaisé vers Vienne — la 3e`, await photon(nom, VIENNE));
  dire(`Photon (sans langue) · « ${nom} » biaisé vers Vienne`, await photon(nom, VIENNE, ''));
}

// ── D · Wikipédia et Wikidata ─────────────────────────────────────────────────
titre('D · WIKIPÉDIA / WIKIDATA — les lieux connus, dans toutes les langues, avec leur point');
async function wikipedia(langue, requete) {
  const u = `https://${langue}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(requete)}`
    + '&gsrlimit=4&prop=coordinates|pageprops&ppprop=wikibase_item&format=json&origin=*';
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA_PROVO }, signal: AbortSignal.timeout(15000) });
    const d = r.ok ? await r.json() : null;
    const pages = Object.values(d?.query?.pages || {}).sort((a, b) => a.index - b.index);
    return { status: r.status, liste: pages.map((p) =>
      `${p.title} ${p.coordinates?.[0] ? `@${p.coordinates[0].lat.toFixed(4)},${p.coordinates[0].lon.toFixed(4)}` : '(sans coordonnées)'} ${p.pageprops?.wikibase_item || ''}`) };
  } catch (e) { return { status: 'ERR ' + String(e).slice(0, 60), liste: [] }; }
}
async function wikidata(langue, requete) {
  const u = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(requete)}`
    + `&language=${langue}&uselang=${langue}&type=item&limit=4&format=json&origin=*`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA_PROVO }, signal: AbortSignal.timeout(15000) });
    const d = r.ok ? await r.json() : null;
    return { status: r.status, liste: (d?.search || []).map((e) => `${e.id} · ${e.label} — ${court(e.description, 70)}`) };
  } catch (e) { return { status: 'ERR ' + String(e).slice(0, 60), liste: [] }; }
}
for (const nom of ['Vienna state opera', 'Palais du Belvedere', 'Schönbrunner Palais', 'Karlskirche',
  'Hofburg Imperial Palace', 'ADEVA Cucina Moderna', 'Rocher de la Vierge', 'Kunsthistorisches Museum']) {
  dire(`Wikipédia fr · « ${nom} »`, await wikipedia('fr', nom));
  dire(`Wikipédia fr · « ${nom} Vienne »`, await wikipedia('fr', `${nom} Vienne`));
  dire(`Wikipédia en · « ${nom} »`, await wikipedia('en', nom));
  dire(`Wikidata fr · « ${nom} »`, await wikidata('fr', nom));
  await pause(600);
}
console.log(`\n(destination de référence : ${DESTINATION})`);
