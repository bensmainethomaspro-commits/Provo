// JobWatch — "jobwatch-fetch" Edge Function
//
// Collecte les offres d'emploi depuis toutes les sources configurées,
// les déduplique dans jobwatch_jobs, puis calcule un score d'adéquation
// par utilisateur dans jobwatch_matches.
//
// Sources :
//   · Welcome to the Jungle — API de recherche Algolia publique (celle
//     qu'utilise leur propre frontend). Fiable tant que WTTJ ne fait pas
//     tourner ses clés publiques (surchargables via env).
//   · LinkedIn — endpoint "invité" (recherche sans connexion). BEST EFFORT :
//     LinkedIn bloque activement les bots (HTTP 429/999) ; quand ça casse,
//     la source est marquée en erreur et le reste continue.
//   · Pages carrières — API JSON publiques des ATS Greenhouse, Lever et
//     Recruitee pour les entreprises cibles de l'utilisateur.
//
// Appelée par le cron du matin (header x-cron-secret) ou depuis l'app
// (bouton "Actualiser", JWT utilisateur). Déployer avec --no-verify-jwt.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  authorize,
  CORS,
  json,
  type JobRow,
  norm,
  scoreJob,
  type Settings,
  withTimeout,
} from "../_shared/jobwatch.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Clés publiques de recherche embarquées dans le frontend de WTTJ
// (elles peuvent changer : surcharger via les secrets d'edge function).
const WTTJ_ALGOLIA_APP = Deno.env.get("WTTJ_ALGOLIA_APP") || "CSEKHVMS53";
const WTTJ_ALGOLIA_KEY = Deno.env.get("WTTJ_ALGOLIA_KEY") ||
  "02f0d440ab7bd71d84bd4dadea3f0a05";
const WTTJ_INDEX = Deno.env.get("WTTJ_INDEX") || "wttj_jobs_production_fr";

interface SourceReport {
  source: string;
  ok: boolean;
  found: number;
  detail?: string;
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<unknown> {
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: t.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    t.clear();
  }
}

// ── Welcome to the Jungle (Algolia) ────────────────────────────────────────
async function fetchWTTJ(
  query: string,
  reports: SourceReport[],
  extraFilters = "",
): Promise<JobRow[]> {
  try {
    const body = {
      query,
      hitsPerPage: 50,
      attributesToRetrieve: [
        "name", "slug", "organization", "offices", "contract_type",
        "published_at", "profile", "reference",
      ],
      filters: extraFilters || undefined,
    };
    const data = (await fetchJson(
      `https://${WTTJ_ALGOLIA_APP.toLowerCase()}-dsn.algolia.net/1/indexes/${WTTJ_INDEX}/query`,
      {
        method: "POST",
        headers: {
          "x-algolia-application-id": WTTJ_ALGOLIA_APP,
          "x-algolia-api-key": WTTJ_ALGOLIA_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    )) as { hits?: Record<string, unknown>[] };

    const jobs: JobRow[] = [];
    for (const hit of data.hits || []) {
      const org = hit.organization as Record<string, unknown> | undefined;
      const offices = hit.offices as Record<string, unknown>[] | undefined;
      const office = offices?.[0];
      const slug = hit.slug as string | undefined;
      const orgSlug = org?.slug as string | undefined;
      if (!slug || !orgSlug) continue;
      jobs.push({
        source: "wttj",
        external_id: String(hit.reference || hit.objectID || slug),
        company_name: (org?.name as string) || null,
        title: (hit.name as string) || "Sans titre",
        location: office
          ? [office.city, office.country].filter(Boolean).join(", ")
          : null,
        contract_type: (hit.contract_type as string) || null,
        url:
          `https://www.welcometothejungle.com/fr/companies/${orgSlug}/jobs/${slug}`,
        description: (hit.profile as string) || null,
        published_at: hit.published_at
          ? new Date(hit.published_at as string).toISOString()
          : null,
        raw: hit,
      });
    }
    reports.push({ source: `wttj:${query}`, ok: true, found: jobs.length });
    return jobs;
  } catch (e) {
    reports.push({
      source: `wttj:${query}`,
      ok: false,
      found: 0,
      detail: String(e),
    });
    return [];
  }
}

// ── LinkedIn (endpoint invité, best effort) ────────────────────────────────
async function fetchLinkedIn(
  query: string,
  location: string,
  reports: SourceReport[],
): Promise<JobRow[]> {
  try {
    const url =
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?` +
      new URLSearchParams({
        keywords: query,
        location,
        f_TPR: "r86400", // dernières 24 h
        start: "0",
      });
    const t = withTimeout(15000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: t.signal,
    });
    t.clear();
    if (!res.ok) throw new Error(`HTTP ${res.status} (blocage anti-bot probable)`);
    const html = await res.text();

    // L'endpoint renvoie des fragments HTML <li> (cartes d'offres).
    const jobs: JobRow[] = [];
    const cards = html.split(/<li[\s>]/).slice(1);
    for (const card of cards) {
      const id = card.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/)?.[1];
      const link = card.match(
        /href="(https:\/\/[a-z]*\.?linkedin\.com\/jobs\/view\/[^"]+)"/,
      )?.[1];
      const title = card.match(
        /base-search-card__title[^>]*>\s*([^<]+)/,
      )?.[1]?.trim();
      const company = card.match(
        /base-search-card__subtitle[^>]*>[\s\S]*?>\s*([^<]+)/,
      )?.[1]?.trim();
      const loc = card.match(
        /job-search-card__location[^>]*>\s*([^<]+)/,
      )?.[1]?.trim();
      const date = card.match(/datetime="([^"]+)"/)?.[1];
      if (!id || !title) continue;
      jobs.push({
        source: "linkedin",
        external_id: id,
        company_name: company || null,
        title,
        location: loc || null,
        contract_type: null, // non exposé par l'endpoint invité
        url: link ? link.split("?")[0] : `https://www.linkedin.com/jobs/view/${id}`,
        description: null,
        published_at: date ? new Date(date).toISOString() : null,
      });
    }
    reports.push({
      source: `linkedin:${query}`,
      ok: true,
      found: jobs.length,
    });
    return jobs;
  } catch (e) {
    reports.push({
      source: `linkedin:${query}`,
      ok: false,
      found: 0,
      detail: String(e),
    });
    return [];
  }
}

// ── Pages carrières (ATS publics) ──────────────────────────────────────────
function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  const text = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 4000) || null;
}

async function fetchGreenhouse(name: string, slug: string): Promise<JobRow[]> {
  const data = (await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  )) as { jobs?: Record<string, unknown>[] };
  return (data.jobs || []).map((j) => ({
    source: "greenhouse",
    external_id: `${slug}:${j.id}`,
    company_name: name,
    title: (j.title as string) || "Sans titre",
    location: ((j.location as Record<string, unknown>)?.name as string) || null,
    contract_type: null,
    url: (j.absolute_url as string) || `https://boards.greenhouse.io/${slug}`,
    description: stripHtml(j.content as string),
    published_at: (j.updated_at as string) || null,
  }));
}

async function fetchLever(name: string, slug: string): Promise<JobRow[]> {
  const data = (await fetchJson(
    `https://api.lever.co/v0/postings/${slug}?mode=json`,
  )) as Record<string, unknown>[];
  return (Array.isArray(data) ? data : []).map((j) => {
    const cats = j.categories as Record<string, unknown> | undefined;
    return {
      source: "lever",
      external_id: `${slug}:${j.id}`,
      company_name: name,
      title: (j.text as string) || "Sans titre",
      location: (cats?.location as string) || null,
      contract_type: (cats?.commitment as string) || null,
      url: (j.hostedUrl as string) || `https://jobs.lever.co/${slug}`,
      description: stripHtml(j.descriptionPlain as string),
      published_at: j.createdAt
        ? new Date(j.createdAt as number).toISOString()
        : null,
    };
  });
}

async function fetchRecruitee(name: string, slug: string): Promise<JobRow[]> {
  const data = (await fetchJson(
    `https://${slug}.recruitee.com/api/offers/`,
  )) as { offers?: Record<string, unknown>[] };
  return (data.offers || []).map((j) => ({
    source: "recruitee",
    external_id: `${slug}:${j.id}`,
    company_name: name,
    title: (j.title as string) || "Sans titre",
    location: (j.location as string) ||
      [j.city, j.country].filter(Boolean).join(", ") || null,
    contract_type: (j.employment_type_code as string) || null,
    url: (j.careers_url as string) || `https://${slug}.recruitee.com`,
    description: stripHtml(j.description as string),
    published_at: (j.published_at as string) || (j.created_at as string) || null,
  }));
}

// ── Orchestration ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const auth = await authorize(req, supabaseUrl, anonKey);
  if (!auth.ok) return json({ error: `unauthorized: ${auth.reason}` }, 401);

  const db = createClient(supabaseUrl, serviceKey);
  const reports: SourceReport[] = [];

  const { data: allSettings, error: settingsErr } = await db
    .from("jobwatch_settings")
    .select("*");
  if (settingsErr) return json({ error: settingsErr.message }, 500);
  if (!allSettings?.length) {
    return json({ message: "aucun profil configuré", reports });
  }

  // 1) Recherches par mots-clés (WTTJ + LinkedIn), mutualisées entre
  //    utilisateurs : une requête par terme de recherche distinct.
  const queries = new Map<string, string>(); // norm -> original
  const linkedinLocations = new Set<string>();
  for (const s of allSettings as Settings[]) {
    for (const q of s.search_queries || []) {
      if (q?.trim()) queries.set(norm(q), q.trim());
    }
    // LinkedIn exige une localisation : première ville "réelle" du profil.
    const city = (s.locations || []).find(
      (l) => l && !/remote|t[ée]l[ée]travail/i.test(l),
    );
    linkedinLocations.add(city ? `${city}, France` : "Paris, France");
  }

  const collected: JobRow[] = [];
  for (const q of queries.values()) {
    collected.push(...(await fetchWTTJ(q, reports)));
    for (const loc of linkedinLocations) {
      collected.push(...(await fetchLinkedIn(q, loc, reports)));
    }
  }

  // 2) Entreprises cibles (pages carrières ATS + WTTJ par entreprise)
  const { data: companies } = await db
    .from("jobwatch_companies")
    .select("*")
    .eq("active", true);

  for (const c of companies || []) {
    if (c.source_type === "link") continue; // simple lien, pas de collecte
    try {
      let jobs: JobRow[] = [];
      if (c.source_type === "greenhouse") {
        jobs = await fetchGreenhouse(c.name, c.slug);
      } else if (c.source_type === "lever") {
        jobs = await fetchLever(c.name, c.slug);
      } else if (c.source_type === "recruitee") {
        jobs = await fetchRecruitee(c.name, c.slug);
      } else if (c.source_type === "wttj") {
        jobs = await fetchWTTJ("", reports, `organization.slug:${c.slug}`);
      }
      collected.push(...jobs);
      reports.push({ source: `${c.source_type}:${c.slug}`, ok: true, found: jobs.length });
      await db.from("jobwatch_companies").update({
        last_fetch_at: new Date().toISOString(),
        last_fetch_status: `ok (${jobs.length} offres)`,
      }).eq("id", c.id);
    } catch (e) {
      reports.push({
        source: `${c.source_type}:${c.slug}`,
        ok: false,
        found: 0,
        detail: String(e),
      });
      await db.from("jobwatch_companies").update({
        last_fetch_at: new Date().toISOString(),
        last_fetch_status: `erreur : ${String(e).slice(0, 200)}`,
      }).eq("id", c.id);
    }
  }

  // 3) Déduplication + insertion des offres
  const bySourceId = new Map<string, JobRow>();
  for (const j of collected) bySourceId.set(`${j.source}:${j.external_id}`, j);
  const unique = [...bySourceId.values()];

  let inserted = 0;
  if (unique.length) {
    const { data: upserted, error: upsertErr } = await db
      .from("jobwatch_jobs")
      .upsert(
        unique.map(({ raw: _raw, ...j }) => ({ ...j, raw: null })),
        { onConflict: "source,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (upsertErr) return json({ error: upsertErr.message, reports }, 500);
    inserted = upserted?.length || 0;
  }

  // 4) Scoring : matcher les offres récentes (7 jours) sans match existant
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: recentJobs } = await db
    .from("jobwatch_jobs")
    .select("*")
    .gte("first_seen_at", since);

  let newMatches = 0;
  for (const s of allSettings as Settings[]) {
    const rows = (recentJobs || []).map((job) => {
      const { score, breakdown } = scoreJob(job as JobRow, s);
      return { job_id: job.id, user_id: s.user_id, score, breakdown };
    }).filter((m) => m.score > 0);
    if (!rows.length) continue;
    const { data: ins } = await db
      .from("jobwatch_matches")
      .upsert(rows, { onConflict: "job_id,user_id", ignoreDuplicates: true })
      .select("id");
    newMatches += ins?.length || 0;
  }

  return json({
    collected: unique.length,
    new_jobs: inserted,
    new_matches: newMatches,
    reports,
  });
});
