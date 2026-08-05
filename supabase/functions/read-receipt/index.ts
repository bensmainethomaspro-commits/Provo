// Provo — « read-receipt »
//
// Lit un ticket de caisse photographié et en rend le montant, la devise, le
// nom du commerce et la date.
//
// Pourquoi : le principe du produit est que les dépenses se notent en un geste
// et que l'app calcule à la place de l'utilisateur. Taper « 47,80 » en sortant
// d'un restaurant, c'est déjà un calcul de plus qu'il ne devrait faire — et le
// chiffre est là, sur le ticket qu'il tient.
//
// Ce que la fonction ne fait PAS : décider. Elle rend ce qu'elle a lu, et le
// client demande confirmation. Un montant faux dans un partage de dépenses se
// découvre à la fin du voyage, quand il est trop tard pour le corriger de
// mémoire.
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

// Une photo de ticket compressée par le client dépasse rarement 400 ko. Au-delà
// on refuse : c'est soit une erreur, soit un coût qu'on n'a pas demandé.
const TAILLE_MAX = 1_500_000;

const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Découpe une donnée `data:` en ce que l'API du modèle attend. */
function lireDataUrl(url: string): { type: string; data: string } | null {
  const m = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(url.trim());
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!TYPES.includes(type)) return null;
  return { type, data: m[2] };
}

const SYSTEME =
  "Tu lis la photo d'un ticket de caisse et tu en extrais le paiement.\n" +
  "Réponds UNIQUEMENT par du JSON compact :\n" +
  '{"montant":number|null,"devise":string,"commerce":string,"date":string,' +
  '"categorie":"transport"|"hebergement"|"repas"|"verre"|"activite"|"shopping"|"autre",' +
  '"confiance":"haute"|"basse"}\n' +
  "montant = le TOTAL payé, pas un sous-total, pas la TVA, pas le pourboire " +
  "suggéré. En cas de doute entre plusieurs nombres, prends celui étiqueté " +
  "total, somme, à payer, ou le plus grand en bas du ticket.\n" +
  "devise = code ISO à trois lettres (EUR, USD, CHF…), déduit du symbole ou du " +
  "pays. Vide si tu ne sais pas.\n" +
  "commerce = le nom de l'établissement, tel qu'il figure en haut du ticket.\n" +
  "date = AAAA-MM-JJ si elle est lisible, sinon \"\".\n" +
  "categorie = ce qu'on a acheté. Un bar, un café en terrasse → verre. Un repas " +
  "assis ou à emporter → repas.\n" +
  "confiance = \"basse\" dès que l'image est floue, coupée, ou que le total est " +
  "ambigu. Un montant faux se découvre à la fin du voyage, quand il est trop " +
  "tard : mieux vaut le dire.\n" +
  "Si ce n'est pas un ticket, renvoie montant null et confiance basse.";

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

  const image = typeof body?.image === "string" ? body.image : "";
  if (!image) return json({ error: "image_manquante" }, 400);
  if (image.length > TAILLE_MAX) return json({ error: "image_trop_lourde" }, 413);

  const decoupe = lireDataUrl(image);
  if (!decoupe) return json({ error: "format_non_supporte" }, 400);

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
        max_tokens: 300,
        system: SYSTEME,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: decoupe.type, data: decoupe.data },
            },
            { type: "text", text: "Le total payé ?" },
          ],
        }],
      }),
    });
    clearTimeout(minuteur);
    if (!r.ok) return json({ error: "modele_indisponible", statut: r.status }, 200);

    const d = await r.json();
    const brut = d?.content?.[0]?.text || "";
    const m = brut.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "reponse_illisible" }, 200);

    const p = JSON.parse(m[0]);
    const montant = typeof p.montant === "number" && isFinite(p.montant) && p.montant > 0
      ? Math.round(p.montant * 100) / 100
      : null;

    return json({
      ok: true,
      montant,
      devise: typeof p.devise === "string" ? p.devise.toUpperCase().slice(0, 3) : "",
      commerce: typeof p.commerce === "string" ? p.commerce.trim().slice(0, 80) : "",
      date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : "",
      categorie: typeof p.categorie === "string" ? p.categorie : "autre",
      // Remonté tel quel : c'est au client de le montrer, pas à cette fonction
      // de décider si l'utilisateur doit vérifier.
      confiance: p.confiance === "basse" ? "basse" : "haute",
    }, 200);
  } catch (e) {
    clearTimeout(minuteur);
    return json({ error: "lecture_impossible", detail: String(e).slice(0, 120) }, 200);
  }
});
