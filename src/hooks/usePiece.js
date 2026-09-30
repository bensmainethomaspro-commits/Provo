import { useEffect, useState } from 'react';
import { estRef, idDe, lirePiece, pieceEnMemoire, EVENEMENT } from '../utils/pieces';

/**
 * Ce qu'il faut mettre dans un `src` pour une valeur du voyage : elle-même si
 * c'est une adresse ou une donnée en clair, le contenu rangé sur ce téléphone
 * si c'est une référence `pj:…` (voir utils/pieces.js), `null` tant qu'elle
 * n'y est pas. L'écran se met à jour dès qu'elle arrive du nuage.
 */
export function usePiece(valeur) {
  const ref = estRef(valeur);
  const [lu, setLu] = useState(() => ({ valeur, src: ref ? pieceEnMemoire(idDe(valeur)) ?? null : null }));

  useEffect(() => {
    if (!ref) return undefined;
    let vivant = true;
    const lire = () => lirePiece(idDe(valeur))
      .then(d => { if (vivant && d) setLu({ valeur, src: d }); })
      .catch(() => {});
    lire();
    window.addEventListener(EVENEMENT, lire);
    return () => { vivant = false; window.removeEventListener(EVENEMENT, lire); };
  }, [valeur, ref]);

  if (!ref) return valeur || null;
  return lu.valeur === valeur ? lu.src : (pieceEnMemoire(idDe(valeur)) ?? null);
}
