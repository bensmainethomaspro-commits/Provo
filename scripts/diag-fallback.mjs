// Dernière inconnue : un lieu introuvable par le géocodeur est-il récupérable ?
//
// « Agapii Mou » (restaurant à Athènes, lien partagé par l'utilisateur) n'existe
// ni pour Nominatim ni pour Photon. Deux explications possibles :
//   1. il n'est pas dans OpenStreetMap → rien ne le sauvera ;
//   2. il y est sous son nom local (Αγάπη μου) et seul l'index de recherche
//      passe à côté → Overpass, qui interroge les étiquettes brutes, le trouve.
// La réponse décide s'il faut ajouter un repli Overpass à la cascade.

const UA = 'Provo-Travel-App/1.0 (diagnostic; https://github.com/bensmainethomaspro-commits/Provo)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function jget(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr' } });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) { return { err: String(e).slice(0, 70) }; }
  finally { clearTimeout(t); }
}

async function overpass(query) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 45000);
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', signal: c.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    const d = await r.json();
    return { els: d.elements || [] };
  } catch (e) { return { err: String(e).slice(0, 70) }; }
  finally { clearTimeout(t); }
}

// Recherche par nom, insensible à la casse, dans une boîte englobante.
// Interroge les étiquettes brutes : trouve aussi `name:en`, `int_name`, etc.
async function overpassByName(needle, bbox) {
  const [s, w, n, e] = bbox;
  const esc = needle.replace(/["\\]/g, '');
  const q = `[out:json][timeout:40];`
    + `(nwr["name"~"${esc}",i](${s},${w},${n},${e});`
    + ` nwr["name:en"~"${esc}",i](${s},${w},${n},${e});`
    + ` nwr["int_name"~"${esc}",i](${s},${w},${n},${e}););`
    + `out center tags 25;`;
  const { els, err } = await overpass(q);
  if (err) return { err };
  return {
    hits: els.map(x => ({
      name: x.tags?.name, en: x.tags?.['name:en'],
      kind: x.tags?.amenity || x.tags?.tourism || x.tags?.shop || x.tags?.leisure || '?',
      oh: x.tags?.opening_hours || '', street: x.tags?.['addr:street'] || '',
      num: x.tags?.['addr:housenumber'] || '',
      lat: x.lat ?? x.center?.lat, lon: x.lon ?? x.center?.lon,
    })),
  };
}

const ATHENES = [37.94, 23.68, 38.02, 23.80];   // sud, ouest, nord, est
const PARIS   = [48.80, 2.24, 48.91, 2.42];

async function main() {
  console.log('='.repeat(74));
  console.log('1 · « Agapii Mou » — variantes Nominatim');
  console.log('='.repeat(74));
  for (const q of ['Agapii Mou', 'Agapii Mou, Athens', 'Agapii Mou, Αθήνα',
                   'Αγάπη μου, Αθήνα', 'Agapi Mou Athens', 'Agapimou Athens']) {
    const { data, err } = await jget(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&namedetails=1&addressdetails=1&limit=3`);
    await sleep(1100);
    const d = err ? [] : (data || []);
    console.log(`  ${q.padEnd(26)} ${err || (d.length ? d.map(p => `« ${p.name || p.display_name.split(',')[0]} » [${p.class}/${p.type}]`).join(' | ') : '— aucun')}`);
  }

  console.log('\n' + '='.repeat(74));
  console.log('2 · Overpass par nom, dans la boîte d\'Athènes');
  console.log('='.repeat(74));
  for (const n of ['agapii', 'αγάπη', 'agapi']) {
    const { hits, err } = await overpassByName(n, ATHENES);
    if (err) { console.log(`  « ${n} » → ERREUR ${err}`); continue; }
    console.log(`  « ${n} » → ${hits.length} objet(s)`);
    hits.slice(0, 6).forEach(h => console.log(
      `      ${h.name || '?'}${h.en ? ` (${h.en})` : ''} · ${h.kind} · ${h.num} ${h.street} · horaires:${h.oh ? '✅' : '—'} · ${h.lat},${h.lon}`));
  }

  console.log('\n' + '='.repeat(74));
  console.log('3 · Overpass par nom sur des cas que Nominatim gère déjà');
  console.log('='.repeat(74));
  for (const [n, bbox, ville] of [['Bouillon Chartier', PARIS, 'Paris'], ['Utopie', PARIS, 'Paris']]) {
    const { hits, err } = await overpassByName(n, bbox);
    console.log(`  « ${n} » (${ville}) → ${err || `${hits.length} objet(s)`}`);
    (hits || []).slice(0, 3).forEach(h => console.log(
      `      ${h.name} · ${h.kind} · ${h.num} ${h.street} · horaires:${h.oh ? '✅' : '—'}`));
  }

  console.log('\n' + '='.repeat(74));
  console.log('4 · Photon biaisé sur Athènes');
  console.log('='.repeat(74));
  const { data, err } = await jget('https://photon.komoot.io/api/?q=Agapii%20Mou&lat=37.9838&lon=23.7275&limit=5&lang=fr');
  if (err) console.log('  ERREUR', err);
  else (data.features || []).forEach(f => console.log(
    `  « ${f.properties.name || '?'} » [${f.properties.osm_key}/${f.properties.osm_value}] ${f.properties.city || ''} ${f.properties.country || ''}`));
}

await main();
