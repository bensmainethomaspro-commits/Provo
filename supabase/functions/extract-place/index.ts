// Provo — "extract-place" Edge Function
//
// Server-side link extractor. Runs in Deno on Supabase, so it can follow
// redirects (resolving short links like vm.tiktok.com / maps.app.goo.gl that
// the browser can't due to CORS) and call the TikTok oEmbed + Nominatim
// geocoding APIs without cross-origin restrictions.
//
// It takes a pasted URL (Google Maps, TikTok or any website), extracts the
// most likely place/activity, classifies it into one of Provo's categories,
// geocodes it for an address + coordinates, and returns a structured object
// the client drops straight into the "new activity" form.
//
// Optional: if an ANTHROPIC_API_KEY secret is configured, a fast Claude model
// cleans up messy social-media captions into a tidy title/category/location.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UA = "Provo-Travel-App/1.0 (place extractor)";

// TikTok sert un captcha aux agents ordinaires, mais une page propre de 16 ko
// aux robots qui déplient les liens dans les messageries — mesuré depuis un
// exécuteur le 9 août 2026 : 200, aucun captcha, avec og:title et og:image.
// C'est la dernière porte ouverte depuis un serveur. Facebook, Twitter,
// WhatsApp, Telegram et Discord passent ; Googlebot et Slackbot non.
const UA_ROBOT_SOCIAL =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
// Un vrai navigateur mobile : c'est le seul agent auquel TikTok sert la page
// d'intégration et le bloc de données inline. Il récolte le captcha sur la
// page ordinaire — d'où deux agents, et non un.
const UA_NAVIGATEUR =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const VALID_CATEGORIES = [
  "resto", "visite", "balade", "plage", "sport", "repos", "trajet", "fun",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function withTimeout(ms: number) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

// ── Geocoding (Nominatim / OpenStreetMap) ─────────────────────────────────
const CAT_RULES: [RegExp, string][] = [
  [/restaurant|cafe|coffee|brasserie|\bbar\b|pub|fast_food|bistro|snack|bakery|boulanger|food/, "resto"],
  [/beach|plage|coast|swimming_area|seaside/, "plage"],
  [/sport|fitness|gym|stadium|climbing|tennis|golf|surf|ski|kayak|dive/, "sport"],
  [/hotel|hostel|lodge|inn|guesthouse|accommodation|spa|wellness|camping/, "repos"],
  [/airport|train_station|bus_station|ferry|metro|subway|tram|parking/, "trajet"],
  [/park|forest|trail|hiking|hike|viewpoint|peak|waterfall|garden|nature|mountain|lake|randonn/, "balade"],
  [/nightclub|casino|cinema|theatre|theater|amusement|theme_park|arcade|zoo|aquarium|club/, "fun"],
  [/museum|monument|castle|church|cathedral|temple|gallery|historic|landmark|tower|palace|musee/, "visite"],
];

function categoryFromText(text: string): string | null {
  const t = (text || "").toLowerCase();
  for (const [re, cat] of CAT_RULES) if (re.test(t)) return cat;
  return null;
}

// Résultats bruts de Nominatim. On en demande plusieurs : le premier n'est pas
// toujours le bon, et sans candidats on ne peut rien départager.
async function nominatimSearch(query: string, limit = 5): Promise<any[]> {
  const { signal, clear } = withTimeout(9000);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` +
        `&format=json&addressdetails=1&extratags=1&namedetails=1&limit=${limit}`,
      { headers: { "User-Agent": UA, "Accept-Language": "fr" }, signal },
    );
    clear();
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    clear();
    return [];
  }
}

async function geocode(query: string) {
  const list = await nominatimSearch(query, 5);
  const best = pickBest(list, { name: query });
  return best ? shapePlace(best) : null;
}

function cityOf(p: any): string {
  const a = p?.address || {};
  return a.city || a.town || a.village || a.municipality || a.county || a.state || "";
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const normalize = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Un résultat vaut mieux qu'un autre s'il désigne un établissement nommé et
// renseigné, et s'il se trouve là où on l'attend. Sans ce tri, `limit=1`
// impose le premier venu — d'où les « défibrillateur » à la place d'une
// basilique.
function pickBest(
  list: any[],
  { name = "", coords = null as { lat: number; lon: number } | null } = {},
): any | null {
  if (!list?.length) return null;
  const wanted = normalize(name);
  let best: any = null, bestScore = -Infinity;

  for (const p of list) {
    const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let s = 0;
    // Un établissement nommé, pas une rue ni un polygone administratif.
    const generic = ["place", "highway", "boundary", "building", "landuse"].includes(p.class);
    if (p.name) s += 3;
    if (!generic) s += 4;

    const ex = p.extratags || {}, a = p.address || {};
    if (ex.opening_hours) s += 2;
    if (ex.website || ex["contact:website"]) s += 1;
    if (ex.phone || ex["contact:phone"]) s += 1;
    if (a.house_number) s += 1;

    // Le nom demandé doit se retrouver dans le résultat, dans un sens ou dans
    // l'autre (« Da Enzo al 29 » → « Da Enzo »).
    let nameHit = false;
    if (wanted) {
      const cand = normalize([p.name, p.namedetails?.["name:en"], p.namedetails?.int_name].filter(Boolean).join(" "));
      if (cand && (cand.includes(wanted) || wanted.includes(cand))) { s += 5; nameHit = true; }
      else if (cand && wanted.split(" ").some((w) => w.length > 3 && cand.includes(w))) { s += 2; nameHit = true; }
    }

    // Une adresse ne porte pas de nom : c'est la voie qui doit correspondre.
    const road = normalize(a.road || a.pedestrian || a.footway || "");
    const addrHit = Boolean(
      road && wanted && wanted.split(" ").some((w) => w.length > 3 && road.includes(w)),
    );
    if (addrHit) s += 3;

    // Sans coordonnées pour vérifier, et sans que le nom ni la voie ne
    // correspondent, il n'y a aucune preuve que ce résultat soit le bon.
    // Mesuré : « 3823 22nd Ave kensoha Wi » ramenait « Delhi », et
    // « Perfect restaurant for Gen-Zs » ramenait « Günz ». Mieux vaut ne rien
    // rendre que rendre n'importe quoi.
    if (wanted && !coords && !nameHit && !addrHit) continue;

    // Proximité : décisive quand le lien porte des coordonnées. Au-delà de
    // 25 km, c'est un homonyme sur un autre continent — on l'écarte.
    if (coords) {
      const d = distanceKm(coords.lat, coords.lon, lat, lon);
      if (d > 25) continue;
      s += d < 0.15 ? 6 : d < 1 ? 4 : d < 5 ? 2 : 0;
    }

    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

/**
 * Trouve la meilleure fiche pour un lieu.
 *
 * Mesuré sur six lieux réels (points cumulés, plus haut = mieux renseigné) :
 *   géocodage inverse seul .......... 28   ← ce que faisait l'app
 *   nom seul ........................ 57   (mais homonymes à l'autre bout du monde)
 *   nom + ville déduite des coords ... 64   ← retenu
 * Les coordonnées d'un lien Maps ne désignent pas la fiche : elles désignent un
 * point. Le géocodage inverse y ramasse ce qui traîne — un immeuble, un pont,
 * un défibrillateur. Le nom, lui, est dans l'URL : il sert à chercher, et les
 * coordonnées ne servent qu'à situer la recherche puis à vérifier le résultat.
 */
async function resolvePlace(
  name: string | null,
  coords: { lat: number; lon: number } | null,
) {
  const reverse = coords ? await reverseGeocodeRaw(coords.lat, coords.lon) : null;
  const city = reverse ? cityOf(reverse) : "";

  if (name) {
    const queries = city ? [`${name}, ${city}`, name] : [name];
    for (const q of queries) {
      const best = pickBest(await nominatimSearch(q, 5), { name, coords });
      if (best) return shapePlace(best);
    }
  }

  // Aucun nom exploitable, ou introuvable : le point reste la seule information.
  return reverse ? shapePlace(reverse) : null;
}

async function reverseGeocodeRaw(lat: number, lon: number) {
  const { signal, clear } = withTimeout(8000);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&extratags=1`,
      { headers: { "User-Agent": UA, "Accept-Language": "fr" }, signal },
    );
    clear();
    if (!r.ok) return null;
    const p = await r.json();
    if (!p?.display_name) return null;
    return p;
  } catch {
    clear();
    return null;
  }
}

function shapePlace(p: any) {
  const a = p.address || {};
  const ex = p.extratags || {};
  const road = [a.house_number, a.road || a.pedestrian || a.footway]
    .filter(Boolean).join(" ");
  const city = a.city || a.town || a.village || a.municipality;
  const address = [road || a.suburb || a.neighbourhood, city, a.country]
    .filter(Boolean).join(", ") ||
    String(p.display_name).split(",").slice(0, 4).join(",").trim();
  const typeText = [p.type, p.class, ex.amenity, ex.tourism, ex.leisure, ex.natural, ex.shop]
    .filter(Boolean).join(" ");
  const category = categoryFromText(typeText) || "visite";
  const chargeMatch = String(ex.charge || ex.fee_amount || "").match(/[\d.,]+/);
  const price = chargeMatch ? parseFloat(chargeMatch[0].replace(",", ".")) || null : null;
  return {
    title: String(p.name || String(p.display_name).split(",")[0]).trim(),
    address,
    category,
    lat: parseFloat(p.lat),
    lon: parseFloat(p.lon),
    openingHours: ex.opening_hours || "",
    // Sert à décider si ce résultat est un établissement nommé ou un simple
    // point d'adresse. Le client ignore ce champ.
    osmClass: String(p.class || ""),
    ...(price ? { price } : {}),
  };
}

// ── Redirect resolution ───────────────────────────────────────────────────
async function fetchOnce(url: string): Promise<{ finalUrl: string; html: string }> {
  const { signal, clear } = withTimeout(10000);
  try {
    const isGoogle = /google\.|goo\.gl/i.test(url);
    const r = await fetch(url, {
      redirect: "follow",
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "fr,en;q=0.8",
        // Court-circuite l'interstitiel de consentement Google (UE) qui remplace
        // la page Maps et vide l'extraction pour goo.gl / share.google.
        ...(isGoogle ? { "Cookie": "CONSENT=YES+cb.20240101-00-p0.fr+FX+000; SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmZyIAEaBgiA0K2tBg" } : {}),
      },
    });
    clear();
    const finalUrl = r.url || url;
    let html = "";
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("text/html") || ct.includes("application/json") || ct === "") {
      html = (await r.text()).slice(0, 600_000);
    }
    return { finalUrl, html };
  } catch {
    clear();
    return { finalUrl: url, html: "" };
  }
}

async function resolve(url: string): Promise<{ finalUrl: string; html: string }> {
  let res = await fetchOnce(url);
  // Si on a quand même atterri sur consent.google.com, suivre le paramètre
  // `continue` vers la vraie page Maps.
  if (/consent\.google\./i.test(res.finalUrl)) {
    try {
      const u = new URL(res.finalUrl);
      const cont = u.searchParams.get("continue");
      if (cont) res = await fetchOnce(decodeURIComponent(cont));
    } catch { /* ignore */ }
  }
  return res;
}

function metaTag(html: string, prop: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// ── Google Maps ───────────────────────────────────────────────────────────
function extractMapsCoords(s: string): { lat: number; lon: number } | null {
  // /@lat,lon,zoom
  let m = s.match(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  // !3dLAT!4dLON (place data blob)
  m = s.match(/!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  // ?q=lat,lon or ll=lat,lon
  m = s.match(/[?&](?:q|ll|center|destination)=(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return null;
}

function extractMapsName(s: string): string | null {
  try {
    const u = new URL(s);
    const m = u.pathname.match(/\/maps\/(?:place|search)\/([^/@?&]+)/);
    if (m) {
      const name = decodeURIComponent(m[1].replace(/\+/g, " ")).replace(/_/g, " ").trim();
      if (name && !/^-?\d+\.\d+,/.test(name)) return name;
    }
    const q = u.searchParams.get("q") || u.searchParams.get("destination");
    if (q && !/^-?\d+\.\d+,/.test(q)) return q;
  } catch { /* ignore */ }
  return null;
}

// Un lien share.google ne mène pas forcément à Maps : partagé depuis
// l'application Google, il atterrit sur une page de *recherche* avec un panneau
// de connaissances. Aucun /maps/place/, aucun @lat,lon — d'où l'échec. On y
// récupère quand même le nom du lieu, que Nominatim géocode ensuite.
// Google ne met pas toujours le nom du lieu dans `q=` : il y glisse parfois un
// jeton de continuation opaque. Mesuré sur un lien partagé réel, qui a donné
// « EhAmAB8UFTcGCj9f3UFPv9qGGLS3vtMGIjC4PObIgUP6… » en guise de titre.
// Un nom de lieu contient des espaces, ou reste court.
function looksLikeOpaqueToken(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/\s/.test(t)) return false;
  return t.length > 24 && /^[A-Za-z0-9_\-]+$/.test(t) && /\d/.test(t) && /[A-Z]/.test(t);
}

function extractGoogleSearchName(finalUrl: string, html: string): string | null {
  try {
    const u = new URL(finalUrl);
    if (/\/search/.test(u.pathname)) {
      const q = u.searchParams.get("q");
      if (q && !/^-?\d+\.\d+,/.test(q)) {
        const name = decodeURIComponent(q.replace(/\+/g, " ")).trim();
        // Un jeton opaque ferait un titre absurde : on préfère le <title> ou
        // le JSON-LD ci-dessous, quitte à ne rien rendre du tout.
        if (name && !looksLikeOpaqueToken(name)) return name;
      }
    }
  } catch { /* ignore */ }

  // <title>Nom du lieu - Recherche Google</title>
  const raw = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (raw) {
    const t = decodeEntities(raw)
      .replace(/\s*[-–—]\s*(?:Recherche Google|Google Search|Google Maps|Google)\s*$/i, "")
      .trim();
    if (t && !/^google/i.test(t) && t.length > 2) return t;
  }

  // Panneau de connaissances : le nom apparaît en JSON-LD sur la page.
  const ld = html.match(/"@type"\s*:\s*"(?:LocalBusiness|Restaurant|TouristAttraction|Place|Hotel|Museum)"[\s\S]{0,400}?"name"\s*:\s*"([^"]{2,80})"/);
  if (ld?.[1]) return decodeEntities(ld[1]).trim();

  return null;
}

async function handleGoogleMaps(rawUrl: string) {
  const { finalUrl, html } = await resolve(rawUrl);
  const haystack = finalUrl + "\n" + html.slice(0, 200_000);

  let name = extractMapsName(finalUrl);
  if (!name) {
    const ogTitle = metaTag(html, "og:title") || metaTag(html, "twitter:title");
    if (ogTitle && !/^google( maps)?$/i.test(ogTitle)) {
      name = ogTitle.replace(/\s*[-–—]\s*(?:Google Maps|Recherche Google|Google)\s*$/i, "").trim();
    }
  }
  if (!name) {
    const inHtml = haystack.match(/\/maps\/place\/([^/@?&"'\\]+)/);
    if (inHtml) name = decodeURIComponent(inHtml[1].replace(/\+/g, " ")).replace(/_/g, " ").trim();
  }
  // Dernier recours : page de recherche Google plutôt que page Maps.
  if (!name) name = extractGoogleSearchName(finalUrl, html);

  const coords = extractMapsCoords(haystack);
  const clean = cleanTitle(name);

  const place = await resolvePlace(name, coords);
  if (place) {
    // Quand la fiche trouvée est bien celle du lien, ses coordonnées sont plus
    // précises que le centrage de la carte : on garde les siennes. Sinon on
    // retombe sur le point du lien.
    const named = Boolean(place.title) && place.title !== "Lieu";
    return {
      ...place,
      title: clean || place.title,
      lat: named ? place.lat : (coords?.lat ?? place.lat),
      lon: named ? place.lon : (coords?.lon ?? place.lon),
      link: rawUrl,
      source: "google_maps",
    };
  }

  // Ni fiche ni point : le nom seul vaut mieux que rien.
  if (clean || coords) {
    return {
      title: clean || "Lieu",
      category: "visite",
      ...(coords ? { lat: coords.lat, lon: coords.lon } : {}),
      link: rawUrl,
      source: "google_maps",
    };
  }
  return null;
}

// ── TikTok ────────────────────────────────────────────────────────────────
function categoryFromHashtags(text: string): string | null {
  const t = text.toLowerCase();
  const map: [RegExp, string][] = [
    [/restaurant|resto|food|foodie|eat|cafe|coffee|brunch|cuisine|miam|gastronom/, "resto"],
    [/beach|plage|mer|ocean|sea|seaside|crique/, "plage"],
    [/hike|hiking|rando|trail|trek|montagne|mountain|forest|nature|cascade|waterfall|balade|walk/, "balade"],
    [/museum|musee|monument|castle|chateau|church|eglise|histo|culture|art|gallery|visite|sightseeing/, "visite"],
    [/sport|gym|fitness|surf|ski|climb|escalade|velo|bike|kayak|dive|plong/, "sport"],
    [/spa|wellness|hotel|relax|chill|repos|massage/, "repos"],
    [/party|club|bar|nightlife|concert|festival|fun|game|parc|amusement/, "fun"],
  ];
  for (const [re, cat] of map) if (re.test(t)) return cat;
  return null;
}

function stripEmoji(s: string): string {
  return s.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{2122}\u{2139}\u{2300}-\u{23FF}]/gu,
    " ",
  );
}

function cleanTitle(raw: string | null): string {
  if (!raw) return "";
  let t = stripEmoji(raw)
    .replace(/#[\p{L}\p{N}_]+/gu, " ")        // hashtags
    .replace(/https?:\/\/\S+/g, " ")          // urls
    .replace(/@[\w.]+/g, " ")                 // mentions
    .replace(/\s+/g, " ")
    .trim();
  // First sentence / segment, capped.
  t = t.split(/[\n.!?•|]/)[0].trim();
  if (t.length > 70) t = t.slice(0, 70).trim();
  return t.replace(/[\s,]+$/, "").trim();
}

// Voies (fr, en, es, it, de) — pour repérer une adresse écrite en clair.
const STREET_WORDS =
  "ave|avenue|st|street|rd|road|blvd|boulevard|dr|drive|lane|ln|way|hwy" +
  "|rue|avenue|boulevard|impasse|chemin|quai|place|allée|allee|cours" +
  "|via|viale|piazza|corso|calle|carrer|avenida|plaza|paseo" +
  "|strasse|straße|str|weg|platz";

// Une légende continue après l'adresse : « … Kenosha WI Open Monday-Saturday »,
// « chez Da Enzo hier soir ». Ce qui suit n'est pas du lieu et fausse le
// géocodage — on coupe au premier mot qui parle d'autre chose.
const NOISE_AFTER =
  /\b(open|ouvert|closed|ferm[ée]|hours?|horaires?|reservation|r[ée]servation|menu|prix|price|from|d[èe]s|hier|demain|aujourd|tonight|today|now|maintenant|mon|tues?|wed|thur?s?|fri|sat|sun|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/iu;

function trimNoise(s: string): string {
  const m = s.match(NOISE_AFTER);
  const cut = m?.index != null ? s.slice(0, m.index) : s;
  return cut.replace(/\s+/g, " ").trim().replace(/[\s,\-–—]+$/, "");
}

function extractLocationHint(caption: string): string | null {
  // "📍 Place, City" — stop at the first emoji/symbol so the geocoder query
  // stays clean instead of swallowing the rest of the caption.
  const pin = caption.match(/📍\s*([\p{L}\p{N}][\p{L}\p{N}\s,&'’.\-]{1,60})/u);
  if (pin) return trimNoise(pin[1]) || null;

  // Une adresse écrite en clair. Deux ordres selon la langue, et il faut les
  // deux : « 12 rue de Rivoli » (numéro, voie, nom) en français, espagnol et
  // italien ; « 3823 22nd Ave » (numéro, nom, voie) en anglais et allemand.
  // Mesuré sur de vraies légendes TikTok — c'est le cas le plus fréquent, et
  // l'ancienne règle le manquait en exigeant une majuscule après « at ».
  const addrFr = caption.match(
    new RegExp(
      `\\b(\\d{1,5}\\s*(?:bis|ter)?\\s+(?:${STREET_WORDS})\\s+[\\p{L}][\\p{L}\\p{N}\\s,'’.\\-]{2,45})`,
      "iu",
    ),
  );
  if (addrFr) return trimNoise(addrFr[1]) || null;

  const addrEn = caption.match(
    new RegExp(
      `\\b(\\d{1,5}\\s+[\\p{L}\\p{N}'’.\\-]+(?:\\s+[\\p{L}\\p{N}'’.\\-]+){0,3}\\s+(?:${STREET_WORDS})\\b[\\p{L}\\p{N}\\s,'’.\\-]{0,40})`,
      "iu",
    ),
  );
  if (addrEn) return trimNoise(addrEn[1]) || null;

  // « rue de Rivoli, Paris » — la voie d'abord, le numéro absent.
  const street = caption.match(
    new RegExp(`\\b((?:${STREET_WORDS})\\s+[\\p{L}][\\p{L}\\p{N}\\s'’.\\-]{2,40})`, "iu"),
  );
  if (street) return trimNoise(street[1]) || null;

  // "at <Place>" / "à <Place>" — un nom propre, ou un numéro de rue.
  const at = caption.match(
    /(?:^|\s)(?:located\s+at|at|à|chez|dans|in|sur)\s+([A-ZÀ-Ý\d][\p{L}\p{N}'’\- ]{2,50})/u,
  );
  if (at) return trimNoise(at[1]) || null;
  return null;
}

// Une légende n'est pas un nom de lieu : « Located at 3823 22nd Ave… » ou
// « Perfect restaurant for Gen-Zs » font de mauvais titres. Quand la légende
// ressemble à une phrase et qu'on a identifié le lieu, le nom du lieu vaut
// mieux.
function captionLooksLikeSentence(t: string): boolean {
  if (!t) return true;
  if (t.split(/\s+/).length > 6) return true;
  return /^(located|situé|situe|retrouvez|find|go|allez|venez|on\b|the\b|le\b|la\b|perfect|best|meilleur)/i.test(t);
}

// Hashtags trop génériques pour désigner un lieu — ne jamais les géocoder.
const HASHTAG_STOPLIST = new Set([
  "fyp", "fypage", "foryou", "foryoupage", "pourtoi", "viral", "trending", "tiktok",
  "travel", "voyage", "trip", "vacances", "holiday", "vacation", "wanderlust",
  "food", "foodie", "foodtok", "recette", "recipe", "restaurant", "resto",
  "amazing", "beautiful", "aesthetic", "satisfying", "explore", "adventure",
  "nature", "beach", "plage", "sunset", "summer", "ete", "hiver", "love",
  "hiddengem", "hiddengems", "traveltok", "traveltips", "bonplan", "bonsplans",
]);

// Géocodage strict : n'accepte que de vrais lieux (villes, régions, sites) pour
// éviter les faux positifs quand on tente les hashtags.
async function geocodePlaceStrict(query: string) {
  const list = await nominatimSearch(query, 5);
  // `pickBest` refuse déjà tout candidat dont ni le nom ni la voie ne
  // correspondent : c'est ce qui empêche un hashtag de ramener n'importe quoi.
  const p = pickBest(list, { name: query });
  if (!p) return null;
  // Un hashtag ne peut désigner qu'une ville, une région ou un site — jamais
  // un cours d'eau ni un objet naturel quelconque, d'où « Günz » (une rivière
  // allemande) apparue en titre d'un restaurant.
  if (!["place", "boundary", "tourism", "leisure"].includes(p.class)) return null;
  return shapePlace(p);
}

function hashtagCandidates(caption: string): string[] {
  const tags = [...caption.matchAll(/#([\p{L}\p{N}_]{4,30})/gu)].map(m => m[1].toLowerCase());
  return tags.filter(t => !HASHTAG_STOPLIST.has(t) && !/^\d+$/.test(t)).slice(0, 3);
}

async function tiktokOembed(url: string) {
  const { signal, clear } = withTimeout(8000);
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { "User-Agent": UA },
      signal,
    });
    clear();
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.title && !d?.author_name) return null;
    return { caption: d.title || "", author: d.author_name || "", thumb: d.thumbnail_url || "" };
  } catch {
    clear();
    return null;
  }
}

// TikTok sert une page de vérification aux adresses de centre de données —
// mesuré depuis un exécuteur : « captcha » présent, aucune balise og:. Toute
// légende tirée d'une telle page serait du bruit.
function looksLikeCaptcha(html: string): boolean {
  if (!html) return true;
  if (/captcha|verify_?page|security check|Vérification de sécurité/i.test(html)) return true;
  return !metaTag(html, "og:description") && !metaTag(html, "og:title");
}

// La page telle que TikTok la sert aux robots des messageries. Elle ne porte
// PAS la légende — mesuré : ni og:description, ni JSON-LD, ni bloc de données
// inline. Mais elle donne l'auteur et l'image de couverture, là où la page
// ordinaire ne donne qu'un captcha.
async function pageRobotSocial(url: string): Promise<string> {
  const { signal, clear } = withTimeout(8000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA_ROBOT_SOCIAL }, signal, redirect: "follow" });
    clear();
    if (!r.ok) return "";
    return await r.text();
  } catch {
    clear();
    return "";
  }
}

/**
 * Les phrases que TikTok sert à la place d'une légende. Mesuré le 9 août 2026 :
 * `og:description` rend « TikTok | Make Your Day » sur un carrousel, et
 * « Watch, follow, and discover more trending content. » sur une vidéo — du
 * remplissage identique pour tout le catalogue.
 *
 * Les laisser passer coûtait deux fois : la fiche s'appelait « TikTok | Make
 * Your Day », et surtout un titre, même faux, faisait sauter la lecture de la
 * couverture — le seul échelon qui nomme encore le lieu.
 */
const LEGENDES_GENERIQUES = [
  /^\s*tiktok\s*(?:[|·\-–—]\s*make your day\s*)?$/i,
  /make your day/i,
  /watch,? follow,? and discover more trending content/i,
  /regardez,? suivez et découvrez/i,
  /^\s*(?:log ?in|sign ?up|connexion|s'inscrire)\b/i,
];
const legendeGenerique = (t: string) => {
  const s = (t || "").trim();
  return !s || LEGENDES_GENERIQUES.some((re) => re.test(s));
};

const idVideoTikTok = (url: string) =>
  (url.match(/\/(?:video|photo)\/(\d{6,})/) || [])[1] || "";

/**
 * Échelon — la page d'intégration `/embed/v2/{id}`. Elle existe pour être
 * affichée dans un site tiers : c'est le seul endroit où TikTok a encore
 * intérêt à servir la légende sans authentification.
 */
async function tiktokPageEmbed(id: string) {
  if (!id) return null;
  const { signal, clear } = withTimeout(9000);
  try {
    const r = await fetch(`https://www.tiktok.com/embed/v2/${id}`, {
      headers: { "User-Agent": UA_NAVIGATEUR }, signal,
    });
    clear();
    if (!r.ok) return null;
    const h = await r.text();
    const brut = (h.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
    let caption = "";
    try { caption = brut ? JSON.parse(`"${brut}"`) : ""; } catch { caption = ""; }
    const author = (h.match(/"uniqueId"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
    if (!caption && !author) return null;
    return { caption, author, thumb: "" };
  } catch {
    clear();
    return null;
  }
}

/**
 * Échelon — le bloc de données que la page complète embarque pour s'hydrater.
 * C'est la légende exacte, telle que l'application la connaît. Il faut se
 * présenter en navigateur : l'agent du serveur reçoit un captcha.
 */
async function tiktokDonneesPage(url: string) {
  const { signal, clear } = withTimeout(12000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA_NAVIGATEUR }, signal, redirect: "follow",
    });
    clear();
    if (!r.ok) return null;
    const h = await r.text();
    if (looksLikeCaptcha(h) && !h.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")) return null;
    const bloc =
      (h.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/) || [])[1]
      || (h.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
    if (!bloc) return null;
    const d = JSON.parse(bloc);
    const item = d?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct
      || Object.values(d?.ItemModule || {})[0] as any;
    if (!item) return null;
    const caption = item.desc || "";
    const author = item.author?.uniqueId || (typeof item.author === "string" ? item.author : "");
    const thumb = item.video?.cover || item.video?.originCover || "";
    if (!caption && !author) return null;
    return { caption, author, thumb };
  } catch {
    clear();
    return null;
  }
}

/** Échelon de secours — la page servie aux robots des messageries. */
async function tiktokRobotSocial(url: string) {
  const social = await pageRobotSocial(url);
  if (!social) return null;
  const t = metaTag(social, "og:title");
  // « TikTok · Avery | Biarritz & Travel » → « Avery | Biarritz & Travel »
  const compte = t.replace(/^\s*TikTok\s*[·|\-–—]\s*/i, "").trim();
  // La description est rendue telle quelle : c'est la boucle des échelons qui
  // tranche ce qui est une vraie légende, en un seul endroit.
  return {
    caption: metaTag(social, "og:description") || "",
    author: compte && !/^tiktok$/i.test(compte) ? compte : "",
    thumb: metaTag(social, "og:image") || "",
  };
}

async function handleTikTok(rawUrl: string, permisIA = false) {
  const { finalUrl, html: pageHtml } = await resolve(rawUrl);
  const canonical = /tiktok\.com\/.+\/(video|photo)\//.test(finalUrl) ? finalUrl : rawUrl;
  // L'oEmbed n'aime pas les paramètres de suivi collés au lien partagé.
  const bare = canonical.split("?")[0];

  let caption = "", author = "", thumb = "", etape = "";

  // La chaîne, du plus souhaitable au dernier recours. Chaque échelon est
  // INDÉPENDANT : celui qui tombe ne fait pas tomber les suivants. C'est
  // exactement ce qui manquait le 9 août 2026 — l'oEmbed s'est éteint (400 sur
  // toutes les vidéos, y compris des comptes publics célèbres) et toute
  // l'extraction est tombée avec lui, jusqu'à ce qu'un utilisateur le signale.
  //
  // `scripts/canari-extraction.mjs` mesure ces mêmes échelons tous les jours et
  // ouvre une alerte quand il n'en reste plus que les derniers. Garder les deux
  // listes dans le même ordre : le canari est l'alarme de cette échelle-ci.
  const echelons: [string, () => Promise<
    { caption: string; author: string; thumb: string } | null>][] = [
    ["oembed", async () => {
      // L'oEmbed n'aime pas les paramètres de suivi : on essaie l'URL
      // canonique, puis dépouillée, puis le lien brut.
      for (const c of [...new Set([canonical, bare, rawUrl])]) {
        const d = await tiktokOembed(c);
        if (d) return d;
      }
      return null;
    }],
    ["page-embed", () => tiktokPageEmbed(idVideoTikTok(canonical))],
    ["donnees-page", () => tiktokDonneesPage(canonical)],
    ["robot-social", () => tiktokRobotSocial(canonical)],
  ];

  for (const [nom, lire] of echelons) {
    const d = await lire().catch(() => null);
    if (!d) continue;
    // Un échelon muet sur la légende peut quand même donner le compte ou la
    // couverture : on prend ce qu'il a, et on continue à chercher le reste.
    // Le filtre du remplissage est ici, au seul endroit qu'aucun échelon ne
    // contourne : une phrase générique n'est pas une légende, et l'accepter
    // ferait sauter la lecture de la couverture juste en dessous.
    if (!caption && d.caption && !legendeGenerique(d.caption)) {
      caption = d.caption;
      etape = nom;
    }
    if (!author && d.author) author = d.author;
    if (!thumb && d.thumb) thumb = d.thumb;
    // Une légende suffit : descendre plus bas ne coûterait que du temps.
    if (caption) break;
  }

  // Repli propre au navigateur : la page que `resolve` a déjà chargée. Depuis
  // un serveur elle ne rend qu'un captcha, mais côté client elle est valable.
  if (!caption && !looksLikeCaptcha(pageHtml)) {
    const d = metaTag(pageHtml, "og:description") || "";
    caption = legendeGenerique(d) ? "" : d;
    if (caption) etape = "og-page";
    if (!author) {
      const t = metaTag(pageHtml, "og:title");
      const m = t.match(/^(.+?)\s+(?:on|sur)\s+TikTok/i);
      if (m) author = m[1].trim();
    }
    if (!thumb) thumb = metaTag(pageHtml, "og:image") || "";
  }

  // Ni légende ni auteur : inutile de fabriquer une fiche vide, le client saura
  // le dire mieux que nous.
  if (!caption && !author) return null;

  const locationHint = extractLocationHint(caption);
  let title = cleanTitle(locationHint) || cleanTitle(caption);
  let category = categoryFromHashtags(caption) || "fun";

  // Dernier recours : lire le nom sur la couverture. On n'y vient que sans
  // légende — c'est-à-dire, depuis que TikTok l'a fermée, presque toujours.
  // Sans ça, la fiche ne porterait que le nom du compte.
  let vu: { title: string; category: string; location: string } | null = null;
  let motifCouverture = "";
  if (permisIA && !title) {
    const lu = await lireCouverture(thumb)
      .catch((e) => ({ ok: false as const, pourquoi: `jete_${String(e).slice(0, 30)}` }));
    if (lu.ok) {
      vu = lu;
      title = lu.title;
      if (lu.category) category = lu.category;
      motifCouverture = "ok";
    } else {
      motifCouverture = lu.pourquoi;
    }
  } else if (!permisIA) {
    motifCouverture = "origine_non_autorisee";
  } else {
    motifCouverture = "titre_deja_trouve";
  }

  // Le modèle ne sert que là où les règles ont échoué : une légende qui porte
  // déjà « 📍 Bouillon Chartier, Paris » se lit sans lui, et chaque appel coûte.
  // …et jamais sur une légende vide : depuis que TikTok les a fermées, c'est
  // le cas courant, et c'était un appel payant pour classer une chaîne vide.
  const reglesSuffisent = Boolean(locationHint) && !captionLooksLikeSentence(title);
  const ai = (permisIA && !reglesSuffisent && caption)
    ? await classifyWithLLM(caption, "tiktok").catch(() => null)
    : null;
  if (ai) {
    if (ai.title) title = ai.title;
    if (ai.category && VALID_CATEGORIES.includes(ai.category)) category = ai.category;
  }
  // Les lieux suivants de la légende : nommés, jamais géocodés ici — le client
  // les cherchera si l'utilisateur les retient. Géocoder six lieux qu'on va
  // peut-être tous refuser coûterait six requêtes pour rien.
  const autresLieux = (ai?.lieux || []).slice(1)
    .filter((l: any) => l.title)
    .map((l: any) => ({
      title: l.title,
      category: VALID_CATEGORIES.includes(l.category) ? l.category : "visite",
      location: l.location || "",
    }));
  // Témoin d'activation : permet de vérifier que le secret est bien posé sans
  // jamais lire la clé. Ne révèle rien d'autre que « le modèle a répondu ».
  const modeleActif = ai !== null;

  const result: any = {
    title: title || (author ? `Idée de ${author}` : "Activité TikTok"),
    category,
    link: rawUrl,
    photoUrl: thumb,
    notes: caption ? caption.slice(0, 400) : "",
    source: "tiktok",
    ...(modeleActif ? { modele: true } : {}),
    // D'où vient le titre affiché : « lu sur l'image, donc à vérifier ». Le
    // client s'en sert pour le dire au lieu de le taire. On ne le revendique
    // pas si la légende a finalement fourni un meilleur titre juste au-dessus.
    ...(vu && !ai?.title ? { luSurImage: true } : {}),
    // Quel échelon a fourni la légende — « couverture » quand il n'y en avait
    // aucune et que le nom a été lu sur l'image. Sans ce témoin, une chaîne
    // qui se dégrade en silence reste invisible jusqu'à la panne totale.
    etape: etape || (vu ? "couverture" : "aucune"),
    // Pourquoi la lecture d'image a donné — ou n'a pas donné — un nom.
    // Sans ce témoin, un échec ne se répare qu'à l'aveugle.
    ...(motifCouverture ? { couverture: motifCouverture } : {}),
    ...(autresLieux.length ? { autres: autresLieux } : {}),
  };

  // Localisation : 1) lieu suggéré par l'IA ou repéré (📍 / "à …") dans la
  // légende, 2) sinon, hashtags qui géocodent vers un vrai lieu (#lisbonne…).
  // `vu.location` seulement, jamais `vu.title` seul : géocoder « Deoun » sans
  // ville depuis le serveur, qui ignore la destination du voyage, ramène
  // n'importe quel homonyme du monde. Le client, lui, connaît la destination
  // et refait la recherche située — une adresse fausse est pire qu'absente.
  const geoQuery = (ai?.location) || locationHint || vu?.location || "";
  let place = geoQuery ? await geocode(geoQuery) : null;
  // Un hashtag peut situer une activité (#lisbonne), il ne peut jamais la
  // nommer : « #genz » ne fait pas de « Günz » le nom du restaurant.
  let placeFromTag = false;
  if (!place) {
    for (const tag of hashtagCandidates(caption)) {
      place = await geocodePlaceStrict(tag);
      if (place) { placeFromTag = true; break; }
    }
  }
  if (place) {
    result.address = place.address;
    result.lat = place.lat;
    result.lon = place.lon;
    if (!ai?.category) result.category = categoryFromHashtags(caption) || place.category;
    // Le nom du lieu peut l'emporter sur une légende qui n'en est pas un —
    // mais seulement si c'est un vrai établissement nommé, désigné
    // explicitement dans la légende. Une ville, une adresse, ou un lieu deviné
    // depuis un hashtag feraient un plus mauvais titre que la légende.
    const vraiNom = !placeFromTag && Boolean(place.title) && !/^\d/.test(place.title) &&
      !["place", "boundary", "highway", "waterway", "natural"].includes(place.osmClass || "");
    if (!title || (!ai?.title && vraiNom && captionLooksLikeSentence(title))) {
      result.title = place.title;
    }
  }
  return result;
}

// ── Generic website ───────────────────────────────────────────────────────
async function handleGeneric(rawUrl: string) {
  const { html } = await resolve(rawUrl);
  const title = metaTag(html, "og:title") || metaTag(html, "twitter:title") ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "");
  const desc = metaTag(html, "og:description") || metaTag(html, "description");
  const image = metaTag(html, "og:image") || metaTag(html, "twitter:image");
  if (!title) return null;

  const cleaned = cleanTitle(title) || title;
  let category = categoryFromHashtags(`${title} ${desc}`) || null;

  const result: any = {
    title: cleaned,
    link: rawUrl,
    photoUrl: image || "",
    notes: desc ? desc.slice(0, 300) : "",
    source: "web",
  };
  const place = await geocode(cleaned).catch(() => null);
  if (place) {
    result.address = place.address;
    result.lat = place.lat;
    result.lon = place.lon;
    category = category || place.category;
  }
  result.category = category || "visite";
  return result;
}

// ── Lecture de la légende par un modèle ───────────────────────────────────
//
// C'est l'approche de Punkt AI : une légende de réseau social n'est pas un nom
// de lieu, et aucune règle ne transforme « Perfect restaurant for Gen-Zs » en
// adresse. Un modèle, si.
//
// La clé est payante : trois garde-fous encadrent l'appel.
//   1. Seules les origines de l'app peuvent le déclencher — la clé publique
//      Supabase est dans le bundle, donc lisible par n'importe qui.
//   2. On n'appelle le modèle que si les règles ont échoué : une légende qui
//      contient déjà « 📍 Bouillon Chartier, Paris » n'a besoin de personne.
//   3. La réponse du modèle n'est jamais crue sur parole : le lieu qu'il
//      propose repasse par le géocodeur, qui refuse ce qui ne correspond à rien.
const ORIGINES_AUTORISEES = [
  /^https:\/\/provo-tbens\.vercel\.app$/,
  /^https:\/\/provo-[a-z0-9-]+-tbens\.vercel\.app$/,
  /^https:\/\/localhost(:\d+)?$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^capacitor:\/\//,
  /^https:\/\/localhost$/,
];

function origineAutorisee(req: Request): boolean {
  const o = req.headers.get("origin") || "";
  // Une application native n'envoie pas d'origine : on ne la bloque pas, mais
  // elle n'ouvre pas non plus la porte à un navigateur tiers.
  if (!o) return true;
  return ORIGINES_AUTORISEES.some((re) => re.test(o));
}

/**
 * Lire le NOM du lieu sur l'image de couverture d'un post.
 *
 * Dernier recours, et il a une raison d'être précise : depuis le 9 août 2026,
 * TikTok ne sert la légende à personne — ni par oEmbed (400 partout, y compris
 * sur des vidéos publiques célèbres), ni dans la page servie aux robots des
 * messageries. Il ne reste que la couverture. Or un carrousel de restaurant
 * affiche presque toujours le nom en surimpression : c'est écrit à l'écran,
 * il suffit de le lire.
 *
 * Trois garde-fous, les mêmes que pour la légende :
 *   1. Seules les origines de l'app déclenchent l'appel (clé payante).
 *   2. On n'appelle qu'en dernier — si une légende avait suffi, on ne vient
 *      jamais ici.
 *   3. Un doute vaut un refus : `confiance: "basse"` ne nomme rien. Une fiche
 *      qui porte un faux nom est pire qu'une fiche à compléter, parce qu'on ne
 *      la vérifie plus.
 */
const COUVERTURE_MAX = 1_500_000; // ~1,5 Mo : au-delà, ce n'est plus une vignette

// Un échec muet est un échec qu'on ne répare pas : chaque sortie dit POURQUOI.
// Le motif remonte dans la réponse (`couverture`), donc un diagnostic suffit à
// distinguer « pas de vignette » de « clé absente » de « rien de lisible ».
type LectureCouverture =
  | { ok: true; title: string; category: string; location: string }
  | { ok: false; pourquoi: string };

// La vignette que TikTok sert aux robots : 600 x 828, qualité 20, avec un
// bouton « play » incrusté par-dessus. Mesuré le 9 août 2026 — et l'URL est
// signée, donc toute tentative d'en obtenir une meilleure version rend 403
// (essayé : retirer l'incrustation, monter la définition, changer de gabarit,
// enlever toute transformation). On ne peut rien y lire, et le modèle le dit :
// « rien_de_lisible ». Appeler quand même coûterait un appel payant par import
// pour un échec certain.
const VIGNETTE_INUTILISABLE = /smartui\/button\/play-icon/i;

async function lireCouverture(imageUrl: string): Promise<LectureCouverture> {
  const key = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY_TB");
  if (!key) return { ok: false, pourquoi: "cle_absente" };
  if (!imageUrl) return { ok: false, pourquoi: "pas_de_vignette" };
  if (VIGNETTE_INUTILISABLE.test(imageUrl)) {
    return { ok: false, pourquoi: "vignette_bouton_play" };
  }

  // 1 · Récupérer l'image. Mesuré sur une couverture TikTok : JPEG, 84 ko.
  let base64 = "", media = "image/jpeg";
  {
    const { signal, clear } = withTimeout(10000);
    try {
      const r = await fetch(imageUrl, { headers: { "User-Agent": UA_ROBOT_SOCIAL }, signal });
      clear();
      if (!r.ok) return { ok: false, pourquoi: `image_http_${r.status}` };
      const type = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
        return { ok: false, pourquoi: `image_type_${type || "inconnu"}` };
      }
      media = type;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!buf.length) return { ok: false, pourquoi: "image_vide" };
      if (buf.length > COUVERTURE_MAX) {
        return { ok: false, pourquoi: `image_${Math.round(buf.length / 1024)}ko` };
      }
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      base64 = btoa(bin);
    } catch (e) {
      clear();
      return { ok: false, pourquoi: `image_erreur_${String((e as Error).message).slice(0, 40)}` };
    }
  }

  // 2 · Lire ce qui est écrit dessus.
  const { signal, clear } = withTimeout(15000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system:
          "Tu regardes l'image de couverture d'un post de réseau social sur un " +
          "voyage. Tu cherches UNIQUEMENT le nom d'un lieu réel — restaurant, " +
          "café, musée, plage, boutique — écrit sur l'image ou clairement " +
          "identifiable par une enseigne visible.\n" +
          "Réponds UNIQUEMENT par un objet JSON compact :\n" +
          '{"title":string,"category":"resto"|"visite"|"balade"|"plage"|"sport"' +
          '|"repos"|"trajet"|"fun","location":string,"confiance":"haute"|"basse"}\n' +
          "title = le nom tel qu'on le chercherait sur une carte. Jamais une " +
          "phrase, jamais un slogan, jamais un plat, jamais un nom de compte.\n" +
          "location = « Nom, Ville, Pays » si la ville est lisible, sinon \"\".\n" +
          "confiance = \"basse\" dès que tu devines, dès que le texte est " +
          "partiel, ou si tu ne vois qu'un plat, un paysage ou une personne.\n" +
          "Si aucun nom de lieu n'est lisible, renvoie {}. Ne déduis JAMAIS un " +
          "nom d'un décor : un lieu faux est pire que pas de lieu.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: base64 } },
            { type: "text", text: "Quel lieu est nommé sur cette image ?" },
          ],
        }],
      }),
    });
    clear();
    if (!r.ok) return { ok: false, pourquoi: `modele_http_${r.status}` };
    const d = await r.json();
    const brut = (d?.content?.[0]?.text || "").match(/\{[\s\S]*\}/);
    if (!brut) return { ok: false, pourquoi: "modele_hors_format" };
    const o = JSON.parse(brut[0]);
    const titre = typeof o?.title === "string" ? o.title.trim() : "";
    // Le doute ne nomme rien : mieux vaut une fiche à compléter qu'un faux nom
    // qu'on ne vérifiera plus. Mais on dit lequel des deux cas s'est produit.
    if (!titre) return { ok: false, pourquoi: "rien_de_lisible" };
    if (o?.confiance === "basse") return { ok: false, pourquoi: `doute_sur_${titre.slice(0, 30)}` };
    return {
      ok: true,
      title: titre,
      category: VALID_CATEGORIES.includes(o?.category) ? o.category : "",
      location: typeof o?.location === "string" ? o.location.trim() : "",
    };
  } catch (e) {
    clear();
    return { ok: false, pourquoi: `modele_erreur_${String((e as Error).message).slice(0, 40)}` };
  }
}

async function classifyWithLLM(text: string, _kind: string) {
  // Deux noms acceptés : le secret Supabase est parfois nommé d'après le
  // libellé de la clé côté Anthropic. Une clé posée sous le mauvais nom donne
  // un silence, pas une erreur — autant fermer ce piège.
  const key = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY_TB");
  if (!key || !text || text.length < 4) return null;
  const { signal, clear } = withTimeout(12000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system:
          "Tu lis la légende d'une vidéo de voyage et tu en extrais TOUS les " +
          "lieux nommés — une légende en cite souvent plusieurs (« 6 spots à " +
          "Lisbonne »), et n'en garder qu'un ferait perdre le reste.\n" +
          "Réponds UNIQUEMENT par un tableau JSON compact, 8 entrées au maximum, " +
          "dans l'ordre de la légende :\n" +
          '[{"title":string,"category":"resto"|"visite"|"balade"|"plage"|"sport"' +
          '|"repos"|"trajet"|"fun","location":string,"confiance":"haute"|"basse"}]\n' +
          "title = le NOM de l'établissement ou du lieu, tel qu'on le chercherait " +
          "sur une carte. Jamais une phrase, jamais un slogan, sans emoji ni " +
          "hashtag.\n" +
          "location = « Nom, Ville, Pays » géocodable si tu l'identifies, sinon \"\".\n" +
          "confiance = \"basse\" dès que tu devines. Mieux vaut ne pas citer un " +
          "lieu que d'en inventer un : un lieu faux est pire que pas de lieu.\n" +
          "Si la légende ne nomme aucun lieu, renvoie [].\n" +
          "Exemples :\n" +
          '« Perfect restaurant for Gen-Zs😂 #genz #fyp » → []\n' +
          '« Bouillon Chartier, le moins cher de Paris » → [{"title":"Bouillon Chartier","category":"resto","location":"Bouillon Chartier, Paris, France","confiance":"haute"}]\n' +
          '« 3 spots à Vienne : Café Central, le Belvédère et Naschmarkt » → ' +
          '[{"title":"Café Central","category":"resto","location":"Café Central, Vienne, Autriche","confiance":"haute"},' +
          '{"title":"Belvédère","category":"visite","location":"Belvédère, Vienne, Autriche","confiance":"haute"},' +
          '{"title":"Naschmarkt","category":"visite","location":"Naschmarkt, Vienne, Autriche","confiance":"haute"}]',
        messages: [{ role: "user", content: text.slice(0, 1500) }],
      }),
    });
    clear();
    if (!r.ok) return null;
    const d = await r.json();
    const raw = d?.content?.[0]?.text || "";
    // Le tableau d'abord ; un objet seul reste accepté au cas où le modèle
    // retombe sur l'ancienne forme.
    const m = raw.match(/\[[\s\S]*\]/) || raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const brut = JSON.parse(m[0]);
    const liste = Array.isArray(brut) ? brut : [brut];
    const lieux = liste
      .filter((p: any) => p && typeof p === "object")
      .map((p: any) => {
        const titre = typeof p.title === "string" ? p.title.trim() : "";
        const lieu = typeof p.location === "string" ? p.location.trim() : "";
        // Une réponse peu sûre ne sert qu'à classer : on ne lui laisse ni
        // nommer l'activité ni la poser sur la carte.
        const sur = p.confiance !== "basse";
        return {
          title: sur ? titre : "",
          category: typeof p.category === "string" ? p.category.trim() : "",
          location: sur ? lieu : "",
        };
      })
      .slice(0, 8);
    // Le modèle a répondu, même sans rien nommer : c'est une information, pas
    // un échec. Le premier reste en tête pour l'appelant qui n'en veut qu'un.
    return { ...(lieux[0] || { title: "", category: "", location: "" }), lieux };
  } catch {
    clear();
    return null;
  }
}

// ── Router ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let url = "";
  let texte = "";
  let sante = false;
  try {
    const body = await req.json();
    url = String(body?.url || "").trim();
    texte = String(body?.texte || "").trim();
    sante = body?.sante === true;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  // Sonde de santé, pour le canari. Elle ne dit qu'une chose : la clé du
  // modèle est-elle posée ? Sans elle, l'échelon de dernier recours — lire le
  // nom sur la couverture — ne peut pas fonctionner, et c'est aujourd'hui le
  // seul qui nomme encore un lieu TikTok. Une clé absente ou expirée doit donc
  // déclencher une alerte, pas se découvrir le jour où quelqu'un ajoute un
  // lien. Elle ne consomme rien : on regarde la variable, on n'appelle pas.
  if (sante) {
    return json({
      ok: true,
      modele: Boolean(
        Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY_TB")),
    });
  }

  // Une légende collée à la main. C'est la porte de secours depuis que TikTok
  // ne rend plus les siennes : l'utilisateur la copie dans l'app d'origine et
  // la colle dans le MÊME champ que les liens — aucun écran, aucun bouton de
  // plus. Le modèle la lit exactement comme il lisait celles qu'on récupérait
  // tout seuls.
  if (!url && texte) {
    if (!origineAutorisee(req)) return json({ error: "origine_refusee" }, 403);
    const ai = await classifyWithLLM(texte.slice(0, 1500), "legende").catch(() => null);
    if (!ai?.title) return json({ error: "aucun_lieu" }, 200);
    const place = ai.location ? await geocode(ai.location) : await geocode(ai.title);
    const result: any = {
      title: ai.title,
      category: VALID_CATEGORIES.includes(ai.category) ? ai.category : "visite",
      notes: texte.slice(0, 400),
      source: "legende",
      modele: true,
    };
    if (place) {
      result.address = place.address;
      result.lat = place.lat;
      result.lon = place.lon;
    }
    const autres = (ai.lieux || []).slice(1).filter((l: any) => l?.title).map((l: any) => ({
      title: l.title,
      category: VALID_CATEGORIES.includes(l.category) ? l.category : "visite",
      location: l.location || "",
    }));
    return json({ ok: true, result, autres }, 200);
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ error: "invalid_url" }, 400);
  }

  try {
    let result = null;
    if (/tiktok\.com/i.test(url)) {
      result = await handleTikTok(url, origineAutorisee(req));
    } else if (/google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.google|share\.google/i.test(url)) {
      result = await handleGoogleMaps(url);
    } else {
      result = await handleGeneric(url);
    }
    if (!result) return json({ error: "no_data" }, 200);
    // `result` reste le lieu principal — aucun appelant existant ne change.
    // `autres` porte ceux que la légende citait en plus : une vidéo « 6 spots
    // à Lisbonne » n'en donnait qu'un seul jusqu'ici, les cinq autres étaient
    // perdus alors qu'ils étaient déjà lus.
    const autres = Array.isArray(result.autres) ? result.autres : [];
    delete result.autres;
    return json({ ok: true, result, autres }, 200);
  } catch (e) {
    return json({ error: "extraction_failed", detail: String(e) }, 200);
  }
});
