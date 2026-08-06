// Provo — « read-booking »
//
// Lit une confirmation de réservation collée telle quelle — courriel d'hôtel,
// billet de train, confirmation de vol ou de restaurant — et en rend une fiche.
//
// Pourquoi : c'est le point fort de TripIt, et c'est du travail de saisie pur.
// La confirmation contient déjà le lieu, la date, l'heure et la référence ;
// les retaper dans un formulaire, c'est exactement ce que le principe du
// produit veut éviter. On colle, l'app remplit.
//
// Ce qu'elle ne fait PAS : décider. Elle rend ce qu'elle a lu, le client le
// montre, et rien n'est enregistré sans accord — comme pour un ticket.
//
// Sans clé Anthropic configurée, elle répond franchement plutôt que de laisser
// croire à une panne.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Une confirmation tient largement là-dedans. Au-delà, c'est qu'on colle autre
// chose — et c'est un coût qu'on n'a pas demandé.
const TAILLE_MAX = 20000;
const TAILLE_MIN = 60;

const SYSTEME =
  "Tu lis une confirmation de réservation collée par un voyageur et tu en " +
  "extrais UNE réservation.\n" +
  "Réponds UNIQUEMENT par du JSON compact :\n" +
  '{"titre":string,"lieu":string,"adresse":string,"date":string,"heure":string,' +
  '"fin":string,"reference":string,' +
  '"categorie":"trajet"|"repos"|"resto"|"visite"|"fun"|"autre",' +
  '"confiance":"haute"|"basse"}\n' +
  "titre = ce qu'on veut lire sur la fiche, court et concret : « Vol Paris → " +
  "Vienne », « Hôtel Sacher », « Dîner Figlmüller ». Pas de numéro dedans.\n" +
  "lieu = le nom de l'établissement, de la gare ou de l'aéroport d'ARRIVÉE. " +
  "Vide si la réservation n'a pas de lieu identifiable.\n" +
  "adresse = l'adresse postale si elle figure, sinon \"\".\n" +
  "date = AAAA-MM-JJ de début. heure = HH:MM de début. fin = HH:MM de fin si " +
  "elle est donnée (arrivée d'un vol, fin d'un créneau), sinon \"\".\n" +
  "reference = le numéro de réservation, de dossier ou de billet, sinon \"\".\n" +
  "categorie : un vol, un train, un bus, une voiture → trajet. Un hôtel, un " +
  "logement → repos. Un restaurant → resto. Un musée, une visite → visite.\n" +
  "confiance = \"basse\" dès que la date ou le lieu sont ambigus, ou si le " +
  "texte n'est manifestement pas une réservation. Une fausse date se découvre " +
  "le jour du départ : mieux vaut le dire.\n" +
  "Si plusieurs réservations figurent, prends la PREMIÈRE par date.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY") ||
    Deno.env.get("ANTHROPIC_API_KEY_TB");
  if (!key) return json({ error: "cle_absente" }, 200);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const texte = typeof body?.texte === "string" ? body.texte.trim() : "";
  if (texte.length < TAILLE_MIN) return json({ error: "texte_trop_court" }, 400);
  if (texte.length > TAILLE_MAX) return json({ error: "texte_trop_long" }, 413);

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 20000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controleur.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEME,
        messages: [{ role: "user", content: texte.slice(0, TAILLE_MAX) }],
      }),
    });
    clearTimeout(minuteur);
    if (!r.ok) return json({ error: "modele_indisponible", statut: r.status }, 200);

    const d = await r.json();
    const brut = d?.content?.[0]?.text || "";
    const m = brut.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "reponse_illisible" }, 200);

    const p = JSON.parse(m[0]);
    const txt = (v: unknown, n = 120) =>
      typeof v === "string" ? v.trim().slice(0, n) : "";
    const heure = (v: unknown) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || "")) ? String(v) : "";

    // Sans titre ni lieu, il n'y a rien d'utilisable : le dire vaut mieux que
    // de rendre une fiche vide que l'utilisateur devra remplir lui-même.
    const titre = txt(p.titre, 80);
    const lieu = txt(p.lieu, 80);
    if (!titre && !lieu) return json({ error: "pas_une_reservation" }, 200);

    return json({
      ok: true,
      titre: titre || lieu,
      lieu,
      adresse: txt(p.adresse, 160),
      date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : "",
      heure: heure(p.heure),
      fin: heure(p.fin),
      reference: txt(p.reference, 40),
      categorie: ["trajet", "repos", "resto", "visite", "fun"].includes(p.categorie)
        ? p.categorie
        : "autre",
      // Remonté tel quel : c'est au client de le montrer, pas à cette fonction
      // de décider si l'utilisateur doit vérifier.
      confiance: p.confiance === "basse" ? "basse" : "haute",
    }, 200);
  } catch (e) {
    clearTimeout(minuteur);
    return json({ error: "lecture_impossible", detail: String(e).slice(0, 120) }, 200);
  }
});
