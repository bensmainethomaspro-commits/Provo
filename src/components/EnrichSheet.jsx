import { useState } from 'react';

/**
 * Ce que l'app a trouvé sur le site du lieu — à confirmer.
 *
 * Elle a cherché toute seule, mais elle n'écrit rien sans accord : une
 * description inventée ou un prix approximatif dans le budget se remarquent
 * trop tard. Chaque champ se voit avant d'être accepté (principe produit —
 * force de proposition, en pop-up).
 */
export default function EnrichSheet({ propositions, onAppliquer, onIgnorer, onClose }) {
  const [traites, setTraites] = useState(() => new Set());

  const restantes = propositions.filter(p => !traites.has(p.id));
  if (!restantes.length) return null;

  const accepter = (p) => {
    onAppliquer(p.emplacement, p.id, p.patch);
    setTraites(s => new Set(s).add(p.id));
    if (restantes.length === 1) onClose();
  };
  const laisser = (p) => {
    onIgnorer(p.id);
    setTraites(s => new Set(s).add(p.id));
    if (restantes.length === 1) onClose();
  };
  const toutAccepter = () => {
    restantes.forEach(p => onAppliquer(p.emplacement, p.id, p.patch));
    setTraites(s => { const n = new Set(s); restantes.forEach(p => n.add(p.id)); return n; });
    onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--check" onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__header">
          <span className="sheet__title">✨ Informations trouvées</span>
          <button className="sheet__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="sheet__body">
          <p className="enrich-intro">
            {restantes.length === 1
              ? "L'app a consulté le site du lieu. À toi de valider."
              : `L'app a consulté le site de ${restantes.length} lieux. À toi de valider.`}
          </p>

          {restantes.map(p => (
            <div key={p.id} className="check-card">
              <div className="check-card__head">
                <span className="check-card__title">{p.titre}</span>
                <span className="check-card__where">{p.ou}</span>
              </div>

              <dl className="check-card__adds">
                {p.apercu.horaires && (
                  <div className="check-card__add"><dt>Horaires</dt><dd>{p.apercu.horaires}</dd></div>
                )}
                {p.apercu.prix && (
                  <div className="check-card__add"><dt>Prix</dt><dd>{p.apercu.prix}</dd></div>
                )}
                {p.apercu.description && (
                  <div className="check-card__add"><dt>Description</dt><dd>{p.apercu.description}</dd></div>
                )}
                {p.apercu.site && (
                  <div className="check-card__add"><dt>Site</dt><dd>{domaine(p.apercu.site)}</dd></div>
                )}
              </dl>

              {/* D'où ça vient change la confiance qu'on peut y mettre : le
                  dire évite d'accepter les yeux fermés. */}
              <p className="enrich-source">
                {p.source === 'site'
                  ? `D'après ${p.apercu.site ? domaine(p.apercu.site) : 'le site du lieu'}`
                  : 'D\'après OpenStreetMap'}
                {p.confiance === 'basse' && ' — à vérifier'}
              </p>

              <div className="check-card__actions">
                <button className="btn btn--ghost btn--sm check-card__skip" onClick={() => laisser(p)}>
                  Laisser
                </button>
                <button className="btn btn--primary btn--sm" onClick={() => accepter(p)}>
                  Ajouter
                </button>
              </div>
            </div>
          ))}
        </div>

        {restantes.length > 1 && (
          <div className="sheet__footer">
            <button className="btn btn--ghost" onClick={onClose}>Plus tard</button>
            <button className="btn btn--primary" onClick={toutAccepter}>
              Tout ajouter ({restantes.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Une URL complète déborde de l'écran et n'apprend rien : le domaine suffit. */
function domaine(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}
