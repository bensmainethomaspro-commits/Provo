// Pourquoi la FONCTION n'obtient-elle pas le point que la sonde obtient ?
//
// Le 13 novembre 2026, deux bancs de suite : depuis `extract-place` (Deno), la
// page Google Maps d'une recherche expire au bout de six secondes ; depuis
// `diag-lien-google.mjs` (Node), la même adresse, les mêmes en-têtes, répond en
// moins d'une seconde. Ce script refait la demande sous Deno, variante par
// variante, et dit où passe le temps : avant les en-têtes, ou dans le corps.
//
// Usage :  deno run --allow-net scripts/diag-deno-google.ts
const ROBOT = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const TEMOIN = "CONSENT=YES+cb.20240101-00-p0.fr+FX+000; SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmZyIAEaBgiA0K2tBg";
const NOM = "Palais du Belvedere, Vienne Autriche";
const BASE = "https://www.google.com/maps/search/?api=1&query=";

async function essai(quoi: string, url: string, entetes: Record<string, string>, init: Record<string, unknown> = {}) {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 25000);
  let etape = "avant les en-têtes";
  try {
    const r = await fetch(url, { headers: entetes, signal: ctrl.signal, redirect: "manual", ...init });
    const tEntetes = ms();
    etape = "dans le corps";
    let octets = 0, tPremier = -1, tImage = -1, oImage = -1, texte = "";
    const dec = new TextDecoder("latin1");
    const lecteur = r.body?.getReader();
    while (lecteur) {
      const { done, value } = await lecteur.read();
      if (done) break;
      if (tPremier < 0) tPremier = ms();
      octets += value.length;
      if (oImage < 0) {
        texte += dec.decode(value, { stream: true });
        oImage = texte.search(/og:image/);
        if (oImage >= 0) tImage = ms();
      }
    }
    console.log(`  ${quoi.padEnd(34)} ${r.status} · en-têtes ${tEntetes} ms · 1er octet ${tPremier} ms · og:image à l'octet ${oImage} (${tImage} ms) · fin ${ms()} ms · ${octets} o`
      + ` · ${r.headers.get("content-encoding") || "non compressé"}${r.headers.get("location") ? ` · → ${r.headers.get("location")!.slice(0, 80)}` : ""}`);
  } catch (e) {
    console.log(`  ${quoi.padEnd(34)} ERREUR ${(e as Error).name} ${etape}, après ${ms()} ms`);
  } finally {
    clearTimeout(minuteur);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(`Deno ${Deno.version.deno} — « ${NOM} »`);
const fonction = { "User-Agent": ROBOT, "Accept-Language": "fr,en;q=0.8", "Cookie": TEMOIN };
await essai("comme la fonction", BASE + encodeURIComponent(NOM), fonction);
await essai("espaces en « + » (comme la sonde)", BASE + encodeURIComponent(NOM).replace(/%20/g, "+"), fonction);
await essai("sans compression", BASE + encodeURIComponent(NOM), { ...fonction, "Accept-Encoding": "identity" });
await essai("sans témoin de consentement", BASE + encodeURIComponent(NOM), { "User-Agent": ROBOT, "Accept-Language": "fr,en;q=0.8" });
await essai("robot Twitter", BASE + encodeURIComponent(NOM), { ...fonction, "User-Agent": "Twitterbot/1.0" });
try {
  // deno-lint-ignore no-explicit-any
  const client = (Deno as any).createHttpClient({ http2: false });
  await essai("HTTP/1.1 forcé", BASE + encodeURIComponent(NOM), fonction, { client });
} catch (e) {
  console.log(`  HTTP/1.1 forcé : indisponible (${(e as Error).message.slice(0, 60)})`);
}
await essai("comme la fonction, une 2e fois", BASE + encodeURIComponent(NOM), fonction);
