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
 * La cible rendue porte AUSSI sa journée : dans un planning, déposer une
 * activité sur un autre jour est le geste le plus naturel, et le refuser
 * obligeait à passer par un menu, un cran à la fois.
 *
 * @param {(id: string, cible: {id: string|null, jour: string|null}) => void} onDeplacer
 */
export function useReorderDrag(onDeplacer) {
  const [dragId, setDragId] = useState(null);
  const [sur, setSur] = useState(null);
  const etat = useRef({ id: null, sur: null });

  const finir = useCallback(() => {
    const { id, sur: cible } = etat.current;
    // Déposer sur soi-même n'est pas un déplacement ; déposer dans le vide non
    // plus. Dans les deux cas on ne touche à rien.
    if (id && cible && (cible.id !== id || cible.jour)) onDeplacer(id, cible);
    etat.current = { id: null, sur: null };
    setDragId(null);
    setSur(null);
  }, [onDeplacer]);

  const demarrer = useCallback((id, e) => {
    // Un bouton dans la carte ne doit pas déclencher un déplacement.
    e.preventDefault();
    e.stopPropagation();
    etat.current = { id, sur: null };
    setDragId(id);

    // La barre d'onglets et l'en-tête flottent au-dessus de la liste. Sous eux,
    // `elementFromPoint` renvoie la barre : le doigt est « sur » elle sans avoir
    // quitté la liste pour autant.
    const surUnCalqueFlottant = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') return true;
      }
      return false;
    };

    const cible = (ev) => {
      const t = ev.touches?.[0] || ev;
      // Le doigt est sorti de l'écran par le bas ou par le côté. Ce n'est pas
      // « le vide » : c'est le bord. On garde la dernière cible connue, sinon
      // un geste qui dépasse d'un pixel annule tout.
      if (t.clientX < 0 || t.clientY < 0
        || t.clientX > window.innerWidth || t.clientY > window.innerHeight) {
        return etat.current.sur;
      }
      const el = document.elementFromPoint(t.clientX, t.clientY);
      // Sur une fiche : on se place devant elle.
      const fiche = el?.closest('[data-reorder-id]');
      if (fiche) return { id: fiche.dataset.reorderId, jour: fiche.dataset.jourId || null };
      // Ailleurs dans une journée — son en-tête, son espace vide : on y entre,
      // à la fin. Sans ça, une journée vide serait impossible à viser.
      const jour = el?.closest('[data-day-id]');
      if (jour) return { id: null, jour: jour.dataset.dayId };
      // Les quatre-vingt-dix derniers pixels de l'écran sont couverts par la
      // barre d'onglets. Une fiche qui tombe dessous devenait impossible à
      // viser : la cible passait à « rien », et relâcher là ne déplaçait
      // rien — sans un mot. On garde la dernière cible connue.
      if (surUnCalqueFlottant(el)) return etat.current.sur;
      // Vraiment dans le vide : c'est l'échappatoire, on annule.
      return null;
    };

    const memeCible = (a, b) => a?.id === b?.id && a?.jour === b?.jour;

    // Dans le planning, les journées défilent horizontalement : le lendemain
    // n'est visible que sur quelques pixels. Sans ce défilement au bord, on ne
    // pourrait déposer que sur la tranche du jour suivant — autant dire nulle
    // part. Le conteneur se cherche une fois, au départ du geste.
    // Chaque axe a son conteneur : la frise défile horizontalement, la page
    // verticalement. Rendre le premier ancêtre défilant tout court renverrait
    // la carte du jour, qui défile en hauteur — et la frise ne bougerait
    // jamais.
    const chercher = (axe) => {
      let n = e.target;
      while (n && n !== document.body) {
        const st = getComputedStyle(n);
        const debordeX = n.scrollWidth > n.clientWidth + 4;
        const debordeY = n.scrollHeight > n.clientHeight + 4;
        if (axe === 'x' && /(auto|scroll)/.test(st.overflowX) && debordeX) return n;
        if (axe === 'y' && /(auto|scroll)/.test(st.overflowY) && debordeY) return n;
        n = n.parentElement;
      }
      return null;
    };
    const defilantX = chercher('x');
    const defilantY = chercher('y');
    // La frise est magnétique (`scroll-snap-type: x mandatory`) : chaque petit
    // incrément était ramené à la journée la plus proche, et le défilement au
    // bord n'avançait jamais. On suspend le magnétisme le temps du geste, et
    // on le rend en relâchant — c'est lui qui recale proprement.
    const snapInitial = defilantX?.style.scrollSnapType ?? null;
    if (defilantX) defilantX.style.scrollSnapType = 'none';
    // Le défilement ne doit s'amorcer que quand on cherche à QUITTER la
    // journée de départ. Une marge fixe au bord du conteneur se déclencherait
    // dès le premier pixel : la poignée est à quinze pixels du bord gauche, et
    // un simple réordonnancement vertical ferait défiler toute la frise.
    const depart = e.target.closest('[data-day-id]')?.getBoundingClientRect() || null;
    // Une journée fait environ 350 px : à 6 px par image, il en passe une par
    // seconde. Assez vif pour ne pas attendre, assez lent pour viser — à 14 px
    // on traversait deux jours et demi par seconde, impossible à arrêter au bon
    // endroit.
    const PAS = 6;
    let pointeur = null, boucle = 0;
    const defiler = () => {
      boucle = 0;
      if (!pointeur) return;
      let bouge = false;
      if (defilantX && depart) {
        if (pointeur.x < depart.left) { defilantX.scrollLeft -= PAS; bouge = true; }
        else if (pointeur.x > depart.right) { defilantX.scrollLeft += PAS; bouge = true; }
      }
      if (defilantY) {
        const r = defilantY.getBoundingClientRect();
        // Verticalement, une marge suffit : rien ne démarre au bord.
        if (pointeur.y < r.top + 56) { defilantY.scrollTop -= PAS; bouge = true; }
        else if (pointeur.y > r.bottom - 56) { defilantY.scrollTop += PAS; bouge = true; }
      }
      // Tant que le doigt reste au bord, on continue : un seul pas par
      // déplacement ne suffirait pas quand le doigt s'immobilise.
      if (bouge) boucle = requestAnimationFrame(defiler);
    };

    const bouger = (ev) => {
      // Sans ça, le geste fait défiler la page au lieu de déplacer la carte.
      if (ev.cancelable) ev.preventDefault();
      const pt = ev.touches?.[0] || ev;
      pointeur = { x: pt.clientX, y: pt.clientY };
      if (!boucle) boucle = requestAnimationFrame(defiler);
      const c = cible(ev);
      if (!memeCible(c, etat.current.sur)) {
        etat.current.sur = c;
        setSur(c);
      }
    };
    const lacher = () => {
      if (boucle) cancelAnimationFrame(boucle);
      boucle = 0; pointeur = null;
      if (defilantX) defilantX.style.scrollSnapType = snapInitial || '';
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

  // `surId` reste exposé pour les listes à une seule dimension, qui n'ont pas
  // de journée à connaître.
  return { dragId, sur, surId: sur?.id ?? null, demarrer };
}
