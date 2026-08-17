// Provo — « notifier-depense »
//
// Quand quelqu'un note une dépense commune, les autres voyageurs l'apprennent
// tout de suite — titre et montant — sur les appareils où ils ont accepté les
// notifications.
//
// Pourquoi une fonction plutôt qu'un envoi depuis le téléphone : seul le
// serveur voit les abonnements des autres (la table est protégée par RLS, on ne
// lit que les siens), et seul lui détient les clés VAPID.
//
// CE QUI EST ENVOYÉ NE VIENT PAS DE L'APPEL. La requête ne porte que deux
// identifiants — le voyage et la dépense. Le texte de la notification est
// reconstruit ici, à partir de ce qui est écrit en base. Sans cette règle,
// n'importe quel membre pourrait faire afficher n'importe quoi sur le
// téléphone des autres.
//
// Trois conditions avant d'envoyer quoi que ce soit :
//   1. l'appelant est authentifié — son jeton, pas une clé publiable ;
//   2. il est membre de ce voyage ;
//   3. la dépense concerne vraiment plusieurs personnes.
//
// Et jamais à l'auteur lui-même : il vient de la saisir.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";
import { origineAutorisee } from "../_shared/origine.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Abo = { endpoint: string; p256dh: string; auth: string; user_id: string };

/** Un montant en euros, écrit comme dans l'app. */
function montant(valeur: number): string {
  const rond = Number.isInteger(valeur);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: rond ? 0 : 2, maximumFractionDigits: 2,
  }).format(valeur);
}

/**
 * Le nom du voyageur qui a payé, tel qu'il est écrit dans le voyage.
 *
 * On ne va PAS chercher dans `profiles` : le nom qui compte est celui que le
 * groupe s'est donné dans ce voyage (« Léa »), pas celui du compte.
 */
function nomDe(trip: any, travelerId: string): string {
  const t = (trip?.tripTravelers || []).find((x: any) => x.id === travelerId);
  return t ? `${t.emoji ? `${t.emoji} ` : ""}${t.name}` : "Quelqu'un";
}

// ── Ce qui s'affiche sur l'écran verrouillé ─────────────────────────────────
// Séparé du reste pour être vérifiable sans Supabase ni clés VAPID : c'est la
// partie qu'on relit, et la seule que l'utilisateur voit.
// `scripts/verif-notif-depense.mjs` la découpe dans ce fichier.

/**
 * Faut-il déranger quelqu'un pour cette dépense ?
 *
 * Une dépense qui ne concerne que celui qui l'a saisie n'intéresse personne —
 * et une notification qui n'aide pas est une notification qu'on désactive, en
 * emportant celles qui servaient. Un remboursement, lui, concerne toujours
 * l'autre : il change ce qu'il doit.
 */
function doitNotifier(dep: any): boolean {
  if (!dep) return false;
  if (dep.isSettlement) return true;
  return (dep.participantIds || []).length >= 2;
}

/** Le titre et le corps de la notification, en une phrase qui se lit d'un œil. */
function messageDepense(trip: any, dep: any): { titre: string; corps: string } {
  const eur = Number(dep.eurAmount ?? dep.amount ?? 0);
  const qui = nomDe(trip, dep.payerId);
  const quoi = String(dep.description || "").trim() || "Dépense";
  // Un revenu est enregistré en négatif : le verbe suit le signe, sinon on
  // annonce « a ajouté −40 € », ce qui ne se lit pas.
  const verbe = dep.isSettlement ? "a noté un remboursement de"
    : eur < 0 ? "a noté une rentrée de" : "a ajouté";
  return {
    titre: `${trip?.emoji || "💶"} ${trip?.name || "Voyage"}`,
    corps: dep.isSettlement
      ? `${qui} ${verbe} ${montant(Math.abs(eur))}`
      : `${qui} ${verbe} « ${quoi} » — ${montant(Math.abs(eur))}`,
  };
}

const dors = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!origineAutorisee(req)) return json({ error: "origine_refusee" }, 403);

  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jeton) return json({ error: "non_authentifie" }, 401);

  let corps: { tripId?: string; expenseId?: string };
  try { corps = await req.json(); } catch { return json({ error: "corps_illisible" }, 400); }
  const { tripId, expenseId } = corps;
  if (!tripId || !expenseId) return json({ error: "identifiants_manquants" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service);

  // 1 · Qui appelle ? Le jeton est vérifié par le serveur d'authentification —
  //     on ne se contente pas de le lire. `getUser(jeton)` évite au passage de
  //     dépendre du nom de la clé publiable, qui a changé de nom en 2025.
  const { data: auth } = await db.auth.getUser(jeton);
  const appelant = auth?.user?.id;
  if (!appelant) return json({ error: "non_authentifie" }, 401);

  // 2 · Est-il membre de ce voyage ? Le propriétaire compte aussi : un voyage
  //     n'a d'entrée dans `trip_members` qu'une fois la collaboration ouverte.
  const { data: membres } = await db
    .from("trip_members").select("user_id").eq("trip_id", tripId);
  const { data: voyage } = await db
    .from("trips").select("data, owner_id").eq("id", tripId).maybeSingle();
  if (!voyage) return json({ error: "voyage_inconnu" }, 404);

  const ids = new Set<string>((membres || []).map((m: any) => m.user_id));
  if (voyage.owner_id) ids.add(voyage.owner_id);
  if (!ids.has(appelant)) return json({ error: "non_membre" }, 403);

  // Personne d'autre : rien à annoncer, et surtout rien à écrire de plus.
  const destinataires = [...ids].filter((id) => id !== appelant);
  if (!destinataires.length) return json({ ok: true, envoyes: 0, motif: "seul" });

  // 3 · La dépense, lue en base — jamais dans la requête.
  //     Le client synchronise avec 700 ms de retard : si elle n'est pas encore
  //     arrivée, on laisse passer l'écriture et on relit une fois. Deux lectures
  //     au maximum, pour ne pas boucler sur une dépense qui n'existera jamais.
  let trip = voyage.data;
  let dep = (trip?.expenses || []).find((e: any) => e.id === expenseId);
  if (!dep) {
    await dors(1500);
    const { data: relu } = await db
      .from("trips").select("data").eq("id", tripId).maybeSingle();
    trip = relu?.data ?? trip;
    dep = (trip?.expenses || []).find((e: any) => e.id === expenseId);
  }
  if (!dep) return json({ ok: true, envoyes: 0, motif: "depense_absente" });

  if (!doitNotifier(dep)) {
    return json({ ok: true, envoyes: 0, motif: "depense_personnelle" });
  }
  const { titre, corps: texte } = messageDepense(trip, dep);

  const brutesCles = Deno.env.get("VAPID_KEYS");
  if (!brutesCles) return json({ ok: true, envoyes: 0, motif: "vapid_absent" });

  const { data: abos } = await db
    .from("push_subscriptions").select("endpoint, p256dh, auth, user_id")
    .in("user_id", destinataires).returns<Abo[]>();
  if (!abos?.length) return json({ ok: true, envoyes: 0, motif: "personne_abonne" });

  const serveur = await webpush.ApplicationServer.new({
    contactInformation: "mailto:contact@provo.app",
    vapidKeys: await webpush.importVapidKeys(JSON.parse(brutesCles)),
  });

  let envoyes = 0, retires = 0;
  for (const abo of abos) {
    try {
      const abonne = serveur.subscribe({
        endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth },
      } as any);
      await abonne.pushTextMessage(JSON.stringify({
        titre, corps: texte,
        // Une seule bulle par dépense, même sur deux appareils : deux fois la
        // même annonce, c'est une notification qu'on finit par couper.
        tag: `depense:${expenseId}`,
        url: "/",
      }), {});
      envoyes++;
    } catch (e) {
      // 404 / 410 : l'abonnement est mort (app désinstallée, clé changée).
      const s = String(e);
      if (s.includes("404") || s.includes("410")) {
        await db.from("push_subscriptions").delete().eq("endpoint", abo.endpoint);
        retires++;
      }
    }
  }

  return json({ ok: true, envoyes, retires, destinataires: destinataires.length });
});
