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

async function geocode(query: string) {
  const { signal, clear } = withTimeout(8000);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&extratags=1&limit=1`,
      { headers: { "User-Agent": UA, "Accept-Language": "fr" }, signal },
    );
    clear();
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;
    return shapePlace(data[0]);
  } catch {
    clear();
    return null;
  }
}

async function reverseGeocode(lat: number, lon: number) {
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
    return shapePlace(p);
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
    ...(price ? { price } : {}),
  };
}

// ── Redirect resolution ───────────────────────────────────────────────────
async function resolve(url: string): Promise<{ finalUrl: string; html: string }> {
  const { signal, clear } = withTimeout(10000);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "fr,en;q=0.8",
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

async function handleGoogleMaps(rawUrl: string) {
  const { finalUrl, html } = await resolve(rawUrl);
  const haystack = finalUrl + "\n" + html.slice(0, 200_000);

  let name = extractMapsName(finalUrl);
  if (!name) {
    const ogTitle = metaTag(html, "og:title") || metaTag(html, "twitter:title");
    if (ogTitle && !/^google maps$/i.test(ogTitle)) {
      name = ogTitle.replace(/\s*[-–—]\s*Google Maps\s*$/i, "").trim();
    }
  }
  if (!name) {
    const inHtml = haystack.match(/\/maps\/place\/([^/@?&"'\\]+)/);
    if (inHtml) name = decodeURIComponent(inHtml[1].replace(/\+/g, " ")).replace(/_/g, " ").trim();
  }

  const coords = extractMapsCoords(haystack);

  // Coordinates → reverse geocode gives the most accurate address + category.
  if (coords) {
    const place = await reverseGeocode(coords.lat, coords.lon);
    if (place) {
      return {
        ...place,
        title: cleanTitle(name) || place.title,
        lat: coords.lat,
        lon: coords.lon,
        link: rawUrl,
        source: "google_maps",
      };
    }
    return {
      title: cleanTitle(name) || "Lieu",
      lat: coords.lat,
      lon: coords.lon,
      category: "visite",
      link: rawUrl,
      source: "google_maps",
    };
  }

  // No coordinates — geocode the place name.
  if (name) {
    const place = await geocode(name);
    if (place) return { ...place, title: cleanTitle(name) || place.title, link: rawUrl, source: "google_maps" };
    return { title: cleanTitle(name), category: "visite", link: rawUrl, source: "google_maps" };
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

function cleanTitle(raw: string | null): string {
  if (!raw) return "";
  let t = raw
    .replace(/#[\p{L}\p{N}_]+/gu, " ")        // hashtags
    .replace(/https?:\/\/\S+/g, " ")          // urls
    .replace(/@[\w.]+/g, " ")                 // mentions
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, " ") // emoji
    .replace(/\s+/g, " ")
    .trim();
  // First sentence / segment, capped.
  t = t.split(/[\n.!?•|]/)[0].trim();
  if (t.length > 70) t = t.slice(0, 70).trim();
  return t;
}

function extractLocationHint(caption: string): string | null {
  // "📍 Place, City"
  const pin = caption.match(/📍\s*([^\n#@]{2,80})/);
  if (pin) return pin[1].replace(/[|•].*$/, "").trim();
  // "at <Place>" / "à <Place>"
  const at = caption.match(/(?:^|\s)(?:at|à|chez|in)\s+([A-ZÀ-Ý][\p{L}'’\- ]{2,50})/u);
  if (at) return at[1].trim();
  return null;
}

async function handleTikTok(rawUrl: string) {
  const { finalUrl } = await resolve(rawUrl);
  const target = /tiktok\.com\/.+\/video\//.test(finalUrl) ? finalUrl : rawUrl;

  let caption = "";
  let author = "";
  let thumb = "";
  try {
    const { signal, clear } = withTimeout(8000);
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`, {
      headers: { "User-Agent": UA },
      signal,
    });
    clear();
    if (r.ok) {
      const d = await r.json();
      caption = d.title || "";
      author = d.author_name || "";
      thumb = d.thumbnail_url || "";
    }
  } catch { /* ignore */ }

  const locationHint = extractLocationHint(caption);
  let title = cleanTitle(locationHint) || cleanTitle(caption);
  let category = categoryFromHashtags(caption) || "fun";

  // Optional AI refinement of the messy caption.
  const ai = await classifyWithLLM(caption, "tiktok").catch(() => null);
  if (ai) {
    if (ai.title) title = ai.title;
    if (ai.category && VALID_CATEGORIES.includes(ai.category)) category = ai.category;
  }

  const result: any = {
    title: title || (author ? `Idée de ${author}` : "Activité TikTok"),
    category,
    link: rawUrl,
    photoUrl: thumb,
    notes: caption ? caption.slice(0, 400) : "",
    source: "tiktok",
  };

  // Try to geocode an extracted location for address + coordinates.
  const geoQuery = (ai?.location) || locationHint;
  if (geoQuery) {
    const place = await geocode(geoQuery);
    if (place) {
      result.address = place.address;
      result.lat = place.lat;
      result.lon = place.lon;
      if (!ai?.category) result.category = place.category;
      if (!title) result.title = place.title;
    }
  }
  return result;
}

// ── Generic website ───────────────────────────────────────────────────────
async function handleGeneric(rawUrl: string) {
  const { finalUrl, html } = await resolve(rawUrl);
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
  void finalUrl;
  return result;
}

// ── Optional Claude classification ────────────────────────────────────────
async function classifyWithLLM(text: string, _kind: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
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
        max_tokens: 256,
        system:
          "You extract a single travel activity from a social-media caption. " +
          "Reply ONLY with compact JSON: {\"title\":string,\"category\":one of " +
          "[resto,visite,balade,plage,sport,repos,trajet,fun],\"location\":string}. " +
          "title = short clean name of the place/activity (no hashtags/emoji, max 8 words). " +
          "location = a geocodable 'Place, City, Country' if identifiable, else \"\".",
        messages: [{ role: "user", content: text.slice(0, 1500) }],
      }),
    });
    clear();
    if (!r.ok) return null;
    const d = await r.json();
    const raw = d?.content?.[0]?.text || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return {
      title: typeof parsed.title === "string" ? parsed.title.trim() : "",
      category: typeof parsed.category === "string" ? parsed.category.trim() : "",
      location: typeof parsed.location === "string" ? parsed.location.trim() : "",
    };
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
  try {
    const body = await req.json();
    url = String(body?.url || "").trim();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ error: "invalid_url" }, 400);
  }

  try {
    let result = null;
    if (/tiktok\.com/i.test(url)) {
      result = await handleTikTok(url);
    } else if (/google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.google/i.test(url)) {
      result = await handleGoogleMaps(url);
    } else {
      result = await handleGeneric(url);
    }
    if (!result) return json({ error: "no_data" }, 200);
    return json({ ok: true, result }, 200);
  } catch (e) {
    return json({ error: "extraction_failed", detail: String(e) }, 200);
  }
});
