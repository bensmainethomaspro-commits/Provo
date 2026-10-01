/**
 * Un budget de temps pour TOUT un appel, pas seulement pour chaque requête.
 *
 * Chaque requête sortante avait déjà son délai (8 à 25 s), mais un appel en
 * enchaîne plusieurs : résoudre le lien, lire la page, géocoder, puis le
 * secours du géocodeur, puis le lecteur tiers. Additionnés, ils dépassaient la
 * minute (audit A-012). L'app coupe à 25 s depuis le 30 septembre 2026 et
 * propose la saisie à la main ; le serveur, lui, continuait de travailler
 * pour une réponse que personne n'attendait plus.
 *
 * Ici, l'appel reçoit un budget (20 s : sous les 25 s de l'app, pour que ce
 * qui a été trouvé arrive encore). Chaque `withTimeout` est plafonné par ce
 * qu'il en reste, et tout ce qui est en vol s'arrête quand il est épuisé ou
 * quand l'appelant raccroche. Les chemins d'extraction savent déjà traiter
 * une requête coupée : ils rendent ce qu'ils ont trouvé jusque-là.
 *
 * Le budget suit l'appel par le contexte asynchrone (`AsyncLocalStorage`),
 * pas par une variable de module : deux appels simultanés ne se coupent pas
 * l'un l'autre. Si l'hébergeur ne le fournit pas, on retombe exactement sur
 * le comportement d'avant (un délai par requête) au lieu de tomber en panne ;
 * `budgetActif()` le dit dans la réponse, pour que ça se voie.
 */

export const BUDGET_MS = 20000;

type Budget = { signal: AbortSignal; fin: number };

// deno-lint-ignore no-explicit-any
let contexte: any = null;
try {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  contexte = new AsyncLocalStorage();
} catch {
  contexte = null;
}

/**
 * Exécute `travail` sous un budget de `ms`. `parent` est le signal de la
 * requête entrante : l'appelant qui raccroche arrête le travail aussi.
 */
export async function dansLeBudget<T>(ms: number, parent: AbortSignal | null, travail: () => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), ms);
  const suivre = () => ctrl.abort();
  if (parent?.aborted) ctrl.abort();
  else parent?.addEventListener("abort", suivre, { once: true });
  try {
    const budget = { signal: ctrl.signal, fin: Date.now() + ms };
    return await (contexte ? contexte.run(budget, travail) : travail());
  } finally {
    clearTimeout(minuteur);
    parent?.removeEventListener("abort", suivre);
  }
}

/**
 * Un délai pour UNE requête, plafonné par le budget de l'appel en cours.
 *
 * `clear()` arrête le minuteur de la requête, mais la laisse attachée au
 * budget : un corps de réponse lu au compte-gouttes après l'en-tête s'arrête
 * quand même à la fin du budget.
 */
export function withTimeout(ms: number) {
  const budget: Budget | undefined = contexte?.getStore();
  const reste = budget ? Math.max(0, budget.fin - Date.now()) : ms;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), Math.min(ms, reste));
  if (budget) {
    if (budget.signal.aborted) ctrl.abort();
    else budget.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

/** Vrai si un budget suit cet appel (faux : l'hébergeur ne porte pas le contexte). */
export function budgetActif(): boolean {
  return !!contexte?.getStore();
}
