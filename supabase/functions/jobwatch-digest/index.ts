// JobWatch — "jobwatch-digest" Edge Function
//
// Compose et envoie le digest matinal : les nouvelles offres (pas encore
// digérées) dont le score dépasse le seuil de l'utilisateur, triées par
// score décroissant, avec le détail du scoring. Envoi par l'API Resend
// (secret RESEND_API_KEY requis). Sans nouvelle offre, aucun email n'est
// envoyé.
//
// Corps optionnel : { "preview": true } → renvoie le HTML sans envoyer
// ni marquer les offres comme digérées (bouton "Prévisualiser" de l'app).
//
// Appelée par le cron du matin (header x-cron-secret) ou depuis l'app
// (JWT utilisateur). Déployer avec --no-verify-jwt.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorize, CORS, json, type Settings } from "../_shared/jobwatch.ts";

const FROM = Deno.env.get("JOBWATCH_EMAIL_FROM") ||
  "JobWatch <onboarding@resend.dev>";

function esc(s: string | null | undefined): string {
  return (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function scoreColor(score: number): string {
  if (score >= 70) return "#15803d";
  if (score >= 50) return "#ca8a04";
  return "#6b7280";
}

const SOURCE_LABELS: Record<string, string> = {
  wttj: "Welcome to the Jungle",
  linkedin: "LinkedIn",
  greenhouse: "Page carrières",
  lever: "Page carrières",
  recruitee: "Page carrières",
};

interface MatchWithJob {
  id: string;
  score: number;
  breakdown: { matched?: string[] } | null;
  jobwatch_jobs: {
    title: string;
    company_name: string | null;
    location: string | null;
    contract_type: string | null;
    url: string;
    source: string;
    published_at: string | null;
  };
}

function digestHtml(
  matches: MatchWithJob[],
  manualLinks: { name: string; careers_url: string }[],
  dateLabel: string,
): string {
  const items = matches.map((m) => {
    const j = m.jobwatch_jobs;
    const matched = (m.breakdown?.matched || []).slice(0, 5);
    return `
    <tr><td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;">
      <div style="display:flex;">
        <span style="display:inline-block;min-width:44px;padding:4px 8px;border-radius:8px;background:${scoreColor(m.score)};color:#fff;font-weight:700;text-align:center;font-size:14px;">${m.score}</span>
      </div>
      <div style="margin-top:6px;">
        <a href="${esc(j.url)}" style="font-size:16px;font-weight:600;color:#1d4ed8;text-decoration:none;">${esc(j.title)}</a>
      </div>
      <div style="color:#374151;font-size:13px;margin-top:2px;">
        ${esc(j.company_name || "Entreprise inconnue")}
        ${j.location ? " · " + esc(j.location) : ""}
        ${j.contract_type ? " · " + esc(j.contract_type) : ""}
        · <span style="color:#6b7280;">${SOURCE_LABELS[j.source] || esc(j.source)}</span>
      </div>
      ${
      matched.length
        ? `<div style="margin-top:4px;font-size:12px;color:#6b7280;">Critères : ${matched.map(esc).join(" · ")}</div>`
        : ""
    }
    </td></tr>`;
  }).join("");

  const manual = manualLinks.length
    ? `<p style="font-size:13px;color:#6b7280;margin-top:20px;">
        Pages carrières à vérifier manuellement (ATS non supporté) :
        ${manualLinks.map((c) => `<a href="${esc(c.careers_url)}" style="color:#1d4ed8;">${esc(c.name)}</a>`).join(" · ")}
      </p>`
    : "";

  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 12px;">
    <h1 style="font-size:20px;color:#111827;">🔎 JobWatch — ${matches.length} nouvelle${matches.length > 1 ? "s" : ""} offre${matches.length > 1 ? "s" : ""}</h1>
    <p style="color:#6b7280;font-size:13px;margin-top:-8px;">Digest du ${dateLabel}, triées par score d'adéquation.</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;">${items}</table>
    ${manual}
    <p style="font-size:11px;color:#9ca3af;margin-top:24px;">
      LinkedIn bloque activement la collecte automatique : la couverture LinkedIn est partielle et peut s'interrompre.
      Welcome to the Jungle et les pages carrières restent les sources fiables.
    </p>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");

  const auth = await authorize(req, supabaseUrl, anonKey);
  if (!auth.ok) return json({ error: `unauthorized: ${auth.reason}` }, 401);

  let preview = false;
  try {
    const body = await req.json();
    preview = body?.preview === true;
  } catch { /* corps vide : envoi normal */ }

  const db = createClient(supabaseUrl, serviceKey);
  const { data: allSettings, error } = await db
    .from("jobwatch_settings")
    .select("*")
    .eq("digest_enabled", true);
  if (error) return json({ error: error.message }, 500);

  const dateLabel = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
    timeZone: "Europe/Paris",
  }).format(new Date());

  const results: Record<string, unknown>[] = [];

  for (const s of (allSettings || []) as Settings[]) {
    // Offres pas encore digérées, au-dessus du seuil, vues il y a < 72 h
    // (évite de renvoyer tout l'historique au premier digest).
    const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const { data: matches } = await db
      .from("jobwatch_matches")
      .select(
        "id, score, breakdown, jobwatch_jobs!inner(title, company_name, location, contract_type, url, source, published_at)",
      )
      .eq("user_id", s.user_id)
      .is("digested_at", null)
      .gte("score", s.min_score)
      .gte("created_at", since)
      .order("score", { ascending: false })
      .limit(30);

    const { data: manualCompanies } = await db
      .from("jobwatch_companies")
      .select("name, careers_url")
      .eq("user_id", s.user_id)
      .eq("source_type", "link")
      .eq("active", true)
      .not("careers_url", "is", null);

    const list = (matches || []) as unknown as MatchWithJob[];
    if (!list.length && !preview) {
      results.push({ user: s.user_id, sent: false, reason: "aucune nouvelle offre" });
      continue;
    }

    const html = digestHtml(list, manualCompanies || [], dateLabel);

    if (preview) {
      return json({ preview: true, count: list.length, html });
    }

    if (!s.email) {
      results.push({ user: s.user_id, sent: false, reason: "email non configuré" });
      continue;
    }
    if (!resendKey) {
      results.push({
        user: s.user_id,
        sent: false,
        reason: "RESEND_API_KEY manquant (secret d'edge function à configurer)",
      });
      continue;
    }

    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [s.email],
        subject: `🔎 JobWatch : ${list.length} nouvelle${list.length > 1 ? "s" : ""} offre${list.length > 1 ? "s" : ""} — ${dateLabel}`,
        html,
      }),
    });

    if (!sendRes.ok) {
      const detail = await sendRes.text();
      results.push({ user: s.user_id, sent: false, reason: `Resend: ${detail.slice(0, 300)}` });
      continue;
    }

    await db
      .from("jobwatch_matches")
      .update({ digested_at: new Date().toISOString() })
      .in("id", list.map((m) => m.id));

    results.push({ user: s.user_id, sent: true, count: list.length });
  }

  return json({ results });
});
