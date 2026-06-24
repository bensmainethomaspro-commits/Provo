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

export function budgetStats(activities) {
  const active = activities.filter(a => a.status !== 'nogo');
  const total = active.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const spent = active.filter(a => a.status === 'done').reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  return { total, spent, remaining: total - spent };
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
      const fixedMin = timeToMin(a.fixedStart);
      current = Math.max(current, fixedMin);
      slots[a.id] = { start: minToTime(current), end: minToTime(current + dur), fixed: true };
    } else {
      slots[a.id] = { start: minToTime(current), end: minToTime(current + dur) };
    }
    current += dur;
  }
  return slots;
}

// ─── Category colors ──────────────────────────────────────
export const CATEGORY_COLORS = {
  resto:  '#d4704a',
  visite: '#8b6914',
  balade: '#4a7c59',
  plage:  '#2e86c1',
  sport:  '#c0392b',
  repos:  '#6b5b8a',
  trajet: '#7f8c8d',
  fun:    '#d4ac0d',
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
  // Primary: allorigins.win — follows HTTP redirects, returns final URL in status.url
  try {
    const { signal, clear } = makeAbortSignal(12000);
    const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal });
    clear();
    if (r.ok) {
      const d = await r.json();
      const html = d.contents || '';
      const finalUrl = d.status?.url || '';
      if (html) return { html, finalUrl: finalUrl && finalUrl !== url ? finalUrl : null };
    }
  } catch {}

  // Fallback: corsproxy.io
  try {
    const { signal, clear } = makeAbortSignal(12000);
    const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal });
    clear();
    if (r.ok) {
      const html = await r.text();
      if (html) return { html, finalUrl: null };
    }
  } catch {}

  return { html: '', finalUrl: null };
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
    title: (p.name || p.display_name.split(',')[0]).trim(),
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

  if (/google\.com\/maps|goo\.gl|maps\.app/.test(url)) {
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

  // Prefer reverse geocoding when URL contains coordinates — gives accurate address
  const urlCoords = extractCoordsFromUrl(resolvedUrl) || extractCoordsFromUrl(cleaned);
  if (urlCoords) {
    const revData = await reverseGeocode(urlCoords.lat, urlCoords.lon).catch(() => null);
    if (revData) return { ...revData, title: cleanTitle, link: url };
  }

  const placeData = await fetchPlaceData(placeName).catch(() => null);
  if (placeData) return { ...placeData, title: placeData.title || cleanTitle, link: url };
  return { title: cleanTitle, link: url };
}

export async function resolveShortUrl(url) {
  if (!/goo\.gl|maps\.app/.test(url)) return url;
  const cleaned = cleanGoogleMapsUrl(url);
  const { finalUrl } = await fetchHtmlViaProxy(cleaned);
  return finalUrl || cleaned;
}

export async function fetchPlaceData(query) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&extratags=1&limit=1`
  );
  const data = await res.json();
  if (!data?.length) return null;
  const p = data[0];
  const a = p.address || {};
  const ex = p.extratags || {};

  // Richer address: number + road, city, country — fallback to display_name excerpt
  const road = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.municipality;
  const address = [road || a.suburb || a.neighbourhood, city, a.country]
    .filter(Boolean).join(', ')
    || p.display_name.split(',').slice(0, 4).join(',').trim();

  // Category from ALL available tags (class + type + extratags)
  const typeText = [p.type, p.class, ex.amenity, ex.tourism, ex.leisure, ex.natural, ex.shop, ex.sport]
    .filter(Boolean).join(' ').toLowerCase();
  const catRules = [
    [/restaurant|cafe|coffee|brasserie|bar|pub|fast_food|food_court|bistro|snack|tabac_presse/, 'resto'],
    [/beach|plage|coast|swimming_area|baignade/, 'plage'],
    [/sport|fitness|gym|swimming_pool|stadium|climbing|tennis|golf|ski|surf/, 'sport'],
    [/hotel|hostel|motel|lodge|inn|guesthouse|resort|chalet|accommodation/, 'repos'],
    [/airport|train_station|bus_station|ferry_terminal|metro|subway|tram/, 'trajet'],
    [/park|forest|trail|hiking|viewpoint|peak|waterfall|garden|nature_reserve|bay|lake|river|wood/, 'balade'],
    [/nightclub|casino|cinema|theatre|amusement|theme_park|arcade|entertainment|concert/, 'fun'],
  ];
  let category = 'visite';
  for (const [re, cat] of catRules) {
    if (re.test(typeText)) { category = cat; break; }
  }

  const chargeMatch = (ex.charge || ex.fee_amount || '').match(/[\d.,]+/);
  const price = chargeMatch ? parseFloat(chargeMatch[0].replace(',', '.')) || null : null;

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
    title: (p.name || p.display_name.split(',')[0]).trim(),
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

// ─── Dynamic sky ──────────────────────────────────────────
export function getSkyGradient() {
  const h = new Date().getHours();
  if (h >= 6  && h < 11) return 'linear-gradient(160deg, #7EC8E3 0%, #FFD09B 50%, #FFB4A2 100%)';
  if (h >= 11 && h < 18) return 'linear-gradient(160deg, #FF6B35 0%, #FF8C42 30%, #FFB347 60%, #FFCF56 100%)';
  if (h >= 18 && h < 22) return 'linear-gradient(160deg, #C94B4B 0%, #FF6B35 30%, #FFA07A 60%, #845EC2 100%)';
  return 'linear-gradient(160deg, #0a0a2e 0%, #162447 40%, #1f4068 70%, #1b262c 100%)';
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
