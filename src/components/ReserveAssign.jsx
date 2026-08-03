import { useState } from 'react';
import { formatDate } from '../utils/helpers';
import { vibrate } from '../hooks/useSettings';

/**
 * Assigner une idée de la Réserve à un jour.
 *
 * Auparavant, chaque fiche affichait une pastille par jour du voyage, en
 * permanence : sur un voyage de six jours, ce bloc était plus haut que la fiche
 * qu'il accompagnait, et huit idées demandaient 1 750 px de défilement. On ne
 * choisit un jour qu'au moment de piocher — le reste du temps, ça n'est que du
 * bruit entre soi et l'idée suivante.
 */
export default function ReserveAssign({ days, onAssign }) {
  const [open, setOpen] = useState(false);
  if (!days?.length) return null;

  return (
    <div className={`reserve-assign${open ? ' reserve-assign--open' : ''}`}>
      <button
        type="button"
        className="reserve-assign__toggle"
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); vibrate([6]); }}
      >
        <span className="reserve-assign__toggle-label">Assigner</span>
        <span className="reserve-assign__chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
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
      )}
    </div>
  );
}
