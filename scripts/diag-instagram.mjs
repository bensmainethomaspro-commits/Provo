// Instagram : joignable depuis un serveur, ou verrouillé comme TikTok ?
//
// Punkt AI importe des lieux depuis TikTok *et* Instagram. Provo ne traite pas
// Instagram du tout : un lien y tombe dans le lecteur générique, qui lit les
// balises og:. Encore faut-il qu'Instagram les serve à une adresse de centre de
// données — TikTok, lui, répond par un captcha.
//
// On mesure : accès direct, oEmbed public, et proxys de secours.

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

async function get(url, ua = MOBILE_UA) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: c.signal, redirect: 'follow',
      headers: { 'User-Agent': ua, 'Accept-Language': 'fr,en;q=0.8' },
    });
    const text = await r.text();
    return { status: r.status, finalUrl: r.url, text };
  } catch (e) { return { status: 'ERR', text: '', err: String(e).slice(0, 70) }; }
  finally { clearTimeout(t); }
}

const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
  return m?.[1] || '';
};

// Comptes publics stables, dont les publications ne disparaîtront pas demain.
const CIBLES = [
  'https://www.instagram.com/p/C1oVUvNr8kA/',
  'https://www.instagram.com/parisjetaime/',
  'https://www.instagram.com/explore/locations/213385402/paris-france/',
];

console.log('='.repeat(74));
console.log('1 · Accès direct (deux profils de client)');
console.log('='.repeat(74));
for (const u of CIBLES) {
  for (const [nom, ua] of [['mobile', MOBILE_UA], ['robot social', BOT_UA]]) {
    const r = await get(u, ua);
    const titre = meta(r.text, 'og:title');
    const desc = meta(r.text, 'og:description');
    const bloque = /login|connexion|challenge|captcha|checkpoint/i.test(r.finalUrl || '');
    console.log(`  ${String(r.status).padEnd(5)} ${nom.padEnd(12)} ${u.slice(24, 62).padEnd(40)}`
      + ` og:title=${titre ? '✅' : '—'} og:desc=${desc ? '✅' : '—'} ${bloque ? '↪︎ redirigé vers connexion' : ''}`);
    if (titre) console.log(`        « ${titre.slice(0, 80)} »`);
    if (desc) console.log(`        desc : « ${desc.slice(0, 90)} »`);
  }
}

console.log('\n' + '='.repeat(74));
console.log('2 · oEmbed public (sans jeton)');
console.log('='.repeat(74));
for (const base of [
  'https://www.instagram.com/api/v1/oembed/?url=',
  'https://graph.facebook.com/v18.0/instagram_oembed?url=',
]) {
  const r = await get(base + encodeURIComponent(CIBLES[0]));
  console.log(`  ${String(r.status).padEnd(5)} ${base.slice(0, 56)}`);
  console.log(`        ${r.text.slice(0, 150).replace(/\s+/g, ' ')}`);
}

console.log('\n' + '='.repeat(74));
console.log('3 · Proxys de secours');
console.log('='.repeat(74));
const E = encodeURIComponent(CIBLES[0]);
for (const p of [
  `https://r.jina.ai/${CIBLES[0]}`,
  `https://api.allorigins.win/get?url=${E}`,
  `https://api.codetabs.com/v1/proxy?quest=${E}`,
]) {
  const r = await get(p);
  const utile = /og:title|og:description|instagram/i.test(r.text) && r.text.length > 400;
  console.log(`  ${String(r.status).padEnd(5)} ${String(r.text.length).padStart(7)} o  ${utile ? '✅ contenu' : '— vide'}  ${p.split('?')[0].slice(0, 46)}`);
}
