import { useRef, useState, useCallback } from 'react';

/**
 * Réordonner une liste au doigt.
 *
 * Le glisser-déposer HTML5 (`draggable`, `dragstart`, `drop`) ne fonctionne pas
 * au tactile : sur iPhone il ne se passe strictement rien. Comme l'app est
 * mobile d'abord, c'est la seule chose qui compte. Les événements pointeur,
 * eux, couvrent la souris et le doigt avec le même code.
 *
 * On lit la cible sous le doigt à chaque déplacement plutôt que de calculer des
 * positions : la liste peut défiler, changer de hauteur, contenir des cartes de
 * tailles différentes — `elementFromPoint` reste juste dans tous les cas.
 *
 * @param {(id: string, cibleId: string|null) => void} onDeplacer
 */
export function useReorderDrag(onDeplacer) {
  const [dragId, setDragId] = useState(null);
  const [surId, setSurId] = useState(null);
  const etat = useRef({ id: null, sur: null });

  const finir = useCallback(() => {
    const { id, sur } = etat.current;
    if (id && sur && id !== sur) onDeplacer(id, sur);
    etat.current = { id: null, sur: null };
    setDragId(null);
    setSurId(null);
  }, [onDeplacer]);

  const demarrer = useCallback((id, e) => {
    // Un bouton dans la carte ne doit pas déclencher un déplacement.
    e.preventDefault();
    e.stopPropagation();
    etat.current = { id, sur: null };
    setDragId(id);

    const cible = (ev) => {
      const t = ev.touches?.[0] || ev;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      return el?.closest('[data-reorder-id]')?.dataset.reorderId || null;
    };

    const bouger = (ev) => {
      // Sans ça, le geste fait défiler la page au lieu de déplacer la carte.
      if (ev.cancelable) ev.preventDefault();
      const sur = cible(ev);
      if (sur !== etat.current.sur) {
        etat.current.sur = sur;
        setSurId(sur);
      }
    };
    const lacher = () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', lacher);
      window.removeEventListener('pointercancel', lacher);
      window.removeEventListener('touchmove', bouger);
      finir();
    };

    window.addEventListener('pointermove', bouger, { passive: false });
    window.addEventListener('pointerup', lacher);
    window.addEventListener('pointercancel', lacher);
    // Safari iOS n'émet pas toujours `pointermove` pendant un défilement
    // naissant : `touchmove` non passif est ce qui bloque effectivement le
    // défilement de la page.
    window.addEventListener('touchmove', bouger, { passive: false });
  }, [finir]);

  return { dragId, surId, demarrer };
}
