// TikTok : la seule voie exploitable depuis un serveur.
//
// Mesuré précédemment : TikTok sert un captcha aux adresses de centre de
// données, donc le HTML d'une page vidéo est inutilisable. L'endpoint oEmbed,
// lui, répond (HTTP 400 sur un identifiant inventé = il est joignable).
//
// Il manque un lien réel pour vérifier la chaîne complète. On en cherche un
// dans des sources publiques qui ne sont pas TikTok, puis on mesure :
// oEmbed → extraction → fonction Edge.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const EDGE = 'https://usztistixgzdrvjzplqx.supabase.co/functions/v1/extract-place';
const KEY = 'sb_publishable_yaO8Y2s2j2WspT4gYsRmlw_SO7m92nD';

async function get(url, headers = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, ...headers } });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 'ERR', text: '', err: String(e).slice(0, 60) }; }
  finally { clearTimeout(t); }
}

const VIDEO_RE = /tiktok\.com\/@([\w.]{2,30})\/video\/(\d{15,25})/g;

// Des pages publiques qui citent des vidéos TikTok en clair.
const SOURCES = [
  'https://duckduckgo.com/html/?q=%22tiktok.com%2F%40%22+%22%2Fvideo%2F%22+restaurant',
  'https://search.marcia.io/search?q=tiktok+video',
  'https://en.wikipedia.org/w/index.php?search=insource%3A%22tiktok.com%2F%40%22&ns0=1',
  'https://r.jina.ai/https://www.tiktok.com/@parisjetaime',
];

async function decouvrir() {
  const trouves = new Set();
  for (const src of SOURCES) {
    const { status, text, err } = await get(src);
    const hits = [...(text || '').matchAll(VIDEO_RE)].map(m => `https://www.tiktok.com/@${m[1]}/video/${m[2]}`);
    console.log(`  ${String(status).padEnd(5)} ${hits.length} lien(s)  ${err || ''}  ${src.slice(0, 70)}`);
    hits.forEach(h => trouves.add(h));
    if (trouves.size >= 3) break;
  }
  return [...trouves].slice(0, 3);
}

async function oembed(url) {
  const { status, text } = await get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  if (status !== 200) return { status };
  try { return { status, data: JSON.parse(text) }; } catch { return { status, data: null }; }
}

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
    return { status: r.status, body: await r.text() };
  } catch (e) { return { status: 'ERR', body: String(e).slice(0, 90) }; }
  finally { clearTimeout(t); }
}

console.log('Mesure sur la fonction Edge déployée — contrôle final.');
console.log('='.repeat(74));
console.log('1 · Trouver des liens TikTok réels, hors de TikTok');
console.log('='.repeat(74));
const liens = await decouvrir();
console.log(liens.length ? liens.map(l => '  ✅ ' + l).join('\n') : '  ❌ aucun lien trouvé');

console.log('\n' + '='.repeat(74));
console.log("2 · L'endpoint oEmbed est-il joignable et que rend-il ?");
console.log('='.repeat(74));
for (const l of liens) {
  const o = await oembed(l);
  console.log(`  ${l.slice(0, 58)}`);
  console.log(`     oEmbed ${o.status} ${o.data ? JSON.stringify({
    titre: String(o.data.title || '').slice(0, 90),
    auteur: o.data.author_name,
    vignette: o.data.thumbnail_url ? 'oui' : 'non',
  }) : ''}`);
}

console.log('\n' + '='.repeat(74));
console.log('3 · Chaîne complète via la fonction Edge');
console.log('='.repeat(74));
for (const l of liens) {
  const e = await edge(l);
  console.log(`  ${l.slice(0, 58)}\n     → ${e.status} ${e.body.slice(0, 320)}`);
}

if (!liens.length) {
  console.log('\n⚠️  Sans lien réel, la chaîne TikTok reste NON VÉRIFIÉE.');
}
