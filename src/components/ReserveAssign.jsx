import { useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, nomDeLieu } from '../utils/helpers';
import { vibrate } from '../hooks/useSettings';

/**
 * Assigner une idée de la Réserve à un jour.
 *
 * Auparavant, chaque fiche affichait une pastille par jour du voyage, en
 * permanence : sur un voyage de six jours, ce bloc était plus haut que la fiche
 * qu'il accompagnait, et huit idées demandaient 1 750 px de défilement. On ne
 * choisit un jour qu'au moment de piocher — le reste du temps, ça n'est que du
 * bruit entre soi et l'idée suivante.
 *
 * Puis le bouton lui-même a coûté sa rangée : 52 px sous chaque fiche, dont
 * 250 px de vide à gauche du bouton. Il vit maintenant DANS la rangée du haut
 * de la fiche, à côté du ⋯ — cette rangée fait déjà 60 px de haut à cause de
 * la vignette, le bouton n'y coûte donc aucune hauteur.
 *
 * La grille des jours passe par un PORTAIL, comme le menu ⋯ juste à côté :
 * la fiche de la Réserve porte `content-visibility: auto` et `overflow:
 * hidden`, qui découpent tout calque dessiné dedans. C'est le piège qui a déjà
 * frappé trois fois dans ce projet.
 */
export default function ReserveAssign({ days, onAssign, titre }) {
  const [open, setOpen] = useState(false);
  if (!days?.length) return null;

  return (
    <>
      <button
        type="button"
        className={`reserve-assign__toggle${open ? ' reserve-assign__toggle--on' : ''}`}
        aria-expanded={open}
        aria-label="Assigner à un jour"
        title="Assigner à un jour"
        onClick={(e) => { e.stopPropagation(); setOpen(true); vibrate([6]); }}
      >
        {/* Un signe typographique, pas un émoji : tous les émojis de calendrier
            portent un quantième (17), et une fiche PAS ENCORE assignée qui
            affiche une date se lit comme une fiche déjà posée. Le « + » se
            range à côté du ⋯ comme deux commandes de même famille. */}
        <span aria-hidden="true">＋</span>
      </button>

      {open && createPortal(
        <div className="act-sheet-overlay" onClick={() => setOpen(false)}>
          <div className="act-sheet" onClick={e => e.stopPropagation()}>
            <div className="act-sheet__title">
              {titre ? `${nomDeLieu(titre)} — quel jour ?` : 'Quel jour ?'}
            </div>
            <div className="reserve-assign__days">
              {days.map((d, i) => {
                // « lundi 3 août » → « lun. 3 » : la colonne est étroite, et le
                // numéro du jour suffit à se repérer.
                const [jour, num] = formatDate(d.date).split(' ');
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="reserve-assign__day"
                    onClick={() => { onAssign(d.id); setOpen(false); vibrate([10]); }}
                  >
                    <span className="reserve-assign__day-num">J{i + 1}</span>
                    <span className="reserve-assign__day-date">{jour?.slice(0, 3)}. {num}</span>
                  </button>
                );
              })}
            </div>
            <button className="act-sheet__cancel" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
