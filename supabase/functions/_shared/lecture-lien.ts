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

// ── Un lieu qui n'est pas là où se passe le voyage ──────────────────────────

/** Ce qu'il faut d'un résultat de géocodeur pour juger s'il est « le » lieu. */
export type Trouve = {
  noms: string[];
  lat: number;
  lon: number;
  /** Une commune, une frontière, une rue : ce n'est pas un établissement. */
  generique?: boolean;
  /** La voie du résultat, pour reconnaître une adresse. */
  voie?: string;
  /** Code postal et commune du résultat : ce qui situe une adresse sans ambiguïté. */
  reperes?: string[];
};

function kmEntre(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Ce qu'on cherche ne désigne-t-il qu'UN endroit parmi ces résultats ?
 *
 * La destination du voyage sert à départager des homonymes. Elle servait aussi
 * de frontière : hors du pays ou du rayon de la destination, un lieu n'était
 * pas cherché du tout. Un lien de partage Google vers un restaurant de Rome,
 * collé dans un voyage à Biarritz, ressortait donc en fiche nue — et l'app
 * annonçait que ce lieu n'était « pas répertorié dans la carte ouverte », alors
 * qu'elle ne l'avait cherché qu'en France (11 novembre 2026).
 *
 * Quand rien ne porte ce nom près du voyage, on regarde donc ailleurs. Mais la
 * proximité était le garde-fou contre les homonymes ; sans elle, il en faut
 * d'autres, et ils sont ici :
 *   · le résultat doit porter le nom ENTIER — pas un mot en commun, et pas un
 *     nom de sept lettres perdu dans une phrase de cinquante ;
 *   · un nom trop court ne prouve rien ;
 *   · et il ne doit y en avoir qu'UN : deux « Café Central » à 600 km l'un de
 *     l'autre, c'est à la personne de dire lequel, pas à nous.
 * Une adresse se reconnaît autrement : sa voie ET son code postal (ou sa
 * commune) doivent être écrits dans ce qu'on cherche.
 *
 * Rend `lieux` : les résultats qui désignent ce lieu unique — le même commerce
 * ressort souvent deux fois, en point et en bâtiment. Vide quand rien ne porte
 * le nom, et vide aussi quand c'est `ambigu` ; `portent` garde alors les
 * homonymes, pour qui peut les donner à choisir (le téléphone, pas le serveur).
 */
export function seulDeSonNom<T extends Trouve>(
  voulu: string,
  liste: T[],
  // Un commerce rendu en point ET en bâtiment tient dans quelques dizaines de
  // mètres. Deux adresses d'une même enseigne dans la même ville, non : à
  // 30 km de tolérance, la première était prise sans rien demander.
  memeLieuKm = 0.3,
): { lieux: T[]; ambigu: boolean; portent: T[] } {
  const w = normaliser(voulu);
  if (w.length < 5) return { lieux: [], ambigu: false, portent: [] };

  const leNomEntier = (t: Trouve) => !t.generique && t.noms.some((n) => {
    const c = normaliser(n);
    if (!c || !(c.includes(w) || w.includes(c))) return false;
    // L'un contient l'autre, ET le plus court fait au moins la moitié du plus
    // long : « Da Enzo al 29, Rome » désigne « Da Enzo al 29 », mais « Hofburg
    // Imperial Palace - 1st District, Innere Stadt » ne désigne pas un cinéma
    // « Palace » trouvé à l'autre bout du monde.
    return Math.min(c.length, w.length) * 2 >= Math.max(c.length, w.length);
  });
  const dedans = (s: string | undefined) => {
    const c = normaliser(s || "");
    return c.length >= 4 && w.includes(c);
  };
  const uneAdresse = /\d/.test(w);
  const sonAdresse = (t: Trouve) => uneAdresse && dedans(t.voie) && (t.reperes || []).some(dedans);

  const retenus = liste.filter((t) =>
    Number.isFinite(t.lat) && Number.isFinite(t.lon) && (leNomEntier(t) || sonAdresse(t)));
  if (!retenus.length) return { lieux: [], ambigu: false, portent: [] };
  const ambigu = retenus.some((t) => kmEntre(retenus[0], t) > memeLieuKm);
  return { lieux: ambigu ? [] : retenus, ambigu, portent: retenus };
}

// ── Ce que Google sert aux robots de messagerie ─────────────────────────────
//
// Une page Google exige JavaScript : téléchargée par un serveur, elle ne porte
// ni nom, ni adresse, ni point (mesuré le 11 novembre 2026, 93 ko de coquille).
// Mais Google sert AUSSI une page d'aperçu aux robots qui déplient les liens
// dans les messageries — quelques balises `og:`, faites pour être lues par une
// machine. C'est de première main, et c'est tout ce qu'un serveur peut lire
// d'un lien de partage sans exécuter la page.

const SEPARE = /\s+[·•‧∙�]\s+/;
const propre = (s: string) => decodeEntites(s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/\s+/g, " ").trim();

function balise(html: string, prop: string): string {
  const a = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i");
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${prop}["']`, "i");
  return propre((html.match(a) || html.match(b))?.[1] || "");
}

export type ApercuGoogle = {
  nom: string;
  /** « Rome, Metropolitan City of Rome Capital, Italie » : où Google situe le lieu. */
  localite: string | null;
  /** « Restaurant », « Musée d'art »… : ce que Google dit que c'est. */
  genre: string | null;
};

/**
 * L'aperçu d'un lien de partage Google (`share.google`) :
 *   og:title        « ADEVA Cucina Moderna · Rome, Metropolitan City of Rome Capital, Italie »
 *   og:description  « 4.8 ⭐ · Restaurant »
 *
 * Le lien dit donc lui-même OÙ est le lieu. C'est ce qui manquait : faute de
 * le savoir, on situait la recherche sur la destination du voyage, et un
 * restaurant de Rome collé dans un voyage à Biarritz n'était cherché qu'en
 * France.
 */
export function lireApercuGoogle(html: string): ApercuGoogle | null {
  const titre = balise(html, "og:title") || balise(html, "twitter:title");
  if (!titre || /^google(\s+(maps|search))?$|recherche google$/i.test(titre)) return null;
  const [nom, ...suite] = titre.split(SEPARE);
  if (!nom || nom.length < 2) return null;
  const morceaux = (balise(html, "og:description") || balise(html, "description")).split(SEPARE)
    // « 4.8 ⭐ », « ★★★★★ », « (2 k) » : la note n'est pas un genre.
    .map((m) => m.trim()).filter((m) => m && !/^[\d.,\s]*[⭐★☆]|^\(?[\d\s.,k]+\)?$/i.test(m));
  return {
    nom: nom.trim(),
    localite: suite.join(", ").trim() || null,
    genre: morceaux[morceaux.length - 1] || null,
  };
}

/**
 * « Rome, Metropolitan City of Rome Capital, Italie » → « Rome, Italie ».
 * La commune et le pays suffisent à un géocodeur ; la région administrative,
 * écrite dans une langue et la commune dans une autre, le perd.
 */
export function communeEtPays(localite: string | null): string {
  const bouts = String(localite || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (bouts.length <= 2) return bouts.join(", ");
  return `${bouts[0]}, ${bouts[bouts.length - 1]}`;
}

/**
 * Le point qu'une page Google Maps montre à un robot de messagerie, quand la
 * recherche désigne UN lieu.
 *
 * La vignette d'aperçu (`og:image`) est une carte statique. Mesuré sur dix
 * recherches le 11 novembre 2026 :
 *   · un lieu précis : 900×900, zoom 17, centrée sur lui, aucune épingle —
 *     « Vienna state opera », « Palais du Belvedere Vienne », et même un
 *     restaurant d'Athènes que la carte ouverte ne connaît pas ;
 *   · plusieurs résultats, ou aucun : 200×200, zoom large, des épingles, et
 *     le titre de la page redevient la recherche elle-même.
 * On ne rend le point que dans le premier cas : le centre d'une liste de
 * résultats n'est l'adresse de personne.
 */
export function lirePointMaps(html: string): Point | null {
  const image = balise(html, "og:image");
  if (!/staticmap/i.test(image) || /[?&]markers=/i.test(image)) return null;
  const centre = image.match(/[?&]center=(-?\d{1,3}(?:\.\d+)?)(?:%2C|,)(-?\d{1,3}(?:\.\d+)?)/i);
  const zoom = Number((image.match(/[?&]zoom=(\d+)/i) || [])[1]);
  if (!centre || !(zoom >= 15)) return null;
  return point(centre[1], centre[2]);
}

// Du plus précis au plus vague : « parc d'attractions » avant « parc ».
const GENRES: [RegExp, string][] = [
  [/parc d attractions|theme park|amusement|zoo|aquarium|bowling|casino|discotheque|night ?club|karaoke|escape|cinema|theatre|theater|opera|salle de concert|concert hall/, "fun"],
  [/restaurant|pizzeria|trattoria|osteria|bistro|brasserie|cafe|coffee|\bbar\b|\bpub\b|boulangerie|bakery|patisserie|glacier|ice cream|creperie|salon de the|tea room|traiteur|sushi|burger|tapas|taverne|tavern|steak|grill|food|diner|cantine|brunch/, "resto"],
  [/plage|beach/, "plage"],
  [/hotel|hostel|auberge|\bspa\b|chambre d hotes|lodge|camping|resort|guest ?house|bed and breakfast/, "repos"],
  [/salle de sport|\bgym\b|fitness|stade|stadium|piscine|swimming|escalade|climbing|surf|\bski\b|golf|tennis|sports?\b/, "sport"],
  [/\bgare\b|aeroport|airport|station de metro|subway|parking|terminal|ferry/, "trajet"],
  [/\bparc\b|\bpark\b|jardin|garden|foret|forest|sentier|trail|randonnee|hiking|point de vue|viewpoint|\blac\b|\blake\b|montagne|mountain|cascade|waterfall|reserve naturelle|nature/, "balade"],
  [/musee|museum|museo|monument|chateau|castle|eglise|church|cathedrale|cathedral|basilique|temple|mosquee|synagogue|galerie|gallery|palais|palace|historique|historic|attraction|site touristique|landmark|memorial|ruines|ruins/, "visite"],
];

/** « Restaurant italien », « Musée d'art » → la catégorie de l'app. Null si rien ne le dit. */
export function categorieDuGenre(genre: string | null): string | null {
  const g = normaliser(genre || "");
  if (!g) return null;
  return GENRES.find(([re]) => re.test(g))?.[1] || null;
}

// Les adresses par lesquelles on TROUVE un lieu, et qui ne sont pas son site.
const DE_PASSAGE = [
  /(^|\.)google\.[a-z.]+$/, /(^|\.)goo\.gl$/, /(^|\.)share\.google$/, /^g\.co$/,
  /(^|\.)maps\.apple\.com$/, /(^|\.)waze\.com$/, /(^|\.)openstreetmap\.org$/, /(^|\.)osm\.org$/,
  /(^|\.)tiktok\.com$/, /(^|\.)instagram\.com$/, /(^|\.)facebook\.com$/, /(^|\.)fb\.(com|me|watch)$/,
  /(^|\.)youtube\.com$/, /^youtu\.be$/, /(^|\.)twitter\.com$/, /^x\.com$/, /^t\.co$/,
  /(^|\.)pinterest\.[a-z.]+$/, /^pin\.it$/, /(^|\.)snapchat\.com$/, /(^|\.)threads\.(net|com)$/,
];

/**
 * Ce lien est-il la façon dont on a trouvé le lieu, plutôt que son site ?
 *
 * Une fiche importée garde son lien d'origine — un partage Google, une vidéo
 * TikTok. La recherche du site officiel le recevait comme « le site du lieu »
 * et s'arrêtait là : elle téléchargeait une page Google au lieu d'aller lire
 * le vrai site, que la carte ouverte connaît (11 novembre 2026).
 */
export function lienDePassage(brut: string): boolean {
  let hote = "";
  try {
    hote = new URL(brut).hostname.toLowerCase();
  } catch {
    return false;
  }
  return DE_PASSAGE.some((re) => re.test(hote));
}
