// Provo — « enrich-place »
//
// Va chercher sur le site du lieu ce qu'aucune base ouverte ne donne : les
// horaires réels, une gamme de prix, une description en français.
//
// OpenStreetMap connaît bien les monuments, mal les commerces : un café aura
// rarement ses horaires et jamais son ticket moyen. Or c'est exactement ce
// qu'on veut savoir avant d'y aller. Le site de l'établissement, lui, le dit.
//
// Le navigateur ne peut pas le lire (CORS), d'où cette fonction. Elle trouve
// le site officiel, le télécharge, et lit ce qu'il DÉCLARE : le JSON-LD de
// schema.org, que tout établissement publie déjà pour Google. Horaires,
// fourchette de prix, téléphone, description : c'est du balisage fait pour
// être lu par une machine.
//
// Elle a appelé un modèle payant pendant trois semaines pour lire la même
// chose en langue naturelle. Sur ces champs-là, les données structurées sont
// plus sûres — on recopie ce que le lieu affirme au lieu de le déduire — et
// elles ne coûtent rien.
//
// Quand la page ne déclare rien, la réponse retombe sur ce qu'OpenStreetMap
// sait, et dit toujours d'où vient l'information.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { PRIVE, urlSure } from "../_shared/reseau.ts";
import { origineAutorisee } from "../_shared/origine.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UA = "Provo-Travel-App/1.0 (place enricher)";
const OVERPASS = "https://overpass-api.de/api/interpreter";

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

// Le filtre d'hôte vit dans `_shared/reseau.ts` : écrit ici seul, il n'avait
// pas suivi `extract-place`, qui récupère aussi des URL fournies.

// ── Le site officiel, via OpenStreetMap ──────────────────────────────────────
async function siteDepuisOsm(nom: string, lat: number, lon: number) {
  if (!nom || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const propre = nom.replace(/["\\]/g, " ").replace(/[.*+?^${}()|[\]]/g, ".");
  const q =
    `[out:json][timeout:20];nwr["name"~"${propre}",i](around:800,${lat},${lon});out tags 3;`;
  const { signal, clear } = withTimeout(15000);
  try {
    const r = await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`, {
      signal,
      headers: { "User-Agent": UA },
    });
    clear();
    if (!r.ok) return null;
    const d = await r.json();
    for (const el of d?.elements || []) {
      const t = el.tags || {};
      const site = t.website || t["contact:website"] || t.url;
      if (site || t.opening_hours) {
        return {
          site: site || "",
          horaires: t.opening_hours || "",
          telephone: t.phone || t["contact:phone"] || "",
        };
      }
    }
    return null;
  } catch {
    clear();
    return null;
  }
}

// ── Lecture de la page ───────────────────────────────────────────────────────
function texteLisible(html: string): string {
  return html
    // Le contenu utile n'est jamais dans ces balises, et leur volume noierait
    // la page dans du bruit.
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&(quot|#34);/g, '"')
    .replace(/&(#39|apos);/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * L'image que l'établissement a choisie pour se représenter.
 *
 * Une vignette Wikipédia donne l'immeuble, parfois rien du tout — inutilisable
 * pour un café. `og:image` est la photo que le lieu met en avant lui-même :
 * c'est la seule source fiable à cette échelle.
 */
function imageDeLaPage(html: string, base: URL): string | null {
  const balises = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of balises) {
    const m = re.exec(html);
    if (!m) continue;
    try {
      // Les sites donnent souvent un chemin relatif.
      const u = new URL(m[1].trim(), base);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (PRIVE.test(u.hostname)) continue;
      // Un pixel de suivi ou un logo minuscule ne représente pas le lieu.
      if (/(1x1|pixel|spacer|blank)\.(gif|png)$/i.test(u.pathname)) continue;
      return u.toString();
    } catch { /* URL illisible : on essaie la balise suivante */ }
  }
  return null;
}

const REDIRECTIONS = new Set([301, 302, 303, 307, 308]);
const SAUTS_MAX = 5;

/**
 * Suivre les redirections À LA MAIN, en repassant chaque saut par `urlSure`.
 *
 * `redirect: "follow"` ne validait que l'URL de départ : une adresse publique
 * qui renvoie vers `http://169.254.169.254` faisait traverser le garde-fou à
 * l'arrivée. Le contrôle doit porter sur chaque saut, pas sur le premier.
 *
 * CE QUE ÇA NE COUVRE PAS : un nom d'hôte public qui *résout* vers une adresse
 * interne (réattribution DNS). Le filtre lit le nom, pas l'adresse résolue —
 * et Deno ne donne pas la main entre la résolution et la connexion. Le dire
 * plutôt que de croire la porte fermée.
 */
async function suivreRedirections(
  depart: URL, signal: AbortSignal,
): Promise<{ reponse: Response; urlFinale: URL } | null> {
  let courante = depart;
  for (let saut = 0; saut <= SAUTS_MAX; saut++) {
    const r = await fetch(courante.toString(), {
      signal,
      redirect: "manual",
      headers: { "User-Agent": UA, "Accept-Language": "fr,en;q=0.8" },
    });
    if (!REDIRECTIONS.has(r.status)) return { reponse: r, urlFinale: courante };
    // Le corps d'une réponse de redirection ne sert à rien, mais le laisser
    // ouvert retient la connexion.
    await r.body?.cancel().catch(() => {});
    const cible = r.headers.get("location");
    if (!cible) return null;
    // Une `Location` a le droit d'être relative : la résoudre avant de la
    // juger, sinon `urlSure` refuserait une redirection parfaitement normale.
    let resolue: string;
    try {
      resolue = new URL(cible, courante).toString();
    } catch {
      return null;
    }
    const sure = urlSure(resolue);
    if (!sure) return null;
    courante = sure;
  }
  // Plus de sauts que permis : une boucle, ou quelqu'un qui joue.
  return null;
}

async function lirePage(url: URL): Promise<{ texte: string; brut: string; image: string | null } | null> {
  const { signal, clear } = withTimeout(12000);
  try {
    const suivi = await suivreRedirections(url, signal);
    clear();
    if (!suivi) return null;
    const { reponse: r, urlFinale } = suivi;
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(type)) return null;
    // Une page de 5 Mo n'apporte rien de plus que ses 400 premiers ko.
    const brut = (await r.text()).slice(0, 400_000);
    // L'image se lit AVANT le nettoyage : les balises `meta` disparaissent
    // avec le reste du balisage. Elle se résout sur l'URL d'ARRIVÉE : depuis
    // qu'on suit les sauts nous-mêmes, `r.url` porte l'URL demandée, pas la
    // dernière — une image relative s'y résoudrait sur le mauvais domaine.
    const image = imageDeLaPage(brut, urlFinale);
    const texte = texteLisible(brut);
    // Le HTML brut repart avec : les données structurées (JSON-LD) vivent dans
    // un `<script>`, que `texteLisible` retire précisément parce qu'il ne
    // cherche que de la prose.
    return texte.length > 80 || image ? { texte, brut, image } : null;
  } catch {
    clear();
    return null;
  }
}

// ── Extraction sans modèle, à partir des données structurées ─────────────────
//
// Ce bloc remplace un appel au modèle payant. Il ne lit pas la page « comme un
// humain » : il lit ce que le site DÉCLARE, dans le format que tout le monde
// publie déjà pour Google — le JSON-LD de schema.org. Un restaurant, un hôtel
// ou un musée y met ses horaires, sa fourchette de prix, son téléphone et sa
// description, sous une forme faite pour être lue par une machine.
//
// C'est gratuit, c'est instantané, et sur ce qui nous intéresse c'est PLUS SÛR
// qu'une lecture en langue naturelle : on ne déduit rien, on recopie ce que le
// lieu affirme de lui-même. Quand la page ne déclare rien, on rend des champs
// vides — jamais une déduction.
//
// Vérifié par `scripts/verif-fiche.mjs`, sur des pages réelles.

const JOURS: Record<string, string> = {
  monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th",
  friday: "Fr", saturday: "Sa", sunday: "Su",
  lundi: "Mo", mardi: "Tu", mercredi: "We", jeudi: "Th",
  vendredi: "Fr", samedi: "Sa", dimanche: "Su",
  mo: "Mo", tu: "Tu", we: "We", th: "Th", fr: "Fr", sa: "Sa", su: "Su",
};

/** « https://schema.org/Monday », « Lundi », « Mo » → « Mo ». */
function jourOsm(brut: unknown): string {
  const t = String(brut || "").split("/").pop()!.trim().toLowerCase();
  return JOURS[t] || "";
}

const heure = (v: unknown) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};

/**
 * `openingHoursSpecification` → le format d'OpenStreetMap.
 *
 * On garde celui d'OSM parce que c'est déjà celui que l'app sait lire :
 * `ouvertMaintenant()` s'en sert pour dire « Ouvert » sur une fiche de la
 * Réserve. Deux formats d'horaires dans le produit, ce serait deux lecteurs.
 */
function horairesDepuisSpec(spec: unknown): string {
  const liste = Array.isArray(spec) ? spec : [spec];
  const parJour: string[] = [];
  for (const s of liste) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const ouvre = heure(o.opens), ferme = heure(o.closes);
    if (!ouvre || !ferme) continue;
    const jours = (Array.isArray(o.dayOfWeek) ? o.dayOfWeek : [o.dayOfWeek])
      .map(jourOsm).filter(Boolean);
    if (!jours.length) continue;
    parJour.push(`${jours.join(",")} ${ouvre}-${ferme}`);
  }
  return parJour.join("; ");
}

/**
 * Une fourchette de prix, et SEULEMENT quand elle est chiffrée.
 *
 * `priceRange` vaut très souvent « €€ » : c'est une catégorie de prix, pas un
 * prix. La convertir en euros serait l'inventer — et une fourchette inventée
 * se recopie dans le budget de quelqu'un. On ne rend que ce qui porte des
 * chiffres.
 */
function fourchette(brut: unknown): { prixMin: number | null; prixMax: number | null; devise: string } {
  const t = String(brut || "");
  const devise = /€|EUR/i.test(t) ? "EUR" : /\$|USD/i.test(t) ? "USD"
    : /£|GBP/i.test(t) ? "GBP" : "";
  const nombres = (t.match(/\d+(?:[.,]\d+)?/g) || [])
    .map((n) => parseFloat(n.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n >= 0 && n < 100000);
  if (!nombres.length) return { prixMin: null, prixMax: null, devise };
  return {
    prixMin: Math.min(...nombres),
    prixMax: nombres.length > 1 ? Math.max(...nombres) : null,
    devise,
  };
}

/** Tous les objets JSON-LD de la page, à plat — ils s'imbriquent souvent. */
function objetsJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const blocs = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const empiler = (v: unknown, profondeur = 0) => {
    if (profondeur > 4 || !v) return;
    if (Array.isArray(v)) { v.forEach((x) => empiler(x, profondeur + 1)); return; }
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    out.push(o);
    // `@graph` est la façon normale d'empaqueter plusieurs entités.
    empiler(o["@graph"], profondeur + 1);
  };
  for (const b of blocs) {
    try { empiler(JSON.parse(b[1].trim())); } catch { /* un site sur dix écrit du JSON cassé */ }
    if (out.length > 40) break;
  }
  return out;
}

const texteDe = (v: unknown): string =>
  typeof v === "string" ? v.trim()
    : Array.isArray(v) ? v.map(texteDe).filter(Boolean).join("; ")
    : "";

/**
 * Ce que le site déclare de lui-même : horaires, prix, description, téléphone.
 *
 * Rendu vide plutôt que faux : c'est la règle de tout cet écran. Une fiche
 * incomplète se complète plus tard ; une fiche fausse se découvre devant une
 * porte fermée.
 */
function lireLesDonnees(html: string) {
  let horaires = "", description = "", telephone = "";
  let prix = { prixMin: null as number | null, prixMax: null as number | null, devise: "" };

  for (const o of objetsJsonLd(html)) {
    if (!horaires) {
      horaires = horairesDepuisSpec(o.openingHoursSpecification)
        || texteDe(o.openingHours);
    }
    if (prix.prixMin === null && o.priceRange !== undefined) {
      prix = fourchette(o.priceRange);
    }
    if (!description) {
      const d = texteDe(o.description);
      // Deux phrases suffisent : au-delà, c'est la page « à propos » entière.
      if (d.length > 20) description = d.slice(0, 400);
    }
    if (!telephone) telephone = texteDe(o.telephone).slice(0, 30);
  }

  // Rien de structuré : la description sociale reste honnête — c'est le site
  // qui l'écrit pour se présenter, et elle tient en une phrase.
  if (!description) {
    const m = html.match(
      /<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{20,400})["']/i);
    if (m) description = texteLisible(m[1]);
  }

  const trouve = Boolean(horaires || description || telephone || prix.prixMin !== null);
  return {
    horaires: horaires.slice(0, 200),
    description,
    telephone,
    ...prix,
    // « haute » quand ça vient des données structurées, « basse » quand il n'y
    // a qu'une description marketing.
    confiance: horaires || prix.prixMin !== null ? "haute" : "basse",
    trouve,
  };
}

// ── Point d'entrée ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "methode" }, 405);
  // Cette fonction ne coûte plus rien depuis qu'elle lit les données
  // structurées au lieu d'appeler un modèle — mais elle télécharge toujours
  // une page choisie par l'appelant. Le contrôle d'origine reste : ce n'est
  // plus le crédit qu'il protège, c'est la bande passante et la réputation de
  // l'hébergeur, qui joindrait n'importe quel site pour n'importe qui.
  if (!origineAutorisee(req)) return json({ erreur: "origine_refusee" }, 403);

  let corps: Record<string, unknown>;
  try {
    corps = await req.json();
  } catch {
    return json({ erreur: "json" }, 400);
  }

  const nom = String(corps.name || "").trim();
  const lat = Number(corps.lat);
  const lon = Number(corps.lon);
  const categorie = String(corps.category || "").trim();
  if (nom.length < 2) return json({ erreur: "nom_manquant" }, 400);

  // 1 · Le site officiel : celui fourni s'il y en a un, sinon celui d'OSM.
  const osm = await siteDepuisOsm(nom, lat, lon);
  const candidat = String(corps.website || "") || osm?.site || "";
  const url = candidat ? urlSure(candidat) : null;

  const base = {
    // Ce qu'OSM sait, systématiquement renvoyé : c'est le filet quand le site
    // est injoignable ou qu'aucune clé n'est configurée.
    horaires: osm?.horaires || "",
    telephone: osm?.telephone || "",
    site: url ? url.toString() : "",
  };

  if (!url) return json({ ...base, source: osm ? "osm" : "aucune", raison: "pas_de_site" });

  // 2 · La page.
  const page = await lirePage(url);
  if (!page) return json({ ...base, source: osm ? "osm" : "aucune", raison: "site_illisible" });
  const photo = page.image || "";

  // 3 · L'extraction, sur ce que le site DÉCLARE. Rien n'est déduit, donc rien
  //     n'est facturé : c'est du JSON publié pour Google, on le lit.
  const lu = lireLesDonnees(page.brut);
  if (!lu.trouve) {
    return json({ ...base, photo, source: osm ? "osm" : "site", raison: "site_muet" });
  }

  return json({
    ...base,
    photo,
    // Le site prime sur OSM pour les horaires : il est à jour, OSM pas toujours.
    horaires: lu.horaires || base.horaires,
    telephone: lu.telephone || base.telephone,
    prixMin: lu.prixMin,
    prixMax: lu.prixMax,
    devise: lu.devise,
    description: lu.description,
    confiance: lu.confiance,
    source: "site",
  });
});
