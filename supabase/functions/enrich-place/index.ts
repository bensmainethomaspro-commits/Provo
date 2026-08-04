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
// le site officiel, le télécharge, et confie l'extraction au modèle.
//
// Sans clé Anthropic configurée, elle retombe sur ce qu'OpenStreetMap sait —
// moins riche, mais jamais une erreur silencieuse : la réponse dit toujours
// d'où vient l'information.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

// ── Garde-fou SSRF ───────────────────────────────────────────────────────────
// Cette fonction télécharge une URL qu'elle n'a pas choisie. Sans contrôle,
// elle deviendrait un relais pour atteindre le réseau interne de l'hébergeur.
const PRIVE =
  /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

function urlSure(brut: string): URL | null {
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (PRIVE.test(u.hostname)) return null;
  // Un nom sans point est forcément une machine du réseau local.
  if (!u.hostname.includes(".")) return null;
  return u;
}

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

async function lirePage(url: URL): Promise<{ texte: string; image: string | null } | null> {
  const { signal, clear } = withTimeout(12000);
  try {
    const r = await fetch(url.toString(), {
      signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "fr,en;q=0.8" },
    });
    clear();
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(type)) return null;
    // Une page de 5 Mo n'apporte rien de plus que ses 400 premiers ko.
    const brut = (await r.text()).slice(0, 400_000);
    // L'image se lit AVANT le nettoyage : les balises `meta` disparaissent
    // avec le reste du balisage.
    const image = imageDeLaPage(brut, new URL(r.url || url.toString()));
    const texte = texteLisible(brut);
    return texte.length > 80 ? { texte, image } : (image ? { texte: "", image } : null);
  } catch {
    clear();
    return null;
  }
}

// ── Extraction par le modèle ─────────────────────────────────────────────────
async function extraire(nom: string, texte: string, categorie: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY") ||
    Deno.env.get("ANTHROPIC_API_KEY_TB");
  if (!key) return { indisponible: true };
  const { signal, clear } = withTimeout(20000);
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
        max_tokens: 500,
        system:
          "Tu lis le site d'un lieu et tu en extrais des informations pratiques " +
          "pour un voyageur. Réponds UNIQUEMENT par du JSON compact :\n" +
          '{"horaires":string,"prixMin":number|null,"prixMax":number|null,' +
          '"devise":string,"description":string,"confiance":"haute"|"basse"}\n\n' +
          "horaires = au format OpenStreetMap quand c'est net " +
          '(ex. "Mo-Fr 09:00-18:00; Sa 10:00-16:00"), sinon "".\n' +
          "prixMin / prixMax = fourchette par personne pour une visite ou un " +
          "repas courant, en nombre. null si le site ne permet pas de le dire. " +
          "N'invente JAMAIS un prix : une fourchette fausse coûte de l'argent " +
          "à quelqu'un.\n" +
          "devise = code ISO (EUR, USD…) ou \"\".\n" +
          "description = DEUX phrases maximum, en français, factuelles, qui " +
          "disent ce qu'on y fait et ce qui le distingue. Pas de superlatif " +
          "publicitaire, pas de « incontournable », pas d'emoji. \"\" si la " +
          "page ne dit rien d'utile.\n" +
          "confiance = \"basse\" dès que tu déduis au lieu de lire. Mieux vaut " +
          "des champs vides qu'une information inventée.",
        messages: [{
          role: "user",
          content: `Lieu : ${nom}${categorie ? ` (catégorie ${categorie})` : ""}\n\n` +
            `Contenu du site :\n${texte.slice(0, 9000)}`,
        }],
      }),
    });
    clear();
    if (!r.ok) return { erreur: `modele_${r.status}` };
    const d = await r.json();
    const brut = d?.content?.[0]?.text || "";
    const m = brut.match(/\{[\s\S]*\}/);
    if (!m) return { erreur: "modele_illisible" };
    const p = JSON.parse(m[0]);
    const sur = p.confiance !== "basse";
    const nombre = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
    return {
      horaires: typeof p.horaires === "string" ? p.horaires.trim() : "",
      // Une fourchette devinée est pire que pas de fourchette : elle sera
      // recopiée dans le budget.
      prixMin: sur ? nombre(p.prixMin) : null,
      prixMax: sur ? nombre(p.prixMax) : null,
      devise: typeof p.devise === "string" ? p.devise.trim().slice(0, 4) : "",
      description: sur && typeof p.description === "string"
        ? p.description.trim().slice(0, 400)
        : "",
      confiance: sur ? "haute" : "basse",
    };
  } catch {
    clear();
    return { erreur: "modele_injoignable" };
  }
}

// ── Point d'entrée ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "methode" }, 405);

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

  // Une page sans texte exploitable peut quand même avoir livré sa photo :
  // c'est déjà mieux que rien, et ça évite un appel au modèle pour rien.
  if (page.texte.length < 80) {
    return json({ ...base, photo, source: "site", raison: "texte_illisible" });
  }

  // 3 · L'extraction.
  const lu = await extraire(nom, page.texte, categorie);
  if ("indisponible" in lu) {
    return json({ ...base, photo, source: "osm", raison: "modele_non_configure" });
  }
  if ("erreur" in lu) {
    return json({ ...base, photo, source: "osm", raison: lu.erreur });
  }

  return json({
    ...base,
    photo,
    // Le site prime sur OSM pour les horaires : il est à jour, OSM pas toujours.
    horaires: lu.horaires || base.horaires,
    prixMin: lu.prixMin,
    prixMax: lu.prixMax,
    devise: lu.devise,
    description: lu.description,
    confiance: lu.confiance,
    source: "site",
    modele: true,
  });
});
