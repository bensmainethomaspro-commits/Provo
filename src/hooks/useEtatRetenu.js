import { useState, useEffect } from 'react';

/**
 * Un état qui survit au changement d'écran.
 *
 * Revenir sur la Réserve après un aller-retour et retrouver le filtre remis à
 * zéro, la recherche effacée et la liste rembobinée, c'est refaire à chaque
 * fois le tri qu'on venait de faire. Sur l'écran le plus utilisé du produit,
 * c'est un impôt permanent.
 *
 * Rangé par voyage : deux voyages n'ont pas les mêmes catégories ni les mêmes
 * idées, et hériter du filtre de l'autre serait pire que de repartir à zéro.
 */
const lire = (cle, defaut) => {
  if (!cle) return defaut;
  try {
    const brut = localStorage.getItem(`provo_vue_${cle}`);
    return brut === null ? defaut : JSON.parse(brut);
  } catch { return defaut; }
};

export function useEtatRetenu(cle, valeurParDefaut) {
  // L'état porte sa clé avec lui : quand on ouvre un autre voyage, la
  // différence se voit pendant le rendu et se corrige tout de suite. C'est le
  // schéma recommandé pour un état qui dépend d'une prop — un effet ferait un
  // rendu de plus, avec la vue du voyage précédent entre les deux.
  const [etat, setEtat] = useState(() => ({ cle, valeur: lire(cle, valeurParDefaut) }));
  if (etat.cle !== cle) setEtat({ cle, valeur: lire(cle, valeurParDefaut) });

  useEffect(() => {
    if (!cle) return;
    try { localStorage.setItem(`provo_vue_${cle}`, JSON.stringify(etat.valeur)); }
    catch { /* quota : ce n'est qu'un confort, jamais une donnée du voyage */ }
  }, [cle, etat.valeur]);

  const poser = (v) => setEtat(e => ({
    cle, valeur: typeof v === 'function' ? v(e.valeur) : v,
  }));

  return [etat.cle === cle ? etat.valeur : lire(cle, valeurParDefaut), poser];
}
