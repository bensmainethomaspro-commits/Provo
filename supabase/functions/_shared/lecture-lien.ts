/**
 * Ce qu'un lien dit du lieu, SANS réseau : dans son adresse, ou dans la page
 * déjà téléchargée.
 *
 * Jusqu'ici, tout lien qui n'était ni Google Maps ni TikTok ne donnait que son
 * titre de page, géocodé tel quel. Or la plupart des liens qu'on colle en
 * préparant un voyage à l'étranger portent bien plus :
 *
 *   · un lien Plans (Apple), OpenStreetMap, Waze, Bing ou Yandex porte le nom
 *     et le point dans ses paramètres, sans même ouvrir la page ;
 *   · une page de restaurant, de musée ou d'hôtel publie presque toujours un
 *     bloc JSON-LD (schema.org) : nom exact, adresse postale, coordonnées,
 *     horaires — c'est ce que lisent les moteurs de recherche ;
 *   · quand le site bloque les robots (Tripadvisor, Booking), l'adresse de la
 *     page porte encore le nom : « …-Reviews-Da_Enzo_al_29-Rome_Lazio.html ».
 *
 * Pures et sans réseau pour être vérifiées par `scripts/verif-lecture-lien.mjs`.
 */

export type Point = { lat: number; lon: number };
export type LuDansLeLien = { nom: string | null; coords: Point | null; adresse: string | null };

function point(lat: unknown, lon: unknown): Point | null {
  const a = typeof lat === "number" ? lat : parseFloat(String(lat ?? ""));
  const o = typeof lon === "number" ? lon : parseFloat(String(lon ?? ""));
  if (!Number.isFinite(a) || !Number.isFinite(o)) return null;
  if (Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  // (0, 0) est dans l'océan : c'est une valeur par défaut, pas un lieu.
  if (a === 0 && o === 0) return null;
  return { lat: a, lon: o };
}

/** « 48.85,2.35 » → point. `inverse` pour les services qui écrivent lon,lat. */
function paire(s: string | null, sep: RegExp = /,/, inverse = false): Point | null {
  if (!s) return null;
  const [x, y] = s.split(sep).map((v) => v.trim());
  return inverse ? point(y, x) : point(x, y);
}

const texte = (s: string | null) => {
  const t = (s || "").replace(/\+/g, " ").replace(/\s+/g, " ").trim();
  // Un nom qui n'est qu'une paire de coordonnées n'est pas un nom.
  return t && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(t) ? t : null;
};

/**
 * Les applications de cartes autres que Google, qui décrivent le lieu dans
 * l'adresse même du lien. Rend null pour un lien qui n'en est pas une, ou
 * qui ne porte rien d'exploitable (un lien court à déplier d'abord).
 */
export function lienCarte(u: URL): LuDansLeLien | null {
  const hote = u.hostname.toLowerCase();
  const p = u.searchParams;
  let lu: LuDansLeLien | null = null;

  // Plans (Apple) : maps.apple.com/?q=Nom&ll=lat,lon&address=…
  // et le format récent maps.apple.com/place?coordinate=lat,lon&name=…
  if (/(^|\.)maps\.apple\.com$/.test(hote) || /(^|\.)maps\.apple$/.test(hote)) {
    lu = {
      nom: texte(p.get("name")) || texte(p.get("q")),
      coords: paire(p.get("coordinate")) || paire(p.get("ll")) || paire(p.get("sll")) || paire(p.get("center")),
      adresse: texte(p.get("address")) || texte(p.get("daddr")),
    };
  } else if (/(^|\.)openstreetmap\.(org|fr)$/.test(hote) || /(^|\.)osm\.org$/.test(hote)) {
    // OpenStreetMap : ?mlat=…&mlon=… (marqueur), sinon #map=zoom/lat/lon.
    const hash = u.hash.match(/map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    lu = {
      nom: texte(p.get("query")),
      coords: point(p.get("mlat"), p.get("mlon")) || (hash ? point(hash[1], hash[2]) : null),
      adresse: null,
    };
  } else if (/(^|\.)waze\.com$/.test(hote)) {
    // Waze : /ul?ll=lat,lon&q=Nom ou /live-map/directions?to=ll.lat,lon
    const to = (p.get("to") || "").replace(/^ll\./, "");
    lu = {
      nom: texte(p.get("q")),
      coords: paire(p.get("ll")) || paire(to),
      adresse: null,
    };
  } else if (/(^|\.)bing\.com$/.test(hote) && /\/maps/i.test(u.pathname)) {
    // Bing : ?cp=lat~lon&where1=adresse, ou ?sp=point.lat_lon_Nom
    const sp = (p.get("sp") || "").match(/^point\.(-?[\d.]+)_(-?[\d.]+)_?(.*)$/);
    lu = {
      nom: texte(p.get("q")) || (sp ? texte(decodeURIComponent(sp[3] || "")) : null),
      coords: paire(p.get("cp"), /~/) || (sp ? point(sp[1], sp[2]) : null),
      adresse: texte(p.get("where1")),
    };
  } else if (/(^|\.)yandex\.[a-z.]+$/.test(hote) && /\/maps/i.test(u.pathname)) {
    // Yandex écrit lon,lat — l'inverse de tous les autres.
    lu = {
      nom: texte(p.get("text")),
      coords: paire(p.get("pt"), /,/, true) || paire(p.get("whatshere[point]"), /,/, true)
        || paire(p.get("ll"), /,/, true),
      adresse: null,
    };
  } else if (/(^|\.)mapy\.(cz|com)$/.test(hote)) {
    lu = { nom: texte(p.get("q")), coords: point(p.get("y"), p.get("x")), adresse: null };
  }

  if (!lu || (!lu.nom && !lu.coords && !lu.adresse)) return null;
  return lu;
}

// ── Données structurées (schema.org) ────────────────────────────────────────

const TYPES_LIEU = new RegExp(
  "^(LocalBusiness|Restaurant|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Bakery|Brewery|Winery"
    + "|IceCreamShop|FastFoodRestaurant|Distillery|TouristAttraction|TouristDestination|Place"
    + "|LandmarksOrHistoricalBuildings|Museum|ArtGallery|Hotel|LodgingBusiness|Hostel|Motel|Resort"
    + "|BedAndBreakfast|Campground|Park|Beach|Zoo|Aquarium|AmusementPark|NightClub|MovieTheater"
    + "|PerformingArtsTheater|MusicVenue|StadiumOrArena|SportsActivityLocation|HealthClub|DaySpa"
    + "|Church|PlaceOfWorship|Mosque|Synagogue|HinduTemple|BuddhistTemple|CivicStructure"
    + "|EntertainmentBusiness|ShoppingCenter|Store|TouristInformationCenter|Casino|BowlingAlley"
    + "|SkiResort|GolfCourse|PublicSwimmingPool|Library|Landform|Mountain|BodyOfWater|Event)$",
  "i",
);

const CAT_SCHEMA: [RegExp, string][] = [
  [/restaurant|food|cafe|coffee|bar|pub|bakery|brewery|winery|icecream|distillery/i, "resto"],
  [/hotel|lodging|hostel|motel|resort|bedandbreakfast|campground|spa/i, "repos"],
  [/beach/i, "plage"],
  [/park|landform|mountain|bodyofwater/i, "balade"],
  [/stadium|sports|healthclub|golf|ski|swimming|bowling/i, "sport"],
  [/nightclub|movie|theater|music|amusement|zoo|aquarium|casino|entertainment/i, "fun"],
  [/museum|gallery|landmark|church|worship|mosque|synagogue|temple|attraction|civic|library/i, "visite"],
];

const types = (o: any): string[] =>
  (Array.isArray(o?.["@type"]) ? o["@type"] : [o?.["@type"]]).filter(Boolean).map(String);

/** Tous les objets d'un bloc JSON-LD, graphes et tableaux dépliés. */
function aplatir(o: any, out: any[] = [], prof = 0): any[] {
  if (!o || typeof o !== "object" || prof > 4) return out;
  if (Array.isArray(o)) { for (const x of o) aplatir(x, out, prof + 1); return out; }
  out.push(o);
  if (o["@graph"]) aplatir(o["@graph"], out, prof + 1);
  // Un événement ou une page décrit son lieu dans `location` / `mainEntity`.
  if (o.location) aplatir(o.location, out, prof + 1);
  if (o.mainEntity) aplatir(o.mainEntity, out, prof + 1);
  return out;
}

function adresseDe(a: any): string | null {
  if (!a) return null;
  if (typeof a === "string") return texte(a);
  if (Array.isArray(a)) return adresseDe(a[0]);
  const pays = typeof a.addressCountry === "string" ? a.addressCountry : a.addressCountry?.name;
  const ville = [a.postalCode, a.addressLocality].filter(Boolean).join(" ");
  const t = [a.streetAddress, ville, pays && pays.length > 2 ? pays : null]
    .filter((x) => typeof x === "string" && x.trim()).map((x: string) => x.trim()).join(", ");
  return t || null;
}

function horairesDe(h: any): string | null {
  // `openingHours` de schema.org s'écrit comme celui d'OpenStreetMap
  // (« Mo-Fr 09:00-18:00 ») : il se range tel quel dans la fiche. La forme
  // détaillée (`openingHoursSpecification`) ne l'est pas — on ne la traduit
  // pas, le client complètera.
  if (typeof h === "string") return h.trim() || null;
  if (Array.isArray(h) && h.every((x) => typeof x === "string")) return h.join("; ") || null;
  return null;
}

export type LuDansLaPage = LuDansLeLien & { horaires: string | null; categorie: string | null };

/**
 * Le lieu décrit par la page, d'après ses blocs JSON-LD. Le premier objet
 * d'un type « lieu » l'emporte ; à défaut, un objet qui porte à la fois un nom
 * et une adresse ou des coordonnées.
 */
export function lireJsonLd(html: string): LuDansLaPage | null {
  const blocs = [...(html || "").matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )].slice(0, 12);
  const objets: any[] = [];
  for (const b of blocs) {
    try { aplatir(JSON.parse(b[1].trim()), objets); } catch { /* bloc mal formé : suivant */ }
  }
  const aLieu = (o: any) => types(o).some((t) => TYPES_LIEU.test(t));
  const decrit = (o: any) => typeof o?.name === "string" && (o.address || o.geo);
  const o = objets.find((x) => aLieu(x) && (x.address || x.geo)) || objets.find(decrit)
    || objets.find((x) => aLieu(x) && typeof x.name === "string" && !/^(Event)$/i.test(types(x)[0] || ""));
  if (!o) return null;
  const geo = Array.isArray(o.geo) ? o.geo[0] : o.geo;
  const t = types(o).join(" ");
  const cat = CAT_SCHEMA.find(([re]) => re.test(t))?.[1] || null;
  const lu: LuDansLaPage = {
    nom: typeof o.name === "string" ? texte(decodeEntites(o.name)) : null,
    coords: geo ? point(geo.latitude, geo.longitude) : null,
    adresse: adresseDe(o.address),
    horaires: horairesDe(o.openingHours),
    categorie: cat,
  };
  return lu.nom || lu.coords || lu.adresse ? lu : null;
}

/** Les coordonnées que certaines pages posent en balises meta. */
export function metaGeo(html: string): Point | null {
  const m = (nom: string) => {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${nom}["'][^>]+content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nom}["']`, "i");
    return (html.match(re1) || html.match(re2))?.[1] || null;
  };
  return point(m("place:location:latitude"), m("place:location:longitude"))
    || point(m("og:latitude"), m("og:longitude"))
    || paire(m("ICBM"))
    || paire(m("geo\\.position"), /;/);
}

function decodeEntites(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// ── Titres de page ──────────────────────────────────────────────────────────

/** Une page qui n'est pas la page : captcha, blocage, erreur. */
const TITRE_BLOQUE =
  /^(just a moment|un instant|access denied|acc[eè]s refus[ée]|attention required|are you a (human|robot)|robot or human|verify you are human|security check|captcha|forbidden|40[34]\b|not found|page (not found|introuvable)|error|erreur|pardon our interruption|please wait|one more step)/i;

// Ce qui, dans un titre, parle du site et non du lieu.
const SEGMENT_SITE =
  /tripadvisor|booking\.com|\bbooking\b|thefork|lafourchette|yelp|google|airbnb|expedia|hotels\.com|agoda|opentable|getyourguide|viator|timeout|michelin|foursquare|facebook|instagram|\bavis\b|\breviews?\b|\bmenu\b|\bphotos?\b|phone number|num[ée]ro de t[ée]l[ée]phone|r[ée]serv(er|ation)|book now|official (site|website)|site officiel|accueil|\bhome\b|homepage|tarifs?|prices?|horaires|opening hours|updated \d{4}|mis à jour/i;

/**
 * Le nom du lieu dans un titre de page. « Da Enzo al 29, Rome - Trastevere -
 * Restaurant Reviews, Photos & Phone Number - Tripadvisor » rend
 * « Da Enzo al 29, Rome ». Chaîne vide pour une page de blocage.
 */
export function titreDeSite(brut: string | null): string {
  const t = decodeEntites(String(brut || "")).replace(/\s+/g, " ").trim();
  if (!t || TITRE_BLOQUE.test(t)) return "";
  const segments = t.split(/\s+[-–—|·•:]\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const bon = segments.find((s) => s.length >= 2 && !SEGMENT_SITE.test(s));
  return (bon || "").replace(/^(the\s+)?\d+\s+best\s+/i, "").trim();
}

// ── Le nom écrit dans l'adresse de la page ──────────────────────────────────

const mots = (s: string) =>
  s.replace(/[_+]/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim()
    .replace(/(^|\s)(\p{Ll})/gu, (_, e, c) => e + c.toUpperCase());

/**
 * Quand la page ne se laisse pas lire (captcha, 403), son adresse garde
 * souvent le nom. Seulement pour des sites dont on connaît la forme : lire un
 * nom dans n'importe quelle adresse ramènerait « Index » ou « Fr ».
 */
export function nomDepuisAdresse(u: URL): { nom: string; ville: string | null } | null {
  const hote = u.hostname.toLowerCase();
  const chemin = decodeURIComponent(u.pathname);
  let m: RegExpMatchArray | null;

  if (/(^|\.)tripadvisor\.[a-z.]+$/.test(hote)) {
    // /Restaurant_Review-g187791-d1234-Reviews-Da_Enzo_al_29-Rome_Lazio.html
    m = chemin.match(/-Reviews-(?:or\d+-)?(.+)-([^-/]+)\.html$/);
    if (m) return { nom: mots(m[1]), ville: mots(m[2].split("_")[0]) };
  }
  if (/(^|\.)booking\.com$/.test(hote)) {
    // /hotel/gr/electra-palace-athens.fr.html
    m = chemin.match(/\/hotel\/[a-z]{2}\/([^/.]+)/);
    if (m) return { nom: mots(m[1]), ville: null };
  }
  if (/(^|\.)(thefork|lafourchette)\.[a-z.]+$/.test(hote)) {
    // /restaurant/da-enzo-al-29-r12345
    m = chemin.match(/\/restaurant\/([^/]+?)(?:-r\d+)?\/?$/);
    if (m) return { nom: mots(m[1]), ville: null };
  }
  if (/(^|\.)yelp\.[a-z.]+$/.test(hote)) {
    // /biz/da-enzo-al-29-roma-2
    m = chemin.match(/\/biz\/([^/?]+?)(?:-\d+)?\/?$/);
    if (m) return { nom: mots(m[1]), ville: null };
  }
  return null;
}

// ── Comparer des noms, quelle que soit l'écriture ───────────────────────────

/**
 * Minuscules, sans accents, ponctuation en espaces — mais les lettres grecques,
 * cyrilliques, japonaises ou arabes RESTENT. L'ancienne version ne gardait que
 * a-z : « Ακρόπολη » ou « 金閣寺 » devenaient une chaîne vide, et un nom vide
 * « correspondait » à n'importe quel résultat.
 */
export const normaliser = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Tous les noms sous lesquels OpenStreetMap connaît un lieu. */
export function nomsConnus(p: any): string[] {
  const n = p?.namedetails || {};
  const variantes = Object.entries(n)
    .filter(([k]) => /^(name|int_name|alt_name|official_name|old_name|short_name|loc_name)(:|$)/.test(k))
    .map(([, v]) => String(v));
  return [p?.name, ...variantes].filter(Boolean).map(String);
}

/**
 * Le résultat porte-t-il le nom cherché ? Fort : l'un contient l'autre.
 * Faible : un mot significatif en commun. Rien sinon.
 */
export function accordNom(voulu: string, noms: string[]): "fort" | "faible" | null {
  const w = normaliser(voulu);
  if (!w) return null;
  const motsVoulus = w.split(" ").filter((x) => x.length > 3);
  let faible = false;
  for (const n of noms) {
    const c = normaliser(n);
    if (!c) continue;
    // Un nom de deux lettres (« Bo ») serait « contenu » dans n'importe quoi.
    // Sauf en chinois, japonais ou coréen, où trois signes font déjà un nom.
    const assezLong = c.length >= 4 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c);
    if (c.includes(w) || (assezLong && w.includes(c))) return "fort";
    if (motsVoulus.some((x) => c.includes(x))) faible = true;
  }
  return faible ? "faible" : null;
}
