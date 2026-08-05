import { getCategoryMeta } from '../utils/helpers';
import { formatDistance } from '../hooks/useLiveLocation';

/**
 * Ce qui, dans ta Réserve, tient dans le temps qu'il te reste.
 *
 * Rien n'est inventé ni cherché en ligne : ce sont tes propres idées, filtrées
 * par l'heure, la météo et la distance. L'app ne décide pas — elle évite de
 * relire trente fiches debout dans la rue.
 */
export default function PiocheSheet({ resultat, onPiocher, onClose }) {
  if (!resultat) return null;
  const { minutes, pluie, idees, ecartees } = resultat;

  const duree = minutes >= 60
    ? `${Math.floor(minutes / 60)} h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`
    : `${minutes} min`;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--pioche" onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__header">
          <span className="sheet__title">🎯 Il te reste {duree}</span>
          <button className="sheet__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="sheet__body">
          {idees.length === 0 ? (
            <p className="pioche__vide">
              Rien dans ta Réserve ne tient dans ce créneau
              {pluie ? ' à couvert' : ''}
              {ecartees ? ` — ${ecartees} idée${ecartees > 1 ? 's' : ''} écartée${ecartees > 1 ? 's' : ''} (fermé, trop loin ou trop long).` : '.'}
            </p>
          ) : (
            <>
              <p className="pioche__intro">
                {pluie && '🌧️ Il pleut — '}
                {idees.length} idée{idees.length > 1 ? 's' : ''} de ta Réserve
                {pluie ? ' à couvert' : ''} qui tiennent dans ce créneau.
              </p>
              <ul className="pioche__liste">
                {idees.map(({ activite, km, marche, duree: d }) => (
                  <li key={activite.id}>
                    <button className="pioche__item" onClick={() => onPiocher(activite.id)}>
                      <span className="pioche__emoji" aria-hidden="true">
                        {getCategoryMeta(activite.category).emoji}
                      </span>
                      <span className="pioche__texte">
                        <strong className="pioche__titre">{activite.title}</strong>
                        <small className="pioche__meta">
                          {d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? String(d % 60).padStart(2, '0') : ''}` : `${d} min`}
                          {km != null && ` · à ${formatDistance(km)}`}
                          {km != null && marche > 0 && ` (${marche} min à pied)`}
                        </small>
                      </span>
                      <span className="pioche__cta" aria-hidden="true">＋</span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* Ce qui a été écarté se dit : sans ça, une Réserve pleine qui
                  ne propose que deux idées ressemble à une panne. */}
              {ecartees > 0 && (
                <p className="pioche__ecartees">
                  {ecartees} autre{ecartees > 1 ? 's' : ''} écartée{ecartees > 1 ? 's' : ''} : fermé, trop loin, ou plus long que le temps restant.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
