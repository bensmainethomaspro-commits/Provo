// JobWatch — utilitaires partagés entre les edge functions
// (scoring d'adéquation, normalisation, auth des appels).

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export interface JobRow {
  id?: string;
  source: string;
  external_id: string;
  company_name: string | null;
  title: string;
  location: string | null;
  contract_type: string | null;
  url: string;
  description: string | null;
  published_at: string | null;
  raw?: unknown;
}

export interface Settings {
  user_id: string;
  email: string | null;
  title_keywords: string[];
  bonus_keywords: string[];
  locations: string[];
  contract_types: string[];
  search_queries: string[];
  min_score: number;
  digest_enabled: boolean;
}

// Minuscules + sans accents, pour des comparaisons tolérantes
// ("Île-de-France" ~ "ile-de-france", "Chargé" ~ "charge").
export function norm(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export interface ScoreResult {
  score: number;
  breakdown: {
    title: number;
    location: number;
    contract: number;
    keywords: number;
    matched: string[];
  };
}

// Score d'adéquation 0–100, par règles pondérées :
//   titre 45 pts · localisation 20 pts · contrat 20 pts · mots-clés 15 pts
export function scoreJob(job: JobRow, s: Settings): ScoreResult {
  const title = norm(job.title);
  const location = norm(job.location);
  const haystack = `${title} ${norm(job.description)} ${norm(job.contract_type)}`;
  const matched: string[] = [];

  let titlePts = 0;
  for (const kw of s.title_keywords) {
    if (kw && title.includes(norm(kw))) {
      titlePts = 45;
      matched.push(kw);
      break;
    }
  }
  // Le mot-clé n'apparaît que dans le descriptif : demi-score.
  if (titlePts === 0) {
    for (const kw of s.title_keywords) {
      if (kw && haystack.includes(norm(kw))) {
        titlePts = 22;
        matched.push(`${kw} (descriptif)`);
        break;
      }
    }
  }

  let locPts = 0;
  if (!location) {
    locPts = 8; // localisation inconnue : ni bonus ni exclusion
  } else {
    for (const loc of s.locations) {
      if (loc && location.includes(norm(loc))) {
        locPts = 20;
        matched.push(job.location || loc);
        break;
      }
    }
  }

  let contractPts = 0;
  const contractText = haystack;
  for (const ct of s.contract_types) {
    if (ct && contractText.includes(norm(ct))) {
      contractPts = 20;
      matched.push(ct);
      break;
    }
  }
  if (contractPts === 0 && !job.contract_type && !job.description) {
    contractPts = 8; // info contrat absente de la source
  }

  let kwPts = 0;
  for (const kw of s.bonus_keywords) {
    if (kw && haystack.includes(norm(kw))) {
      kwPts += 5;
      matched.push(kw);
      if (kwPts >= 15) break;
    }
  }

  const score = Math.min(100, titlePts + locPts + contractPts + kwPts);
  return {
    score,
    breakdown: {
      title: titlePts,
      location: locPts,
      contract: contractPts,
      keywords: kwPts,
      matched,
    },
  };
}

// Les fonctions sont déployées avec --no-verify-jwt pour que le cron
// puisse les appeler ; on revalide donc nous-mêmes l'appelant :
// soit le secret cron (header x-cron-secret), soit un JWT utilisateur valide.
export async function authorize(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<{ ok: boolean; reason?: string }> {
  const cronSecret = Deno.env.get("JOBWATCH_CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) {
    return { ok: true };
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, reason: "missing token" };
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  if (!res.ok) return { ok: false, reason: "invalid token" };
  return { ok: true };
}

export function withTimeout(ms: number) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}
