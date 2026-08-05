/**
 * Ce que l'app a remarqué en posant l'activité.
 *
 * Elle a déjà agi — l'activité est dans la journée. Ce pop-up ne demande pas
 * la permission, il **dit ce qu'on n'aurait pas vu** : le lieu est fermé, la
 * journée déborde, c'est à l'autre bout de la ville. Rien n'est réorganisé,
 * rien n'est bloqué ; on garde, ou on annule.
 */
export default function PropositionSheet({ titre, jour, signaux, onGarder, onAnnuler }) {
  if (!signaux?.length) return null;

  return (
    <div className="sheet-overlay" onClick={onGarder}>
      <div className="sheet sheet--proposition" onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__header">
          <span className="sheet__title">💡 À savoir</span>
          <button className="sheet__close" onClick={onGarder} aria-label="Fermer">✕</button>
        </div>

        <div className="sheet__body">
          <p className="proposition__intro">
            <strong>{titre}</strong> est {jour ? `dans le ${jour.toLowerCase()}` : 'dans la journée'}.
          </p>

          <ul className="proposition__liste">
            {signaux.map(s => (
              <li key={s.cle} className="proposition__item">
                <span className="proposition__icone" aria-hidden="true">{s.icone}</span>
                <span>{s.texte}</span>
              </li>
            ))}
          </ul>

          {/* Le produit propose, il ne corrige pas d'office. Le dire évite de
              chercher le bouton qui « arrange » — il n'y en a pas. */}
          <p className="proposition__note">Rien n'a été réorganisé. À toi de voir.</p>
        </div>

        <div className="sheet__footer">
          <button className="btn btn--ghost" onClick={onAnnuler}>Annuler l'ajout</button>
          <button className="btn btn--primary" onClick={onGarder}>Garder</button>
        </div>
      </div>
    </div>
  );
}
