/**
 * Une confirmation qu'on sent plutôt qu'on lit.
 *
 * Cocher une activité, piocher une idée, valider une dépense : ces gestes se
 * font en marchant, l'écran à peine regardé. Une brève vibration confirme sans
 * demander de lire.
 *
 * **Sans effet sur iPhone** : Safari n'implémente pas `navigator.vibrate`.
 * C'est un bonus pour Android, jamais un canal d'information — rien de ce qui
 * compte ne doit passer uniquement par là.
 */

// Trois durées, pas dix : un vocabulaire court reste lisible. Assez brèves pour
// confirmer sans faire sursauter.
const MOTIFS = {
  leger: 10,      // un choix, un filtre
  valide: [0, 18, 40, 18],  // quelque chose a été fait
  refus: 45,      // impossible, ou annulé
};

let actif = true;
/** Coupé avec les animations : qui refuse le mouvement refuse la vibration. */
try {
  actif = !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
} catch { /* pas de matchMedia : on laisse actif */ }

export function toucher(motif = 'leger') {
  if (!actif) return;
  const v = MOTIFS[motif] ?? MOTIFS.leger;
  try { navigator.vibrate?.(v); } catch { /* refusé par le navigateur */ }
}
