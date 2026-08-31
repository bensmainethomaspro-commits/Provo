import { supabase } from '../lib/supabase';

// Server-side extractor (Supabase Edge Function "extract-place").
// Resolves short links (TikTok / Google Maps) and returns structured place
// data. Returns null on any failure so callers can fall back to the legacy
// client-side parsers.
export async function extractViaEdge(url, destination = '') {
  try {
    const { data, error } = await supabase.functions.invoke('extract-place', {
      // La destination départage deux homonymes quand l'agent doit chercher le
      // lieu à partir du seul lien. Facultative : sans elle il cherche quand
      // même, il tranche juste moins bien.
      body: { url, ...(destination ? { destination } : {}) },
    });
    if (error) return null;
    if (data?.ok && data.result && (data.result.title || data.result.lat != null)) {
      // Les lieux que la légende citait en plus voyagent avec le principal.
      // Rangés sur l'objet plutôt que dans un second retour : tous les
      // appelants existants continuent de lire ce qu'ils lisaient.
      const autres = Array.isArray(data.autres) ? data.autres.filter(a => a?.title) : [];
      return autres.length ? { ...data.result, autresLieux: autres } : data.result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Une légende collée à la main.
 *
 * TikTok ne rend plus les siennes — ni par oEmbed (400 partout depuis le
 * 9 août 2026), ni dans la page servie aux robots des messageries. Quand la
 * couverture ne suffit pas, il reste ce que l'utilisateur a sous les yeux :
 * le texte du post. Il le colle dans le MÊME champ que les liens, et le
 * modèle le lit comme il lisait les légendes qu'on récupérait tout seuls.
 */
export async function lireLegende(texte) {
  try {
    const { data, error } = await supabase.functions.invoke('extract-place', {
      body: { texte },
    });
    if (error || !data?.ok || !data.result?.title) return null;
    const autres = Array.isArray(data.autres) ? data.autres.filter(a => a?.title) : [];
    return autres.length ? { ...data.result, autresLieux: autres } : data.result;
  } catch {
    return null;
  }
}

/**
 * Ce texte ressemble-t-il à une légende de réseau social plutôt qu'à une
 * recherche de lieu ? On cherche « Deoun » en trois mots ; on colle une
 * légende en plusieurs lignes, avec des hashtags et des émojis.
 */
/**
 * Décoder les échappements d'une chaîne extraite d'un bloc JSON.
 *
 * Un raccourci iOS capture la légende directement dans le bloc de données de
 * la page : il en rend le texte BRUT, avec `\u00e9` pour « é » et une paire
 * de substituts pour chaque émoji. Laissé tel quel, ça finirait dans les notes
 * de la fiche. Le décoder ici évite d'ajouter une action au raccourci — ce que
 * l'utilisateur devrait refaire à la main.
 */
export function texteDecode(t) {
  const brut = String(t || '');
  if (!brut.includes('\\')) return brut;
  return brut
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/');
}

export function ressembleAUneLegende(texte) {
  const t = (texte || '').trim();
  if (t.length < 45) return false;
  if (/^https?:\/\//i.test(t)) return false;
  const signes = [
    /#[\p{L}\p{N}_]{3,}/u.test(t),                                   // hashtags
    /[\p{Extended_Pictographic}]/u.test(t),                          // émojis
    t.includes('\n'),                                                // plusieurs lignes
    t.split(/\s+/).length >= 12,                                     // une phrase, pas un nom
  ].filter(Boolean).length;
  return signes >= 2;
}

// ── Client-side extractor (works without the Edge Function) ────────────────
// Mirrors the server agent: cleans the caption, classifies it, and geocodes
// the place. TikTok oEmbed and Nominatim are both CORS-accessible from the
// browser; Google Maps short links go through importFromGoogleMaps' proxy chain.
const _TT_CAT_RULES = [
  [/restaurant|resto|food|foodie|eat|cafe|coffee|brunch|cuisine|miam|gastronom/, 'resto'],
  [/beach|plage|\bmer\b|ocean|\bsea\b|seaside|crique/, 'plage'],
  [/hike|hiking|rando|trail|trek|montagne|mountain|forest|nature|cascade|waterfall|balade|walk/, 'balade'],
  [/museum|musee|monument|castle|chateau|church|eglise|histo|culture|\bart\b|gallery|visite|sightseeing/, 'visite'],
  [/sport|gym|fitness|surf|\bski\b|climb|escalade|velo|bike|kayak|dive|plong/, 'sport'],
  [/spa|wellness|hotel|relax|chill|repos|massage/, 'repos'],
  [/party|club|\bbar\b|nightlife|concert|festival|\bfun\b|game|parc|amusement/, 'fun'],
];
function _catFromHashtags(text) {
  const t = (text || '').toLowerCase();
  for (const [re, cat] of _TT_CAT_RULES) if (re.test(t)) return cat;
  return null;
}
function _stripEmoji(s) {
  return s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{2122}\u{2139}\u{2300}-\u{23FF}]/gu, ' ');
}
function _cleanCaption(raw) {
  if (!raw) return '';
  let t = _stripEmoji(raw)
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@[\w.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.split(/[\n.!?•|]/)[0].trim();
  if (t.length > 70) t = t.slice(0, 70).trim();
  return t.replace(/[\s,]+$/, '').trim();
}
function _locationHint(caption) {
  const pin = caption.match(/📍\s*([\p{L}\p{N}][\p{L}\p{N}\s,&'’.\-]{1,60})/u);
  if (pin) return pin[1].replace(/\s+/g, ' ').trim().replace(/[\s,]+$/, '');
  const at = caption.match(/(?:^|\s)(?:at|à|chez|in)\s+([A-ZÀ-Ý][\p{L}'’\- ]{2,50})/u);
  if (at) return at[1].trim();
  return null;
}

// Hashtags trop génériques pour désigner un lieu.
const _TAG_STOP = new Set([
  'fyp', 'fypage', 'foryou', 'foryoupage', 'pourtoi', 'viral', 'trending', 'tiktok',
  'travel', 'voyage', 'trip', 'vacances', 'holiday', 'vacation', 'wanderlust',
  'food', 'foodie', 'foodtok', 'recette', 'recipe', 'restaurant', 'resto',
  'amazing', 'beautiful', 'aesthetic', 'satisfying', 'explore', 'adventure',
  'nature', 'beach', 'plage', 'sunset', 'summer', 'ete', 'hiver', 'love',
  'hiddengem', 'hiddengems', 'traveltok', 'traveltips', 'bonplan', 'bonsplans',
]);
function _hashtagCandidates(caption) {
  return [...caption.matchAll(/#([\p{L}\p{N}_]{4,30})/gu)]
    .map(m => m[1].toLowerCase())
    .filter(t => !_TAG_STOP.has(t) && !/^\d+$/.test(t))
    .slice(0, 3);
}
// Géocodage strict (vraies villes / régions / sites uniquement) pour les hashtags.
async function _geocodeStrict(query) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&extratags=1&limit=1`
    );
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.length) return null;
    if (!['place', 'boundary', 'tourism', 'natural', 'leisure', 'waterway'].includes(data[0].class)) return null;
    return fetchPlaceData(query).catch(() => null);
  } catch { return null; }
}

export async function extractPlaceClient(url) {
  const raw = (url || '').trim();
  if (!raw) return null;

  // ── TikTok ──
  if (/tiktok\.com/i.test(raw)) {
    // Resolve vm./vt. short links to the canonical video URL — oEmbed is more
    // reliable with the full URL.
    let target = raw;
    if (/(?:vm|vt)\.tiktok\.com/i.test(raw)) {
      try {
        const { finalUrl, html } = await fetchHtmlViaProxy(raw);
        if (finalUrl && /tiktok\.com\/.+\/video\//.test(finalUrl)) target = finalUrl;
        else if (html) {
          const m = html.match(/https?:\/\/www\.tiktok\.com\/@[^/"'\s]+\/video\/\d+/);
          if (m) target = m[0];
        }
      } catch { /* ignore */ }
    }
    let caption = '', author = '', thumb = '';
    try {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`);
      if (r.ok) { const d = await r.json(); caption = d.title || ''; author = d.author_name || ''; thumb = d.thumbnail_url || ''; }
    } catch { /* ignore */ }
    const loc = _locationHint(caption);
    const title = _cleanCaption(loc) || _cleanCaption(caption) || (author ? `Idée de ${author}` : 'Activité TikTok');
    const result = {
      title,
      category: _catFromHashtags(caption) || 'fun',
      link: raw,
      photoUrl: thumb,
      notes: caption ? caption.slice(0, 400) : '',
      source: 'tiktok',
    };
    let place = loc ? await fetchPlaceData(loc).catch(() => null) : null;
    if (!place?.lat) {
      // Fallback : hashtags qui géocodent vers un vrai lieu (#lisbonne, #bali…)
      for (const tag of _hashtagCandidates(caption)) {
        place = await _geocodeStrict(tag);
        if (place?.lat != null) break;
      }
    }
    if (place?.lat != null) {
      result.address = place.address;
      result.lat = place.lat;
      result.lon = place.lon;
      result.category = _catFromHashtags(caption) || place.category;
    }
    return result;
  }

  // ── Google Maps (incl. share.google universal links) ──
  if (/google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.google|share\.google/i.test(raw)) {
    const r = await importFromGoogleMaps(raw).catch(() => null);
    return r ? { source: 'google_maps', ...r } : null;
  }

  // ── Any other website ──
  const meta = await fetchUrlMetadata(raw).catch(() => null);
  if (meta?.title) {
    const place = await fetchPlaceData(meta.title).catch(() => null);
    return {
      title: meta.title,
      photoUrl: meta.photoUrl || '',
      link: raw,
      source: 'web',
      ...(place?.lat != null
        ? { address: place.address, lat: place.lat, lon: place.lon, category: place.category }
        : { category: getSiteCategory(raw) || 'visite' }),
    };
  }
  return null;
}

export const CATEGORIES = [
  { id: 'resto',    emoji: '🍽️', label: 'Resto' },
  { id: 'visite',   emoji: '🏛️', label: 'Visite' },
  { id: 'balade',   emoji: '🥾', label: 'Balade' },
  { id: 'plage',    emoji: '🏖️', label: 'Plage' },
  { id: 'sport',    emoji: '🏋️', label: 'Sport' },
  { id: 'repos',    emoji: '🧘', label: 'Repos' },
  { id: 'trajet',   emoji: '🚗', label: 'Trajet' },
  { id: 'fun',      emoji: '🎉', label: 'Fun' },
];

export const STATUS_CONFIG = {
  todo: { emoji: '⏳', label: 'À faire', cls: 'status--todo' },
  done: { emoji: '✅', label: 'Fait',    cls: 'status--done' },
  nogo: { emoji: '❌', label: 'Nogo',    cls: 'status--nogo' },
};

export const TRIP_EMOJIS = ['✈️','🌍','🗺️','🏕️','🚢','🗽','🏔️','🏖️','🌅','🎡','🏯','🧳','🚂','🚗','⛵'];

export function getCategoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) || { emoji: '📌', label: id };
}

export function totalMinutes(activities) {
  return activities.reduce((sum, a) => sum + (a.durationHours || 0) * 60 + (a.durationMinutes || 0), 0);
}

export function formatDuration(minutes) {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getDayLabel(index, total) {
  if (total === 1) return 'Jour unique';
  return `Jour ${index + 1}`;
}

export function encodeTrip(trip) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(trip))));
}

export function decodeTrip(encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

// ─── Budget ───────────────────────────────────────────────
export function totalBudget(activities) {
  return activities
    .filter(a => a.status !== 'nogo')
    .reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
}

export function formatPrice(amount) {
  if (!amount && amount !== 0) return null;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

/**
 * Ce que la journée devrait coûter — une PRÉVISION, rien d'autre.
 *
 * Le programme ne décompte rien. Un prix noté sur une activité est une
 * estimation, pas un paiement : ce qui est réellement dépensé, c'est ce qu'on
 * saisit dans l'onglet Dépenses, et seulement cela. Faire l'inverse ferait
 * apparaître des dépassements de budget pour de l'argent que personne n'a
 * sorti.
 *
 * Les repas comptent dans cette prévision — c'est même leur seule raison
 * d'avoir un prix : ils sont ajoutés d'office à chaque journée pour qu'on
 * sache à quoi s'attendre.
 */
export function budgetStats(activities) {
  const active = activities.filter(a => a.status !== 'nogo');
  const prix = (a) => parseFloat(a.price) || 0;
  const total = active.reduce((s, a) => s + prix(a), 0);
  return {
    total,
    // Part de la prévision qui vient des repas, pour pouvoir l'expliquer.
    repas: active.filter(a => a.isMeal).reduce((s, a) => s + prix(a), 0),
    horsRepas: active.filter(a => !a.isMeal).reduce((s, a) => s + prix(a), 0),
  };
}

// ─── Time cascade ─────────────────────────────────────────
export function timeToMin(timeStr) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(minutes) {
  const h = Math.floor(((minutes % 1440) + 1440) % 1440 / 60);
  const m = ((minutes % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getTimeSlots(activities, startTime = '09:00') {
  let current = timeToMin(startTime);
  const slots = {};
  for (const a of activities) {
    if (a.status === 'nogo') { slots[a.id] = null; continue; }
    const dur = (a.durationHours || 0) * 60 + (a.durationMinutes || 0);
    if (a.fixedStart) {
      // Une heure saisie par l'utilisateur est un fait, pas une suggestion.
      // `Math.max` la remplaçait par le curseur dès qu'elle tombait plus tôt
      // que l'activité précédente : on changeait l'heure d'une activité et
      // rien ne bougeait à l'écran.
      const fixedMin = timeToMin(a.fixedStart);
      slots[a.id] = { start: minToTime(fixedMin), end: minToTime(fixedMin + dur), fixed: true };
      // Les activités libres qui suivent repartent d'après celle-ci, sans
      // jamais reculer.
      current = Math.max(current, fixedMin + dur);
    } else {
      slots[a.id] = { start: minToTime(current), end: minToTime(current + dur) };
      current += dur;
    }
  }
  return slots;
}

// ─── Category colors ──────────────────────────────────────
export const CATEGORY_COLORS = {
  resto:  '#C2456E',
  visite: '#7E57C2',
  balade: '#2E9E6B',
  plage:  '#2E86C1',
  sport:  '#D6455F',
  repos:  '#6B5B8A',
  trajet: '#64748B',
  fun:    '#00A6A6',
};

export function deduceTitle(category, address, notes) {
  const cat = CATEGORIES.find(c => c.id === category);
  if (address) {
    const place = address.split(',')[0].trim();
    if (place.length >= 2) return cat ? `${cat.emoji} ${place}` : place;
  }
  if (notes) {
    const first = notes.trim().split(/\n/)[0].split(/\s+/).slice(0, 5).join(' ');
    if (first.length >= 3) return first;
  }
  return cat ? `${cat.emoji} ${cat.label}` : 'Activité';
}

export function parseGoogleMapsUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('google') && !u.hostname.includes('goo.gl')) return null;
    const m = u.pathname.match(/\/maps\/(?:place|search)\/([^/@?&]+)/);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/_/g, ' ');
    const q = u.searchParams.get('q') || u.searchParams.get('daddr');
    if (q) return q;
  } catch {}
  return null;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/(?:^|\s|-|')\S/g, c => c.toUpperCase());
}

function cleanGoogleMapsUrl(url) {
  try {
    const u = new URL(url);
    ['g_st', 'g_ep', 'g_cp', 'g_ch', 'entry'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch { return url; }
}

function makeAbortSignal(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function fetchHtmlViaProxy(url) {
  // Ces proxys publics tombent souvent — mesuré le 27/07 : allorigins 520,
  // codetabs 522, corsproxy 403, seul r.jina.ai répondait. En série avec 12 s
  // chacun, l'utilisateur attendait jusqu'à 36 s avant de voir l'échec.
  // On les interroge donc en parallèle : le premier qui répond gagne, et un
  // échec complet ne coûte qu'une seule attente.
  const TIMEOUT = 8000;

  // allorigins est le seul à donner l'URL finale après redirections — précieux
  // pour les liens courts, dont le nom du lieu est dans cette URL.
  const viaAllOrigins = async () => {
    const { signal, clear } = makeAbortSignal(TIMEOUT);
    const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal });
    clear();
    if (!r.ok) throw new Error('allorigins');
    const d = await r.json();
    const html = d.contents || '';
    if (!html) throw new Error('allorigins vide');
    const finalUrl = d.status?.url || '';
    return { html, finalUrl: finalUrl && finalUrl !== url ? finalUrl : null };
  };

  const viaPlain = async (proxyUrl, name) => {
    const { signal, clear } = makeAbortSignal(TIMEOUT);
    const r = await fetch(proxyUrl, { signal });
    clear();
    if (!r.ok) throw new Error(name);
    const html = await r.text();
    if (!html) throw new Error(`${name} vide`);
    return { html, finalUrl: null };
  };

  try {
    return await Promise.any([
      viaAllOrigins(),
      viaPlain(`https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`, 'codetabs'),
      viaPlain(`https://corsproxy.io/?${encodeURIComponent(url)}`, 'corsproxy'),
      viaPlain(`https://r.jina.ai/${url}`, 'jina'),
    ]);
  } catch {
    return { html: '', finalUrl: null };
  }
}

function extractCoordsFromUrl(url) {
  try {
    const u = new URL(url);
    const pathMatch = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (pathMatch) return { lat: parseFloat(pathMatch[1]), lon: parseFloat(pathMatch[2]) };
    const ll = u.searchParams.get('ll') || u.searchParams.get('center') || u.searchParams.get('near');
    if (ll) {
      const [lat, lon] = ll.split(',').map(parseFloat);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
    const q = u.searchParams.get('q');
    if (q && /^-?\d+\.\d+,-?\d+\.\d+$/.test(q.trim())) {
      const [lat, lon] = q.split(',').map(parseFloat);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
  } catch {}
  return null;
}

function extractCoordsFromHtml(html) {
  // @lat,lon in embedded Google Maps URLs
  const urlCoords = html.match(/\/@(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})[,/]/);
  if (urlCoords) return { lat: parseFloat(urlCoords[1]), lon: parseFloat(urlCoords[2]) };
  // !3dLAT!4dLON place-data blob (common in resolved share links)
  const blob = html.match(/!3d(-?\d{1,3}\.\d{4,})!4d(-?\d{1,3}\.\d{4,})/);
  if (blob) return { lat: parseFloat(blob[1]), lon: parseFloat(blob[2]) };
  // ll=lat,lon pattern
  const llParam = html.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (llParam) return { lat: parseFloat(llParam[1]), lon: parseFloat(llParam[2]) };
  // q=lat,lon pattern (app deep links)
  const qParam = html.match(/[?&](?:q|center)=(-?\d+\.\d{4,}),(-?\d+\.\d{4,})/);
  if (qParam) return { lat: parseFloat(qParam[1]), lon: parseFloat(qParam[2]) };
  return null;
}

async function reverseGeocode(lat, lon) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&extratags=1`
  );
  if (!r.ok) return null;
  const p = await r.json();
  if (!p?.display_name) return null;
  const a = p.address || {};
  const ex = p.extratags || {};
  const road = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.municipality;
  const address = [road || a.suburb || a.neighbourhood, city, a.country]
    .filter(Boolean).join(', ') || p.display_name.split(',').slice(0, 4).join(',').trim();
  const typeText = [p.type, p.class, ex.amenity, ex.tourism, ex.leisure, ex.natural, ex.shop]
    .filter(Boolean).join(' ').toLowerCase();
  const catRules = [
    [/restaurant|cafe|coffee|brasserie|bar|pub|fast_food|bistro|snack/, 'resto'],
    [/beach|plage|coast|swimming_area/, 'plage'],
    [/sport|fitness|gym|stadium|climbing|tennis|golf/, 'sport'],
    [/hotel|hostel|lodge|inn|guesthouse|accommodation/, 'repos'],
    [/airport|train_station|bus_station|ferry|metro|subway|tram/, 'trajet'],
    [/park|forest|trail|hiking|viewpoint|peak|waterfall|garden|nature/, 'balade'],
    [/nightclub|casino|cinema|theatre|amusement|theme_park|arcade/, 'fun'],
  ];
  let category = 'visite';
  for (const [re, cat] of catRules) { if (re.test(typeText)) { category = cat; break; } }
  const chargeMatch = (ex.charge || ex.fee_amount || '').match(/[\d.,]+/);
  const price = chargeMatch ? parseFloat(chargeMatch[0].replace(',', '.')) || null : null;
  let photoUrl = null;
  const wikiRaw = ex.wikipedia || '';
  const wikiLangMatch = wikiRaw.match(/^([a-z]{2}):/);
  const wikiLang = wikiLangMatch?.[1] || 'en';
  const wikiKey = wikiLangMatch ? wikiRaw.slice(wikiLangMatch[0].length) : wikiRaw;
  if (wikiKey) {
    try {
      const wRes = await fetch(`https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiKey)}`);
      if (wRes.ok) { const w = await wRes.json(); photoUrl = w.thumbnail?.source?.replace(/\/\d+px-/, '/600px-') || null; }
    } catch {}
  }

  return {
    title: _placeTitle(p),
    address, category, lat, lon,
    ...(price ? { price } : {}),
    openingHours: ex.opening_hours || '',
    ...(photoUrl ? { photoUrl } : {}),
  };
}

function extractFromHtml(html) {
  // a) <link rel="canonical">
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (canonical?.[1]) { const n = parseGoogleMapsUrl(canonical[1]); if (n) return { name: n, url: canonical[1] }; }

  // b) og:url meta
  const ogUrl = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i);
  if (ogUrl?.[1]) { const n = parseGoogleMapsUrl(ogUrl[1]); if (n) return { name: n, url: ogUrl[1] }; }

  // c) JS redirect: window.location(.replace/.href) = "..." or window.location.replace("...")
  const jsRedir = html.match(/window\.location(?:\.(?:replace|href))?\s*[=(]\s*["']([^"']+)["']/i);
  if (jsRedir?.[1]) {
    const t = jsRedir[1];
    const n = parseGoogleMapsUrl(t); if (n) return { name: n, url: t };
  }

  // d) meta http-equiv refresh
  const refresh = html.match(/http-equiv=["']refresh["'][^>]+content=["'][^;]*;\s*url=([^"'\s>]+)/i)
    || html.match(/content=["'][^;]*;\s*url=([^"'\s>]+)[^>]*http-equiv=["']refresh["']/i);
  if (refresh?.[1]) {
    const t = refresh[1].trim();
    const n = parseGoogleMapsUrl(t); if (n) return { name: n, url: t };
  }

  // e) Firebase Dynamic Links JS variables (webUrl / DESKTOPFALLBACKLINK / fallbackUrl)
  const fbVar = html.match(/(?:webUrl|DESKTOPFALLBACKLINK|fallbackUrl|deepLink)\s*[=:]\s*["']([^"']+)["']/i);
  if (fbVar?.[1]) { const n = parseGoogleMapsUrl(fbVar[1]); if (n) return { name: n, url: fbVar[1] }; }

  // f) <a href="https://www.google.com/maps/..."> fallback link in redirect pages
  const aHref = html.match(/href=["'](https?:\/\/(?:www\.)?google\.com\/maps[^"'<>\s]+)["']/i);
  if (aHref?.[1]) { const n = parseGoogleMapsUrl(aHref[1]); if (n) return { name: n, url: aHref[1] }; }

  // g) any google maps URL in the HTML (broadest net)
  const anywhere = html.match(/https?:\/\/(?:www\.|maps\.)?google\.[a-z.]{2,6}\/maps[^"'<>\s\\]*/gi);
  if (anywhere) {
    for (const u of anywhere) {
      const n = parseGoogleMapsUrl(u); if (n) return { name: n, url: u };
    }
  }

  return null;
}

export async function importFromGoogleMaps(url) {
  const cleaned = cleanGoogleMapsUrl(url);
  let resolvedUrl = url;
  let placeName = null;

  if (/google\.com\/maps|goo\.gl|maps\.app|share\.google/.test(url)) {
    const { html, finalUrl } = await fetchHtmlViaProxy(cleaned);
    if (finalUrl) resolvedUrl = finalUrl;

    // Strategy 1: parse the final/cleaned URL directly
    placeName = parseGoogleMapsUrl(resolvedUrl) || parseGoogleMapsUrl(cleaned) || parseGoogleMapsUrl(url);

    // Strategy 2: extract from HTML (canonical, og:url, JS redirect, meta refresh, raw match)
    if (!placeName && html) {
      const extracted = extractFromHtml(html);
      if (extracted) { placeName = extracted.name; resolvedUrl = extracted.url; }
    }

    // Strategy 3: DOMParser for og:url / og:title / <title>
    if (!placeName && html) {
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const ogUrlEl = doc.querySelector('meta[property="og:url"]');
        if (ogUrlEl?.content) {
          const n = parseGoogleMapsUrl(ogUrlEl.content);
          if (n) { placeName = n; resolvedUrl = ogUrlEl.content; }
        }
        if (!placeName) {
          const ogTitle = doc.querySelector('meta[property="og:title"]')?.content;
          if (ogTitle) {
            const c = ogTitle.replace(/\s*[-–—]\s*(?:Google Maps|Maps)\s*$/i, '').trim();
            if (c && c.toLowerCase() !== 'google maps') placeName = c;
          }
        }
        if (!placeName) {
          const t = doc.querySelector('title')?.textContent?.trim();
          if (t) {
            const c = t.replace(/\s*[-–—]\s*(?:Google Maps|Maps)\s*$/i, '').trim();
            if (c && c.toLowerCase() !== 'google maps') placeName = c;
          }
        }
      } catch {}
    }

    // Strategy 4: regex og:title fallback
    if (!placeName && html) {
      const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
      if (m) {
        const c = m[1].replace(/\s*[-–—]\s*(?:Google Maps|Maps)\s*$/i, '').trim();
        if (c && c.toLowerCase() !== 'google maps') placeName = c;
      }
    }

    // Strategy 5: any place name in redirect URL params in the HTML
    if (!placeName && html) {
      const urlInHtml = html.match(/https?:\/\/(?:www\.)?google\.[a-z.]{2,6}\/maps[^"'<>\s\\]*/gi);
      if (urlInHtml) {
        for (const u of urlInHtml) {
          const n = parseGoogleMapsUrl(u);
          if (n) { placeName = n; resolvedUrl = u; break; }
        }
      }
    }

    // Strategy 6: extract coordinates → reverse geocode (robust fallback for short links)
    if (!placeName) {
      const coords = extractCoordsFromUrl(resolvedUrl)
        || extractCoordsFromUrl(cleaned)
        || (html ? extractCoordsFromHtml(html) : null);
      if (coords) {
        const rev = await reverseGeocode(coords.lat, coords.lon).catch(() => null);
        if (rev) return { ...rev, link: url };
      }
    }
  }

  if (!placeName) placeName = parseGoogleMapsUrl(url);
  if (!placeName) return null;

  const cleanTitle = toTitleCase(placeName.replace(/\+/g, ' '));

  // Les coordonnées d'un lien Maps désignent un point, pas la fiche : le
  // géocodage inverse y ramasse ce qui traîne (un immeuble, un pont). Le nom
  // est dans l'URL — on cherche donc le nom, situé par les coordonnées, et on
  // ne retombe sur l'inverse que si cette recherche ne donne rien.
  // Mesuré sur six lieux : inverse seul 28 points, nom situé 64.
  const urlCoords = extractCoordsFromUrl(resolvedUrl) || extractCoordsFromUrl(cleaned);

  const named = await fetchPlaceData(placeName, urlCoords || {}).catch(() => null);
  if (named && (!urlCoords || haversineKm(urlCoords.lat, urlCoords.lon, named.lat, named.lon) < 25)) {
    return { ...named, title: named.title || cleanTitle, link: url };
  }

  if (urlCoords) {
    const revData = await reverseGeocode(urlCoords.lat, urlCoords.lon).catch(() => null);
    if (revData) return { ...revData, title: cleanTitle, link: url };
  }

  if (named) return { ...named, title: named.title || cleanTitle, link: url };
  return { title: cleanTitle, link: url };
}

export async function fetchUrlMetadata(url) {
  // Try site-specific parser first (fast, no API needed)
  const siteTitle = parseBookingUrl(url);
  if (siteTitle) {
    const siteCategory = getSiteCategory(url);
    const placeData = await fetchPlaceData(siteTitle).catch(() => null);
    return placeData
      ? { ...placeData, title: placeData.title || siteTitle, link: url }
      : { title: siteTitle, link: url, ...(siteCategory ? { category: siteCategory } : {}) };
  }
  // Fallback: Microlink API
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(url)}&palette=false&audio=false&video=false&iframe=false`,
      { signal: controller.signal }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'success' || !data.data) return null;
    const d = data.data;
    const title = d.title || '';
    const siteCategory = getSiteCategory(url);
    if (title) {
      const placeData = await fetchPlaceData(title).catch(() => null);
      if (placeData?.lat) return { ...placeData, title: placeData.title || title, link: url };
    }
    return { title, photoUrl: d.image?.url || '', link: url, ...(siteCategory ? { category: siteCategory } : {}) };
  } catch {
    return null;
  }
}

export async function resolveShortUrl(url) {
  if (!/goo\.gl|maps\.app/.test(url)) return url;
  const cleaned = cleanGoogleMapsUrl(url);
  const { finalUrl } = await fetchHtmlViaProxy(cleaned);
  return finalUrl || cleaned;
}

// ── Mise en forme d'un résultat Nominatim ─────────────────────────────────
// Partagée par la recherche à un résultat et par la recherche par adresse, qui
// doivent classer et formater exactement de la même manière.
const _PLACE_CAT_RULES = [
  [/restaurant|cafe|coffee|brasserie|bar|pub|fast_food|food_court|bistro|snack|tabac_presse/, 'resto'],
  [/beach|plage|coast|swimming_area|baignade/, 'plage'],
  [/sport|fitness|gym|swimming_pool|stadium|climbing|tennis|golf|ski|surf/, 'sport'],
  [/hotel|hostel|motel|lodge|inn|guesthouse|resort|chalet|accommodation/, 'repos'],
  [/airport|train_station|bus_station|ferry_terminal|metro|subway|tram/, 'trajet'],
  [/park|forest|trail|hiking|viewpoint|peak|waterfall|garden|nature_reserve|bay|lake|river|wood/, 'balade'],
  [/nightclub|casino|cinema|theatre|amusement|theme_park|arcade|entertainment|concert/, 'fun'],
];

// Un titre lisible. Attention au piège des adresses : Nominatim renvoie le
// numéro de rue comme composant séparé (« 2, Rue du Helder, Biarritz… »), donc
// prendre le premier morceau donne « 2 ». On recompose « 2 Rue du Helder ».
const _isHouseNumber = (s) => /^\d+\s*[a-zA-Z]?$/.test(String(s || '').trim());

function _placeTitle(p) {
  const name = String(p.name || '').trim();
  if (name && !_isHouseNumber(name)) return name;

  const a = p.address || {};
  const road = a.road || a.pedestrian || a.footway;
  const num = a.house_number || (_isHouseNumber(name) ? name : '');
  if (road) return [num, road].filter(Boolean).join(' ');

  const parts = String(p.display_name || '').split(',').map(s => s.trim());
  if (_isHouseNumber(parts[0]) && parts[1]) return `${parts[0]} ${parts[1]}`;
  return parts[0] || '';
}

function _placeAddress(p) {
  const a = p.address || {};
  const road = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.municipality;
  return [road || a.suburb || a.neighbourhood, city, a.country]
    .filter(Boolean).join(', ')
    || String(p.display_name).split(',').slice(0, 4).join(',').trim();
}

function _placeCategory(p) {
  const ex = p.extratags || {};
  const typeText = [p.type, p.class, ex.amenity, ex.tourism, ex.leisure, ex.natural, ex.shop, ex.sport]
    .filter(Boolean).join(' ').toLowerCase();
  for (const [re, cat] of _PLACE_CAT_RULES) if (re.test(typeText)) return cat;
  return 'visite';
}

function _placePrice(p) {
  const ex = p.extratags || {};
  const m = (ex.charge || ex.fee_amount || '').match(/[\d.,]+/);
  return m ? parseFloat(m[0].replace(',', '.')) || null : null;
}

/**
 * Cherche un lieu à partir d'une adresse ou d'un nom, et renvoie plusieurs
 * candidats — « 12 rue de la Paix » existe dans des dizaines de villes, il faut
 * pouvoir choisir plutôt que subir le premier résultat.
 *
 * @param {string} query        adresse ou nom du lieu
 * @param {object} opts         {limit, lat, lon} — lat/lon = centre du voyage
 * @returns {Promise<Array>}    candidats, du plus pertinent au moins pertinent
 */
const _norm = (s) => (s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function _shapeNominatim(p) {
  return {
    id: `n${p.osm_type || 'x'}${p.osm_id || p.place_id}`,
    title: _placeTitle(p),
    address: _placeAddress(p),
    displayName: String(p.display_name || ''),
    category: _placeCategory(p),
    // Une adresse nue (pas de commerce nommé) : il n'y a rien à extraire
    // dessus, mais il y a peut-être un établissement à ce point précis.
    isAddress: !String(p.name || '').trim() || _isHouseNumber(p.name),
    openingHours: (p.extratags || {}).opening_hours || '',
    kind: `${p.class}/${p.type}`,
    generic: ['place', 'highway', 'boundary', 'building', 'landuse'].includes(p.class),
    lat: parseFloat(p.lat),
    lon: parseFloat(p.lon),
    ...(_placePrice(p) ? { price: _placePrice(p) } : {}),
  };
}

// Photon : même fond de carte OpenStreetMap, mais un index de recherche
// approximative. Mesuré : il trouve 25 lieux sur 27 là où Nominatim en trouve
// 24, et surtout il rend des titres d'adresse propres (« 2 Rue du Helder »
// plutôt que « 2 »). En revanche il ne porte ni horaires ni tarifs — d'où son
// rôle de second recours, jamais de premier.
function _shapePhoton(f) {
  const p = f.properties || {};
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const city = p.city || p.town || p.village || p.county;
  return {
    id: `p${p.osm_type || 'x'}${p.osm_id || Math.random()}`,
    title: p.name || street || city || '',
    address: [street || p.district, city, p.country].filter(Boolean).join(', '),
    displayName: [p.name, street, city, p.country].filter(Boolean).join(', '),
    category: _placeCategory({ type: p.osm_value, class: p.osm_key, extratags: {} }),
    isAddress: !p.name,
    openingHours: '',
    kind: `${p.osm_key}/${p.osm_value}`,
    generic: ['place', 'highway', 'boundary', 'building', 'landuse'].includes(p.osm_key),
    lat: f.geometry?.coordinates?.[1],
    lon: f.geometry?.coordinates?.[0],
  };
}

// Départager les candidats. Sans ce tri, on prend le premier venu : une
// recherche « Da Enzo al 29 » ramène alors une rue au Brésil plutôt qu'un
// restaurant à Rome.
function _rank(list, { query = '', lat = null, lon = null } = {}) {
  const wanted = _norm(query);
  return list
    .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .map(r => {
      let s = 0;
      if (r.title) s += 3;
      if (!r.generic) s += 4;
      if (r.openingHours) s += 2;
      const cand = _norm(r.title);
      if (wanted && cand) {
        if (cand.includes(wanted) || wanted.includes(cand)) s += 5;
        else if (wanted.split(' ').some(w => w.length > 3 && cand.includes(w))) s += 2;
      }
      if (lat != null && lon != null) {
        const d = haversineKm(lat, lon, r.lat, r.lon);
        s += d < 1 ? 5 : d < 10 ? 3 : d < 75 ? 1 : d > 500 ? -4 : 0;
      }
      return { ...r, _score: s };
    })
    .sort((a, b) => b._score - a._score);
}

/**
 * Cherche un lieu à partir d'une adresse ou d'un nom, et renvoie plusieurs
 * candidats classés — « 12 rue de la Paix » existe dans des dizaines de villes,
 * il faut pouvoir choisir plutôt que subir le premier résultat.
 *
 * @param {string} query     adresse ou nom du lieu
 * @param {object} opts      {limit, lat, lon} — lat/lon = ancrage du voyage
 * @returns {Promise<Array>} candidats, du plus pertinent au moins pertinent
 */
export async function searchPlaces(query, { limit = 5, lat = null, lon = null } = {}) {
  const q = (query || '').trim();
  if (q.length < 3) return [];

  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}`
    + `&format=json&addressdetails=1&extratags=1&namedetails=1&limit=${limit}`;
  // Biais géographique autour de la destination : une adresse tapée pendant un
  // voyage à Biarritz désigne presque toujours une rue de Biarritz.
  if (lat != null && lon != null) {
    const d = 0.7; // ≈ 75 km
    url += `&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}`;
  }

  let out = [];
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) out = data.map(_shapeNominatim);
    }
  } catch { /* réseau : on tentera Photon */ }

  // Second recours seulement si le premier n'a rien : Nominatim porte les
  // horaires et les tarifs, on ne le remplace pas, on le complète.
  if (!out.length) {
    try {
      let purl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=fr`;
      if (lat != null && lon != null) purl += `&lat=${lat}&lon=${lon}`;
      const res = await fetch(purl);
      if (res.ok) {
        const data = await res.json();
        out = (data?.features || []).map(_shapePhoton).filter(r => r.title);
      }
    } catch { /* les deux ont échoué */ }
  }

  return _rank(out, { query: q, lat, lon }).slice(0, limit);
}

export async function fetchPlaceData(query, { lat = null, lon = null } = {}) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}`
    + `&format=json&addressdetails=1&extratags=1&namedetails=1&limit=5`,
    { headers: { 'Accept-Language': 'fr' } }
  );
  // Nominatim limite à une requête par seconde et répond alors 429 avec un
  // corps qui n'est pas du JSON : sans ce contrôle, `res.json()` lève et
  // l'échec ressort en exception au lieu du `null` que tous les appelants
  // savent déjà traiter. `searchPlaces` et `enrich.js` vérifient déjà `ok`.
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.length) return null;

  // On demande cinq résultats et on garde le meilleur : avec `limit=1` le
  // géocodeur impose son premier choix, qui est souvent une rue ou un immeuble
  // plutôt que l'établissement cherché.
  const ranked = _rank(data.map(_shapeNominatim), { query, lat, lon });
  const winner = ranked[0];
  const p = data.find(x => `n${x.osm_type || 'x'}${x.osm_id || x.place_id}` === winner?.id) || data[0];
  const ex = p.extratags || {};

  const address = _placeAddress(p);
  const category = _placeCategory(p);
  const price = _placePrice(p);

  // Wikipedia thumbnail (preserve the language code)
  let photoUrl = null;
  const wikiRaw = ex.wikipedia || '';
  const wikiLangMatch = wikiRaw.match(/^([a-z]{2}):/);
  const wikiLang = wikiLangMatch?.[1] || 'en';
  const wikiKey = wikiLangMatch ? wikiRaw.slice(wikiLangMatch[0].length) : wikiRaw;
  if (wikiKey) {
    try {
      const wRes = await fetch(
        `https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiKey)}`
      );
      if (wRes.ok) {
        const w = await wRes.json();
        photoUrl = w.thumbnail?.source?.replace(/\/\d+px-/, '/600px-') || null;
      }
    } catch {}
  }

  return {
    // `display_name` manque sur certaines réponses partielles : sans garde,
    // une seule mauvaise réponse fait lever toute la fonction.
    title: (p.name || (p.display_name || '').split(',')[0] || '').trim(),
    address,
    category,
    photoUrl,
    ...(price ? { price } : {}),
    openingHours: ex.opening_hours || '',
    lat: parseFloat(p.lat),
    lon: parseFloat(p.lon),
  };
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Le nom d'un lieu, séparé de son adresse.
 *
 * Une fiche importée s'appelait « Café bel étage, Kärntner Straße 38, 1010
 * Vienna Austria » : trois lignes de titre, suivies de la même adresse répétée
 * juste en dessous. Ce qu'on colle est presque toujours « nom, rue, ville » ;
 * le nom est ce qui précède la première virgule.
 *
 * Prudent par construction — on ne coupe que si le résultat reste un nom
 * plausible et que la suite ressemble bien à une adresse (un chiffre, ou au
 * moins deux segments). « Da Enzo al 29 », sans virgule, sort intact.
 */
export function nomDeLieu(texte) {
  const t = (texte || '').trim();
  const bouts = t.split(',').map(x => x.trim()).filter(Boolean);
  if (bouts.length < 2) return t;
  const nom = bouts[0];
  if (nom.length < 3 || nom.length > 60) return t;
  const suite = bouts.slice(1).join(', ');
  // Une vraie adresse porte un numéro, un code postal, ou au moins deux
  // segments. « Chez Marie, le meilleur » n'en est pas une.
  if (!/\d/.test(suite) && bouts.length < 3) return t;
  return nom;
}

/**
 * L'itinéraire vers un lieu, tel qu'une application de navigation l'attend.
 *
 * **Pas de point de départ.** C'est délibéré : sans `origin`, Maps part de la
 * position réelle *et la recalcule à mesure qu'on marche*. Y injecter les
 * coordonnées relevées au moment du tap fige le départ — trente mètres plus
 * loin, l'itinéraire est déjà faux, et il faut le refaire.
 *
 * Le format `maps/dir/?api=1` est un lien universel : il ouvre l'application
 * Maps installée, sur iPhone comme sur Android, au lieu de passer par le web
 * puis un bandeau « ouvrir dans l'app ».
 *
 * Le mode par défaut est **à pied** : Provo sert surtout des séjours en ville,
 * où l'ancien `directionsmode=driving` proposait de prendre la voiture pour
 * quatre cents mètres. En road trip, le voyage le dit lui-même.
 */
export function lienItineraire(activity, { enVoiture = false } = {}) {
  if (!activity) return null;
  const cible = Number.isFinite(activity.lat) && Number.isFinite(activity.lon)
    ? `${activity.lat},${activity.lon}`
    : (activity.address || '').trim();
  if (!cible) return null;
  return 'https://www.google.com/maps/dir/?api=1'
    + `&destination=${encodeURIComponent(cible)}`
    + `&travelmode=${enVoiture ? 'driving' : 'walking'}`;
}

// ─── Logic alerts ─────────────────────────────────────────
export function getLogicAlerts(activities, slots) {
  const alerts = [];
  const active = activities.filter(a => a.status !== 'nogo');
  const total = totalMinutes(active);

  if (total > 8 * 60) {
    alerts.push({ type: 'overload', icon: '⚠️', message: `Journée surchargée ! (${formatDuration(total)} planifiées)` });
  }

  const hasMeal = active.some(a => a.category === 'resto');
  if (!hasMeal && total >= 180) {
    alerts.push({ type: 'meal', icon: '🍽️', message: 'Aucun repas prévu pour cette longue journée.' });
  }

  const sportMin = active.filter(a => ['sport','balade'].includes(a.category))
    .reduce((s, a) => s + (a.durationHours||0)*60 + (a.durationMinutes||0), 0);
  if (sportMin > 3 * 60) {
    alerts.push({ type: 'effort', icon: '🧘', message: `Grosse journée sportive (${formatDuration(sportMin)}) — pensez à du repos !` });
  }

  if (slots) {
    const fixedActs = active.filter(a => a.fixedStart && slots[a.id]);
    for (let i = 0; i < fixedActs.length; i++) {
      for (let j = i + 1; j < fixedActs.length; j++) {
        const startI = timeToMin(fixedActs[i].fixedStart), endI = timeToMin(slots[fixedActs[i].id].end);
        const startJ = timeToMin(fixedActs[j].fixedStart), endJ = timeToMin(slots[fixedActs[j].id].end);
        if (startI < endJ && startJ < endI) {
          alerts.push({ type: 'conflict', icon: '⚡', message: `Conflit horaire : "${fixedActs[i].title}" et "${fixedActs[j].title}" se chevauchent.` });
        }
      }
    }
  }

  return alerts;
}

// ─── Country → theme color ────────────────────────────────
const COUNTRY_THEMES = {
  japan: '#e63946', japon: '#e63946',
  china: '#c1121f', chine: '#c1121f',
  india: '#f77f00', inde: '#f77f00',
  italy: '#2a9d8f', italie: '#2a9d8f',
  france: '#003049', paris: '#003049',
  spain: '#e63946', espagne: '#e63946',
  greece: '#0077b6', grèce: '#0077b6', grece: '#0077b6',
  morocco: '#e76f51', maroc: '#e76f51',
  egypt: '#f4a261', égypte: '#f4a261', egypte: '#f4a261',
  brazil: '#2d6a4f', brésil: '#2d6a4f', bresil: '#2d6a4f',
  mexico: '#40916c', mexique: '#40916c',
  usa: '#1d3557', 'états-unis': '#1d3557', 'etats-unis': '#1d3557', 'new york': '#1d3557',
  thailand: '#8338ec', thaïlande: '#8338ec', thailande: '#8338ec',
  indonesia: '#c77dff', indonésie: '#c77dff', bali: '#c77dff',
  vietnam: '#d62828', viêt: '#d62828',
  portugal: '#3a0ca3',
  netherlands: '#f48c06', 'pays-bas': '#f48c06', amsterdam: '#f48c06',
  germany: '#606c38', allemagne: '#606c38',
  switzerland: '#e63946', suisse: '#e63946',
  austria: '#780000', autriche: '#780000',
  iceland: '#48cae4', islande: '#48cae4',
  norway: '#023e8a', norvège: '#023e8a',
  sweden: '#0077b6', suède: '#0077b6',
  turkey: '#c1121f', turquie: '#c1121f',
  dubai: '#d4a017', émirats: '#d4a017',
  singapore: '#e63946', singapour: '#e63946',
  kenya: '#2d6a4f',
  peru: '#f4a261', pérou: '#f4a261',
  argentina: '#73d2de', argentine: '#73d2de',
  canada: '#d62828',
  australia: '#f77f00', australie: '#f77f00',
};

export function detectCountryTheme(destination) {
  if (!destination) return null;
  const q = destination.toLowerCase();
  for (const [key, color] of Object.entries(COUNTRY_THEMES)) {
    if (q.includes(key)) return color;
  }
  return null;
}

// ─── Opening hours check ──────────────────────────────────
const DAY_MAP = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0, ph: null };

export function isClosedOnDate(openingHours, dateStr) {
  if (!openingHours) return false;
  try {
    const date = new Date(dateStr + 'T00:00:00');
    const dow = date.getDay(); // 0=Sun, 1=Mon, ...6=Sat
    const raw = openingHours.toLowerCase();
    // Check for "closed" keyword
    if (/\bclosed\b|fermé/i.test(raw)) return true;
    // Parse "Tu-Su 10:00-18:00" or "Mo,We,Fr 09:00-17:00"
    const rules = raw.split(';').map(r => r.trim()).filter(Boolean);
    for (const rule of rules) {
      // Day range like "Mo-Fr" or single "Sa"
      const parts = rule.split(/\s+/);
      const dayPart = parts[0];
      const timePart = parts.slice(1).join('');
      if (!timePart || /off|closed/.test(timePart)) {
        // Check if this day is marked off
        const days = expandDayRange(dayPart);
        if (days.includes(dow)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function expandDayRange(dayPart) {
  const days = [];
  const segments = dayPart.split(',');
  for (const seg of segments) {
    const rangeParts = seg.trim().split('-');
    if (rangeParts.length === 2) {
      const start = DAY_MAP[rangeParts[0].trim()];
      const end = DAY_MAP[rangeParts[1].trim()];
      if (start != null && end != null) {
        // Walk through the range (Mo=1..Su=0 wrapping)
        const order = [1,2,3,4,5,6,0];
        const si = order.indexOf(start);
        const ei = order.indexOf(end);
        if (si <= ei) days.push(...order.slice(si, ei + 1));
        else days.push(...order.slice(si), ...order.slice(0, ei + 1));
      }
    } else {
      const d = DAY_MAP[seg.trim()];
      if (d != null) days.push(d);
    }
  }
  return days;
}

// ─── Site-specific URL parsers ────────────────────────────
function parseBookingUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('booking.com')) {
      // /hotel/country/hotelname.html
      const m = u.pathname.match(/\/hotel\/[a-z]+\/([^./?]+)/);
      if (m) return decodeURIComponent(m[1].replace(/-/g, ' ')).replace(/\b\w/g, c => c.toUpperCase());
    }
    if (u.hostname.includes('tripadvisor')) {
      // /Hotel_Review-...-Hotel_Name-...html  OR  /Attraction_Review-...-Name.html
      const m = u.pathname.match(/(?:Hotel_Review|Attraction_Review|Restaurant_Review)[^-]*(?:-[^-]*){2}-([^-]+(?:-[^-]+)*?)(?:\.|$)/);
      if (m) return m[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    if (u.hostname.includes('thefork') || u.hostname.includes('lafourchette')) {
      // /restaurant/name-id
      const m = u.pathname.match(/\/restaurant\/([^/?#]+)/);
      if (m) {
        const clean = m[1].replace(/-\d+$/, '').replace(/-/g, ' ');
        return clean.replace(/\b\w/g, c => c.toUpperCase());
      }
    }
    if (u.hostname.includes('airbnb')) {
      return 'Airbnb';
    }
  } catch {}
  return null;
}

export function getSiteCategory(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    if (h.includes('booking.com') || h.includes('airbnb') || h.includes('hotels.com')) return 'repos';
    if (h.includes('tripadvisor') || h.includes('viator')) return 'visite';
    if (h.includes('thefork') || h.includes('lafourchette') || h.includes('yelp')) return 'resto';
  } catch {}
  return null;
}

export function nearestNeighborSort(activities) {
  const withGeo = activities.filter(a => a.lat && a.lon && a.status !== 'nogo');
  const other = activities.filter(a => !a.lat || !a.lon || a.status === 'nogo');
  if (withGeo.length <= 1) return activities;
  const result = [withGeo[0]];
  const remaining = withGeo.slice(1);
  while (remaining.length > 0) {
    const last = result[result.length - 1];
    let minDist = Infinity, minIdx = 0;
    remaining.forEach((a, i) => {
      const d = haversineKm(last.lat, last.lon, a.lat, a.lon);
      if (d < minDist) { minDist = d; minIdx = i; }
    });
    result.push(remaining[minIdx]);
    remaining.splice(minIdx, 1);
  }
  return [...result, ...other];
}

/**
 * Le premier lien d'un texte partagé.
 *
 * Les apps ne partagent pas toutes de la même façon : Instagram et TikTok
 * envoient souvent l'URL noyée dans `text` avec une légende autour, Safari la
 * met dans `url`. On accepte les deux et on prend ce qui ressemble à un lien.
 */
export function premierLien(...morceaux) {
  for (const m of morceaux) {
    const t = String(m || '').trim();
    if (!t) continue;
    const trouve = t.match(/https?:\/\/[^\s<>"']+/);
    if (trouve) return trouve[0].replace(/[.,;)\]]+$/, '');
  }
  return null;
}

/**
 * Réduit une image avant de l'envoyer.
 *
 * Une photo d'iPhone fait quatre mégaoctets ; un ticket de caisse se lit très
 * bien à mille pixels de large. En itinérance, c'est la différence entre une
 * seconde et vingt.
 */
export function reduireImage(fichier, largeurMax = 1000, qualite = 0.75) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('lecture impossible'));
    lecteur.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('image illisible'));
      img.onload = () => {
        const ratio = Math.min(1, largeurMax / img.width);
        const l = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
        const c = document.createElement('canvas');
        c.width = l; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, l, h);
        resolve(c.toDataURL('image/jpeg', qualite));
      };
      img.src = ev.target.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}

/**
 * Fait lire une confirmation de réservation collée.
 *
 * Rend ce qui a été lu, jamais une fiche enregistrée : le client remplit le
 * formulaire et l'utilisateur valide. Une date de vol fausse se découvre le
 * jour du départ.
 */
export async function lireReservation(texte) {
  try {
    const { data, error } = await supabase.functions.invoke('read-booking', {
      body: { texte },
    });
    if (error) return { error: 'appel_impossible' };
    return data || { error: 'reponse_vide' };
  } catch {
    return { error: 'hors_ligne' };
  }
}

/**
 * Un texte collé ressemble-t-il à une confirmation plutôt qu'à un nom de lieu ?
 *
 * Le seuil est volontairement haut : « Hôtel Sacher Wien Philharmonikerstraße »
 * doit rester une recherche de lieu. Une confirmation, elle, arrive avec ses
 * dates, ses numéros et ses formules.
 */
export function ressembleAUneReservation(texte) {
  const t = (texte || '').trim();
  if (t.length < 120) return false;
  if (/^https?:\/\//i.test(t)) return false;
  const indices = [
    /r[ée]servation|confirmation|booking|billet|dossier|itin[ée]raire/i,
    /\b\d{1,2}[\/. -](\d{1,2}|janv|f[ée]vr|mars|avr|mai|juin|juil|ao[ûu]t|sept|oct|nov|d[ée]c)/i,
    /\b([01]?\d|2[0-3])[h:][0-5]\d\b/,
    /\b[A-Z0-9]{5,8}\b/,
  ].filter(r => r.test(t)).length;
  return indices >= 2;
}

/**
 * Fait lire un ticket de caisse. Rend ce qui a été lu — jamais une dépense
 * enregistrée : c'est l'utilisateur qui valide, après relecture.
 */
export async function lireRecu(imageDataUrl, surAvancement) {
  // La lecture se fait SUR LE TÉLÉPHONE depuis le passage au tout-gratuit : la
  // photo ne part plus nulle part, et il n'y a plus rien à payer. Le moteur est
  // chargé à la demande — d'où l'import dynamique, qui le garde hors du paquet
  // principal pour tous ceux qui ne photographient jamais de ticket.
  try {
    const { lireTicketImage } = await import('./ocrTicket');
    return await lireTicketImage(imageDataUrl, surAvancement);
  } catch {
    return { error: 'illisible' };
  }
}

// ── Partage d'une dépense ────────────────────────────────────────────────────
// Une dépense se partage à parts ÉGALES par défaut : c'est le cas courant, et
// il ne demande aucune saisie. `parts` ne porte que les exceptions — « Léa
// compte double parce qu'elle partage la chambre », « Tom n'a pas pris le
// menu ». Une dépense sans `parts`, ou dont toutes les parts valent 1, se
// divise donc exactement comme avant : celles déjà enregistrées et celles
// qu'une version antérieure de l'app écrit encore restent justes.
//
// La règle vit ICI et nulle part ailleurs. Elle était écrite trois fois —
// soldes, dettes, feuille par voyageur — et trois copies d'un calcul d'argent
// finissent par ne plus dire la même chose.

/** Les parts effectives, une par participant. Jamais vide, jamais zéro. */
export function partsDeDepense(exp) {
  const ids = exp?.participantIds || [];
  const brut = exp?.parts || {};
  const parts = {};
  for (const id of ids) {
    const v = Number(brut[id]);
    // Une part absente, nulle, négative ou aberrante vaut 1. Dans un carnet de
    // comptes, un partage égal vaut mieux qu'une division par zéro.
    parts[id] = Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 99) : 1;
  }
  return parts;
}

export function totalDesParts(exp) {
  return Object.values(partsDeDepense(exp)).reduce((s, v) => s + v, 0);
}

/** Ce que cette personne doit sur cette dépense, en euros. 0 si elle n'y est pas. */
export function partEnEuros(exp, id) {
  const parts = partsDeDepense(exp);
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  if (!total || !parts[id]) return 0;
  const montant = exp?.eurAmount ?? exp?.amount ?? 0;
  return montant * parts[id] / total;
}

/** Vrai seulement si le partage n'est PAS égal — sert à ne le dire que là. */
export function partageInegal(exp) {
  const v = Object.values(partsDeDepense(exp));
  return v.length > 1 && v.some(x => x !== v[0]);
}

// ── Fusion de deux versions d'un voyage ──────────────────────────────────────
// Un voyage entier tient dans un seul bloc JSON, et il est réécrit EN ENTIER à
// chaque synchronisation. Deux appareils sur le même compte se battaient donc
// pour le dernier mot :
//
//   A ajoute une dépense X  →  écrit { …, X }
//   B ajoute une dépense Y  →  écrit { …, Y }     ← X effacée du serveur
//   Le temps réel renvoie { …, Y } à A            ← X disparaît de son écran
//
// Et à la réception, la version distante REMPLAÇAIT la locale : une saisie pas
// encore synchronisée était écrasée sans trace. C'est de la perte de données,
// pas un défaut d'affichage.
//
// La réponse est une fusion à TROIS voies. On garde la dernière version
// réellement synchronisée (`base`) : elle dit ce que les deux côtés savaient au
// même moment, donc elle distingue « ajouté ici » de « supprimé là-bas » — ce
// qu'une comparaison à deux ne peut pas faire. Sans elle, une fusion
// ressusciterait tout ce que l'autre vient de supprimer.

const AVEC_ID = (v) => Array.isArray(v) && v.every(x => x && typeof x === 'object' && 'id' in x);

/** Une valeur simple : le local ne gagne que s'il a bougé et pas le distant. */
function fusionValeur(base, local, distant) {
  const b = JSON.stringify(base), l = JSON.stringify(local), d = JSON.stringify(distant);
  if (l === d) return distant;
  if (l === b) return distant;   // seul le distant a bougé
  if (d === b) return local;     // seul le local a bougé
  return distant;                // les deux ont bougé : le serveur tranche
}

/** Une liste d'objets identifiés. L'ordre distant d'abord, les ajouts locaux ensuite. */
function fusionListe(base, local, distant) {
  const carte = (l) => new Map((l || []).map(x => [x.id, x]));
  const B = carte(base), L = carte(local), D = carte(distant);
  const sortie = [];
  const vus = new Set();

  const retenir = (id) => {
    if (vus.has(id)) return;
    vus.add(id);
    const b = B.get(id), l = L.get(id), d = D.get(id);
    // Présent des deux côtés : on fusionne champ par champ (une activité
    // renommée ici et déplacée là-bas doit garder les deux changements).
    if (l && d) { sortie.push(fusionObjet(b || {}, l, d)); return; }
    // Absent d'un côté : ajout, ou suppression ? C'est `base` qui tranche.
    if (l && !d) { if (!b) sortie.push(l); return; }   // ajouté ici
    if (d && !l) { if (!b) sortie.push(d); return; }   // ajouté là-bas
  };

  (distant || []).forEach(x => retenir(x.id));
  (local || []).forEach(x => retenir(x.id));
  return sortie;
}

function fusionObjet(base, local, distant) {
  const sortie = {};
  for (const cle of new Set([...Object.keys(local || {}), ...Object.keys(distant || {})])) {
    const b = base?.[cle], l = local?.[cle], d = distant?.[cle];
    if (AVEC_ID(l) && AVEC_ID(d)) sortie[cle] = fusionListe(b, l, d);
    else sortie[cle] = fusionValeur(b, l, d);
  }
  return sortie;
}

/**
 * Le voyage tel qu'il doit être après avoir reçu la version distante.
 * `base` = la dernière version réellement synchronisée. Sans elle, on ne peut
 * pas distinguer un ajout d'une suppression : on se rabat sur le distant, ce
 * qui est l'ancien comportement — pas de régression, pas de miracle non plus.
 */
export function fusionnerVoyages(base, local, distant) {
  if (!local) return distant;
  if (!distant) return local;
  if (!base) return distant;
  return fusionObjet(base, local, distant);
}

/**
 * Retirer un voyageur du voyage — partout, pas seulement de la liste.
 *
 * Les deux chemins de suppression ne filtraient que `tripTravelers`. L'id
 * survivait dans le `participantIds` de chaque dépense, donc sa part
 * continuait d'être comptée dans les soldes et les dettes — et depuis les
 * parts inégales, il pouvait même garder une part double. Le panneau des
 * dettes affichait alors son identifiant technique, faute de nom à mettre.
 *
 * La règle vit ICI et les deux appelants l'utilisent : écrite deux fois, elle
 * finirait par ne plus dire la même chose — c'est déjà arrivé au garde-fou
 * d'origine, puis au filtre d'hôte.
 *
 * Ce qu'on NE fait pas : réattribuer une dépense qu'il a payée. L'argent est
 * sorti de sa poche, et le réécrire silencieusement fabriquerait une dette
 * fausse. La dépense reste à son nom ; c'est l'affichage qui doit savoir dire
 * « voyageur retiré » plutôt qu'un identifiant.
 */
export function voyageSansVoyageur(trip, id) {
  const expenses = (trip?.expenses || []).map(e => {
    const avant = e.participantIds || [];
    if (!avant.includes(id)) return e;
    const restants = avant.filter(x => x !== id);
    const parts = { ...(e.parts || {}) };
    delete parts[id];
    // Plus aucun participant : la dépense retombe sur qui l'a payée — sinon
    // son montant ne serait plus porté par personne et les totaux mentiraient.
    const finaux = restants.length ? restants
      : (e.payerId && e.payerId !== id ? [e.payerId] : []);
    return { ...e, participantIds: finaux, parts };
  });
  return {
    tripTravelers: (trip?.tripTravelers || []).filter(t => t.id !== id),
    expenses,
  };
}

/**
 * Le montant d'une dépense peut être un CALCUL, pas seulement un nombre.
 *
 * « 12,50 + 8 », « 36/3 », « 4×2,5 » : trois personnes au restaurant, une
 * addition partagée, un prix unitaire. Le principe produit dit que l'app
 * calcule et que l'utilisateur lit — sortir la calculatrice du téléphone pour
 * revenir taper le résultat, c'est exactement le contraire.
 *
 * Écrit à la main, jamais avec `eval` ni `new Function` : ce champ reçoit du
 * texte tapé, et un évaluateur générique dans une app qui synchronise le
 * contenu entre appareils est une porte ouverte.
 *
 * Règles :
 *  · virgule ou point, indifféremment — un clavier français donne la virgule ;
 *  · × ÷ − (les signes des boutons) valent * / - ;
 *  · × et ÷ passent avant + et − ;
 *  · un opérateur en attente à la fin est ignoré : « 12+ » vaut 12, pour que
 *    l'aperçu reste juste PENDANT la frappe ;
 *  · tout le reste rend `null` — au minuscule doute, on ne devine pas un
 *    montant.
 *
 * Rend un nombre arrondi au centime, ou `null`.
 */
export function evaluerMontant(texte) {
  if (texte == null) return null;
  // Deux nombres séparés par une espace ne sont pas une opération. Sans cette
  // garde, « 12 8 » — deux montants tapés à la suite, ou « 1 000 » avec son
  // séparateur de milliers — devenait 128 en silence. Entre deviner et
  // demander de retaper, un carnet de comptes demande.
  if (/\d[\s]+\d/.test(String(texte))) return null;
  const brut = String(texte)
    .replace(/\s/g, '')
    .replace(/[×xX]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-');
  if (!brut) return null;

  const jetons = brut.match(/\d+(?:[.,]\d*)?|[+\-*/]/g);
  // Un caractère refusé ne laisse pas de trace dans les jetons : on le repère
  // en recollant. Sans ça, « 12€ » rendrait 12 et « 1o » rendrait 1.
  if (!jetons || jetons.join('') !== brut) return null;
  if (!/\d/.test(jetons[0])) return null;

  const nb = (t) => parseFloat(t.replace(',', '.'));
  // Une pile de termes à additionner : × et ÷ modifient le dernier terme,
  // + et − en empilent un nouveau. Deux priorités, une seule passe.
  const termes = [nb(jetons[0])];
  for (let i = 1; i < jetons.length; i += 2) {
    const op = jetons[i], suite = jetons[i + 1];
    if (suite === undefined) break;            // opérateur en attente
    if (!/[+\-*/]/.test(op) || !/\d/.test(suite)) return null;
    const v = nb(suite);
    if (op === '*') termes[termes.length - 1] *= v;
    else if (op === '/') { if (v === 0) return null; termes[termes.length - 1] /= v; }
    else if (op === '+') termes.push(v);
    else termes.push(-v);
  }
  const somme = termes.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(somme)) return null;
  return Math.round(somme * 100) / 100;
}

/** Vrai si le texte porte un signe de calcul — donc si l'aperçu a un sens. */
export function estUnCalcul(texte) {
  return /[+\-*/×xX÷:−–—]/.test(String(texte ?? ''));
}

/**
 * Un montant écrit au centime près, sans arrondi de confort.
 *
 * `formatPrice` arrondit à l'euro : c'est le bon choix pour lire un budget,
 * mais pas pour un écran où l'on RÉPARTIT — « 33 € · 33 € · 33 € » pour
 * 100 € partagés en trois se lit comme une erreur de calcul, et depuis que le
 * montant peut être une opération, les sommes rondes sont l'exception.
 */
export function formatMontantExact(valeur, devise = 'EUR') {
  if (valeur == null || !Number.isFinite(valeur)) return null;
  // « 19,50 € » et non « 19,5 € » : dès qu'il y a des centimes, on les écrit
  // tous les deux. Un compte rond, lui, reste rond — « 20,00 € » alourdit une
  // colonne pour rien.
  const rond = Number.isInteger(valeur);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: devise,
    minimumFractionDigits: rond ? 0 : 2, maximumFractionDigits: 2,
  }).format(valeur);
}

/**
 * La date d'aujourd'hui telle qu'on la vit, pas telle que Greenwich la voit.
 *
 * `new Date().toISOString().slice(0, 10)` donne la date UTC. À Tokyo, entre
 * minuit et neuf heures du matin, elle annonce la VEILLE : une dépense notée
 * au petit-déjeuner se rangeait au mauvais jour, et le voyageur n'avait aucun
 * moyen de comprendre pourquoi. C'est exactement l'endroit où une app de
 * voyage ne doit pas se tromper — on l'utilise sous d'autres fuseaux par
 * définition.
 *
 * Écrite une fois, ici, et importée partout : la même fonction vivait en privé
 * dans `useTrips`, hors de portée des écrans qui en avaient aussi besoin.
 */
export function dateLocale(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
