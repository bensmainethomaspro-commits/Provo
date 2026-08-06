// Provo — « push-tick »
//
// Passe en revue les voyages en cours et envoie les rappels qui valent la peine
// d'interrompre quelqu'un. Appelée toutes les quinze minutes par un déclencheur
// planifié (voir `.github/workflows/push-tick.yml`).
//
// **Ce qu'on n'envoie pas** est le plus important. Une notification qui n'aide
// pas est une notification qu'on désactive — et on perd alors aussi celles qui
// servaient. Trois règles tenues :
//
//   1. Un seul envoi par activité et par type de rappel (`envoyes`).
//   2. Rien entre 22 h et 7 h, heure du voyageur.
//   3. Rien qu'on pourrait deviner : pas de « bonne journée », pas de résumé.
//
// Trois rappels seulement, tous liés à une décision qu'on doit prendre à cet
// instant précis :
//   • « il est temps de partir »   — 25 min avant une activité à heure fixe
//   • « ça ferme bientôt »         — 1 h avant la fermeture d'un lieu prévu
//   • « le voyage commence demain » — la veille, à 18 h

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Marges choisies pour tomber juste une fois avec un passage toutes les 15 min.
const AVANT_DEPART_MIN = 25;
const FENETRE_MIN = 16;
const AVANT_FERMETURE_MIN = 60;
const NUIT_DEBUT = 22, NUIT_FIN = 7;

type Abo = {
  endpoint: string; p256dh: string; auth: string;
  user_id: string; fuseau: string; envoyes: Record<string, number>;
};

/** L'heure locale du voyageur, pas celle du serveur. */
function heureLocale(fuseau: string, quand = new Date()) {
  const f = new Intl.DateTimeFormat("fr-FR", {
    timeZone: fuseau, hour: "2-digit", minute: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit", hour12: false,
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(quand)) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    heure: Number(p.hour),
  };
}

const enMinutes = (h: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(h || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** L'heure de fermeture du jour, lue dans un champ `openingHours` d'OSM. */
function fermetureAujourdhui(horaires: string): number | null {
  if (!horaires) return null;
  const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(horaires);
  return m ? Number(m[3]) * 60 + Number(m[4]) : null;
}

/** Les rappels dus pour un voyage, à cet instant, dans ce fuseau. */
function rappels(trip: any, fuseau: string) {
  const out: { cle: string; titre: string; corps: string }[] = [];
  const local = heureLocale(fuseau);
  if (local.heure >= NUIT_DEBUT || local.heure < NUIT_FIN) return out;

  const dans = (min: number | null) =>
    min !== null && min - local.minutes > 0 && min - local.minutes <= FENETRE_MIN;

  // La veille du départ, à 18 h : c'est le moment où l'on fait son sac.
  const veille = new Date(`${trip.startDate}T00:00:00Z`);
  veille.setUTCDate(veille.getUTCDate() - 1);
  const dateVeille = veille.toISOString().slice(0, 10);
  if (local.date === dateVeille && local.minutes >= 18 * 60 && local.minutes < 18 * 60 + FENETRE_MIN) {
    const reste = (trip.packingList || []).filter((i: any) => !i.checked).length;
    out.push({
      cle: `depart:${trip.id}`,
      titre: `${trip.emoji || "✈️"} ${trip.name} — c'est demain`,
      corps: reste > 0 ? `Il reste ${reste} chose${reste > 1 ? "s" : ""} à mettre dans la valise.` : "Bon voyage.",
    });
  }

  const jour = (trip.days || []).find((d: any) => d.date === local.date);
  if (!jour) return out;

  for (const a of jour.activities || []) {
    if (!a || a.status === "done" || a.status === "nogo") continue;

    const debut = enMinutes(a.fixedStart);
    if (dans(debut === null ? null : debut - AVANT_DEPART_MIN)) {
      out.push({
        cle: `depart:${a.id}`,
        titre: `⏰ ${a.title}`,
        corps: `Dans ${debut! - local.minutes} min${a.address ? ` — ${a.address}` : ""}.`,
      });
      continue;
    }

    const ferme = fermetureAujourdhui(a.openingHours);
    if (dans(ferme === null ? null : ferme - AVANT_FERMETURE_MIN)) {
      out.push({
        cle: `fermeture:${a.id}`,
        titre: `🕐 ${a.title} ferme bientôt`,
        corps: `Fermeture dans ${ferme! - local.minutes} min.`,
      });
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Le déclencheur est public : un secret partagé évite qu'un tiers fasse
  // sonner les téléphones de tout le monde.
  const attendu = Deno.env.get("PUSH_TICK_SECRET");
  if (attendu && req.headers.get("x-provo-tick") !== attendu) {
    return json({ error: "non_autorise" }, 401);
  }

  const brutesCles = Deno.env.get("VAPID_KEYS");
  if (!brutesCles) return json({ error: "vapid_absent" }, 200);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service);

  const { data: abos, error } = await db
    .from("push_subscriptions").select("*").returns<Abo[]>();
  if (error) return json({ error: "abonnements_illisibles", detail: error.message }, 200);
  if (!abos?.length) return json({ ok: true, abonnes: 0, envoyes: 0 });

  const serveur = await webpush.ApplicationServer.new({
    contactInformation: "mailto:contact@provo.app",
    vapidKeys: await webpush.importVapidKeys(JSON.parse(brutesCles)),
  });

  const aujourdhui = new Date().toISOString().slice(0, 10);
  let envoyes = 0, retires = 0;

  for (const abo of abos) {
    const { data: voyages } = await db
      .from("trips").select("data").eq("owner_id", abo.user_id);
    if (!voyages?.length) continue;

    const dus: { cle: string; titre: string; corps: string }[] = [];
    for (const v of voyages) {
      const trip = v.data;
      if (!trip?.startDate || !trip?.endDate) continue;
      // Un voyage terminé ou lointain n'a rien à dire.
      if (trip.endDate < aujourdhui) continue;
      dus.push(...rappels(trip, abo.fuseau || "Europe/Paris"));
    }

    const dejaVus = abo.envoyes || {};
    // Un rappel envoyé reste marqué une semaine : assez pour ne pas se répéter,
    // assez peu pour que la colonne ne gonfle pas indéfiniment.
    const frais: Record<string, number> = {};
    const limite = Date.now() - 7 * 86400000;
    for (const [k, t] of Object.entries(dejaVus)) if (t > limite) frais[k] = t;

    const aEnvoyer = dus.filter(r => !frais[r.cle]);
    if (!aEnvoyer.length) continue;

    const abonne = serveur.subscribe({
      endpoint: abo.endpoint,
      keys: { p256dh: abo.p256dh, auth: abo.auth },
    } as any);

    for (const r of aEnvoyer) {
      try {
        await abonne.pushTextMessage(JSON.stringify({
          titre: r.titre, corps: r.corps, tag: r.cle, url: "/",
        }), {});
        frais[r.cle] = Date.now();
        envoyes++;
      } catch (e) {
        // 404 / 410 : l'abonnement est mort (app désinstallée, clé changée).
        // Le garder ferait sonner dans le vide à chaque passage.
        const s = String(e);
        if (s.includes("404") || s.includes("410")) {
          await db.from("push_subscriptions").delete().eq("endpoint", abo.endpoint);
          retires++;
        }
      }
    }
    await db.from("push_subscriptions").update({ envoyes: frais }).eq("endpoint", abo.endpoint);
  }

  return json({ ok: true, abonnes: abos.length, envoyes, retires });
});
