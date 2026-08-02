// Vérification : la fonction Edge déployée remplit-elle vraiment les fiches ?
//
// Même jeu de lieux que le banc de stratégies, mais cette fois on interroge la
// fonction en production, telle que l'app l'appelle. On compte ce qui arrive
// réellement dans le formulaire : titre, adresse, catégorie, coordonnées,
// horaires.

const EDGE = 'https://usztistixgzdrvjzplqx.supabase.co/functions/v1/extract-place';
const KEY = 'sb_publishable_yaO8Y2s2j2WspT4gYsRmlw_SO7m92nD';

async function extract(url) {
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
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } catch (e) { return { status: 'ERR', body: { error: String(e).slice(0, 90) } }; }
  finally { clearTimeout(t); }
}

// Liens Google Maps réels : nom dans le chemin, coordonnées après le @.
const LIENS = [
  ['Bouillon Chartier', 'https://www.google.com/maps/place/Bouillon+Chartier/@48.8719,2.3428,17z', 'resto'],
  ["Katz's Delicatessen", 'https://www.google.com/maps/place/Katz%27s+Delicatessen/@40.7223,-73.9874,17z', 'resto'],
  ['Sagrada Familia', 'https://www.google.com/maps/place/Sagrada+Familia/@41.4036,2.1744,17z', 'visite'],
  ['teamLab Planets', 'https://www.google.com/maps/place/teamLab+Planets/@35.6497,139.7869,17z', 'visite'],
  ['Da Enzo al 29', 'https://www.google.com/maps/place/Da+Enzo+al+29/@41.8887,12.4776,17z', 'resto'],
  ['Chez Janou', 'https://www.google.com/maps/place/Chez+Janou/@48.8567,2.3672,17z', 'resto'],
  ['Le Comptoir du Relais', 'https://www.google.com/maps/place/Le+Comptoir+du+Relais/@48.8523,2.3387,17z', 'resto'],
  ['La Cité du Vin', 'https://www.google.com/maps/place/La+Cite+du+Vin/@44.8627,-0.5506,17z', 'visite'],
  ['share.google (utilisateur)', 'https://share.google/WNSiI0AooI1HiDmyD', null],
];

function ligne(nom, r) {
  const p = r.body?.result;
  if (!p) return `  ❌ ${nom.padEnd(28)} ${r.status} ${JSON.stringify(r.body).slice(0, 110)}`;
  const champs = [
    p.title ? 'titre' : null,
    p.address ? 'adresse' : null,
    p.lat != null ? 'coords' : null,
    p.openingHours ? 'horaires' : null,
    p.category ? `cat:${p.category}` : null,
  ].filter(Boolean);
  const n = [p.title, p.address, p.lat != null || null, p.openingHours].filter(Boolean).length;
  return `  ${n >= 3 ? '✅' : n >= 2 ? '⚠️ ' : '❌'} ${nom.padEnd(28)} « ${p.title || '?'} » · ${p.address || 'sans adresse'}\n`
    + `       ${champs.join(' · ')}`;
}

console.log('='.repeat(76));
console.log('FONCTION EDGE EN PRODUCTION — ce qui arrive dans le formulaire');
console.log('='.repeat(76));

let complets = 0, total = 0, bonneCat = 0, avecHoraires = 0;
for (const [nom, url, catAttendue] of LIENS) {
  const r = await extract(url);
  console.log(ligne(nom, r));
  const p = r.body?.result;
  total++;
  const n = [p?.title, p?.address, p?.lat != null || null, p?.openingHours].filter(Boolean).length;
  if (n >= 3) complets++;
  if (p?.openingHours) avecHoraires++;
  if (catAttendue && p?.category === catAttendue) bonneCat++;
  else if (catAttendue) console.log(`       ↳ catégorie attendue « ${catAttendue} », obtenue « ${p?.category || '—'} »`);
}

console.log('\n' + '='.repeat(76));
console.log(`fiches renseignées (≥3 champs) : ${complets}/${total}`);
console.log(`horaires récupérés             : ${avecHoraires}/${total}`);
console.log(`catégorie juste                : ${bonneCat}/${LIENS.filter(l => l[2]).length}`);
console.log('='.repeat(76));
