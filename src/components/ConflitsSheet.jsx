/**
 * Ce qui a changé ailleurs, au même moment que toi.
 *
 * Deux téléphones (les tiens, ou ceux de deux voyageurs) modifient le même
 * champ avant d'avoir vu la version de l'autre : il faut un gagnant, et c'est
 * le serveur. Il gagnait en silence, et « ton » montant se retrouvait remplacé
 * sans que tu saches quand ni pourquoi.
 *
 * La version en place reste celle d'ailleurs : rien ne clignote d'un appareil à
 * l'autre. Cette feuille le dit, montre les deux versions et laisse remettre la
 * sienne. Elle propose, elle n'impose rien (principe produit) : la fermer
 * revient à tout laisser ainsi.
 */
import Icone from './Icone';
import { X } from 'lucide-react';

export default function ConflitsSheet({ groupes, onRemettre, onLaisser, onClose }) {
  if (!groupes.length) return null;
  const plusieurs = groupes.length > 1;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--check" role="dialog" aria-modal="true" aria-label="Modifié ailleurs en même temps"
        onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__header">
          <span className="sheet__title">Modifié ailleurs en même temps</span>
          <button className="sheet__close" onClick={onClose} aria-label="Fermer"><Icone de={X} /></button>
        </div>

        <div className="sheet__body">
          <p className="enrich-intro">
            {plusieurs
              ? `${groupes.length} fiches ont changé ailleurs pendant que tu les modifiais. L'autre version est en place : tu peux remettre la tienne.`
              : "Cette fiche a changé ailleurs pendant que tu la modifiais. L'autre version est en place : tu peux remettre la tienne."}
          </p>

          {groupes.map(g => (
            <div key={g.cle} className="check-card conflit-card">
              <div className="check-card__head">
                <span className="check-card__title">{g.nom || g.genre}</span>
                <span className="check-card__where">{g.genre}</span>
              </div>

              {g.supprime ? (
                <p className="check-card__why">Supprimée ailleurs alors que tu venais de la modifier.</p>
              ) : (
                <dl className="conflit-card__lignes">
                  {g.lignes.map((l, i) => (
                    <div key={i} className="conflit-card__ligne">
                      <dt>{l.champ}</dt>
                      <dd>
                        <span className="conflit-card__leur">Ailleurs : {l.leur}</span>
                        <span className="conflit-card__mien">Toi : {l.mien}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="check-card__actions">
                <button className="btn btn--ghost btn--sm check-card__skip" onClick={() => onLaisser(g)}>
                  {g.supprime ? 'Laisser supprimée' : 'Laisser ainsi'}
                </button>
                <button className="btn btn--primary btn--sm" onClick={() => onRemettre([g])}>
                  {g.supprime ? 'La remettre' : 'Remettre la mienne'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {plusieurs && (
          <div className="sheet__footer">
            <button className="btn btn--ghost" onClick={onClose}>Tout laisser</button>
            <button className="btn btn--primary" onClick={() => onRemettre(groupes)}>
              Tout remettre ({groupes.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
