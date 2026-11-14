/**
 * La fonction `extract-place` quand Google répond « êtes-vous un robot ? ».
 *
 * Réseau simulé, mais sous Deno : le moteur de la fonction, et la fonction
 * ENTIÈRE (son vrai `index.ts`, pas un extrait). C'est la leçon du 13 novembre
 * 2026 — une mesure doit ressembler à ce qu'elle mesure — appliquée à un cas
 * que le réseau réel ne rejoue pas à la demande : Google ne sert pas son
 * captcha sur commande.
 *
 * Le banc du 14 novembre 2026 l'a croisé par hasard : le lien du signalement,
 * refusé aux deux robots puis au navigateur, est ressorti en fiche intitulée
 * « EgQDKdJFGNba4NcGIjCUk8Qh… » — le jeton de la page de vérification, lu
 * comme le nom du lieu.
 *
 * Usage (aucun accès réseau n'est accordé : tout appel réel échouerait) :
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-prompt --allow-env scripts/verif-fonction-captcha.ts
 *
 * Lancé par `verif.yml` sur chaque PR. `npm run verif` ne le lance pas : il
 * tourne sous Node, et ce test n'a de valeur que sous le moteur de la fonction.
 */
const LIEN = "https://share.google/y4QMh42nQx6DiSBfZ";
const JETON = "EgQDKdJFGNba4NcGIjCUk8QhWqzylJ4p_e5Kjpaqd6e2DTECigX3mTgQbxUkBsfyMj1kTv";
const VOULUE = "https://www.google.com/search?q=ADEVA+Cucina+Moderna&kgmid=/g/11x9d2brwt";

// Ce que le réseau répond dans le scénario en cours.
let scenario: { suite: string | null } = { suite: VOULUE };
const appels: string[] = [];

const sorry = () =>
  `https://www.google.com/sorry/index?${scenario.suite ? `continue=${encodeURIComponent(scenario.suite)}&` : ""}q=${JETON}`;
const page = (corps: string, status = 200, type = "text/html; charset=utf-8") =>
  new Response(corps, { status, headers: { "content-type": type } });
const json = (objet: unknown) => page(JSON.stringify(objet), 200, "application/json");

const ROME = { lat: 41.9021142, lon: 12.484738 };
const photon = (nom: string, lat: number, lon: number, p: Record<string, unknown>) => ({
  geometry: { coordinates: [lon, lat] }, properties: { name: nom, ...p },
});
const ADEVA = photon("ADEVA Cucina Moderna", ROME.lat, ROME.lon, {
  osm_key: "amenity", osm_value: "restaurant", housenumber: "29", street: "Via dei Maroniti",
  city: "Rome", country: "Italie", countrycode: "IT",
});
const BIARRITZ = photon("Biarritz", 43.4832, -1.5586, {
  osm_key: "place", osm_value: "town", city: "Biarritz", country: "France", countrycode: "FR",
  extent: [-1.58, 43.50, -1.53, 43.45],
});

globalThis.fetch = ((entree: string | URL | Request) => {
  const adresse = String(entree instanceof Request ? entree.url : entree);
  appels.push(adresse);
  const u = new URL(adresse);
  // Le lien de partage : Google renvoie tout le monde à sa vérification.
  if (u.hostname === "share.google") {
    return Promise.resolve(new Response(null, { status: 302, headers: { location: sorry() } }));
  }
  if (/(^|\.)google\.com$/.test(u.hostname) && u.pathname.startsWith("/sorry/")) {
    // Le titre de cette page est l'adresse demandée : lui non plus n'est pas un nom.
    return Promise.resolve(page(`<html><head><title>${scenario.suite || adresse}</title></head><body>unusual traffic</body></html>`, 429));
  }
  // Le point demandé à Google Maps par le nom : refusé lui aussi.
  if (/(^|\.)google\.com$/.test(u.hostname)) {
    return Promise.resolve(new Response(null, { status: 302, headers: { location: sorry() } }));
  }
  // Nominatim refuse l'hébergeur de la fonction, comme en production.
  if (u.hostname === "nominatim.openstreetmap.org") return Promise.resolve(page("refusé", 403));
  if (u.hostname === "photon.komoot.io") {
    if (u.pathname === "/reverse") return Promise.resolve(json({ features: [ADEVA] }));
    const q = (u.searchParams.get("q") || "").toLowerCase();
    if (q.includes("adeva")) return Promise.resolve(json({ features: [ADEVA] }));
    if (q.includes("biarritz")) return Promise.resolve(json({ features: [BIARRITZ] }));
    return Promise.resolve(json({ features: [] }));
  }
  return Promise.resolve(page("", 404));
}) as typeof fetch;

// La fonction s'enregistre par `Deno.serve` : on garde ce qu'elle y pose.
let fonction: ((req: Request) => Response | Promise<Response>) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: (req: Request) => Response | Promise<Response>) => {
  fonction = h;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};
await import("../supabase/functions/extract-place/index.ts");

let ok = 0, ko = 0;
const verifier = (nom: string, cond: boolean, detail = "") => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); }
  else { ko++; console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ""}`); }
};
// Ce que l'app envoie : le lien ET la destination du voyage.
const demander = async () => {
  appels.length = 0;
  const r = await fonction!(new Request("http://fonction.test/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: LIEN, destination: "Biarritz" }),
  }));
  return await r.json();
};
// deno-lint-ignore no-explicit-any
const titreSain = (d: any) => !/EgQD|sorry|https?:/i.test(JSON.stringify(d?.result ?? {}).replace(LIEN, ""));

verifier("la fonction s’est enregistrée", typeof fonction === "function");

console.log("\n1 · Refusé partout, mais la vérification dit où elle menait");
{
  scenario = { suite: VOULUE };
  const d = await demander();
  const t = JSON.stringify(d);
  verifier("le nom vient de l’adresse voulue, pas du jeton", d?.result?.title === "ADEVA Cucina Moderna", t);
  verifier("la fiche est posée à Rome, avec son adresse",
    Math.abs(d?.result?.lat - ROME.lat) < 0.01 && /Maroniti/.test(d?.result?.address || ""), t);
  verifier("rien de la page de vérification n’est entré dans la fiche", titreSain(d), t);
  verifier("la trace le dit", (d?.geocodeurs || []).includes("page-google captcha (suite lue)"), JSON.stringify(d?.geocodeurs));
  verifier("le lien d’origine reste celui de l’utilisateur", d?.result?.link === LIEN, t);
}

console.log("\n2 · Refusé partout, et la vérification ne dit rien");
{
  scenario = { suite: null };
  const d = await demander();
  const t = JSON.stringify(d);
  verifier("aucune fiche plutôt qu’une fiche au nom du jeton", d?.error === "no_data" || titreSain(d), t);
  verifier("… et pas de titre du tout tiré de cette page", d?.error === "no_data", t);
}

console.log("\n3 · La vérification renvoie au lien lui-même : il ne nomme rien");
{
  scenario = { suite: LIEN };
  const d = await demander();
  verifier("aucune fiche inventée", d?.error === "no_data", JSON.stringify(d));
}

console.log("\n4 · Rien n’est sorti du réseau simulé");
verifier("tous les appels ont été servis par le simulacre", appels.length > 0 && appels.every((a) => /^https:\/\//.test(a)));

console.log(`\n${ok} réussis, ${ko} échoués`);
Deno.exit(ko ? 1 : 0);
