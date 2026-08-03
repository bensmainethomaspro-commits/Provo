import { useEffect, useRef, useState } from 'react';
import { chercherCorrections, formatKm } from '../utils/verifyPlaces';

/**
 * Contrôle des lieux — propose, n'impose pas.
 *
 * L'app ne corrige jamais d'office : elle montre ce qu'elle a trouvé, dit
 * pourquoi elle le trouve douteux, et laisse trancher. Un lieu ignoré le reste.
 */
export default function PlaceCheckSheet({ analyse, destination, ancre, onAppliquer, onClose }) {
  const [progres, setProgres] = useState({ fait: 0, total: 0, titre: null });
  const [propositions, setPropositions] = useState(null);
  const [ignores, setIgnores] = useState(() => new Set());
  const [applique, setApplique] = useState(() => new Set());
  const arretRef = useRef(null);

  useEffect(() => {
    const ctrl = new AbortController();
    arretRef.current = ctrl;
    const aVerifier = [...analyse.ecartes, ...analyse.incompletes];
    chercherCorrections(aVerifier, {
      destination, ancre, arret: ctrl.signal,
      onProgres: (p) => { if (!ctrl.signal.aborted) setProgres(p); },
    }).then(r => { if (!ctrl.signal.aborted) setPropositions(r); })
      .catch(() => { if (!ctrl.signal.aborted) setPropositions([]); });
    return () => ctrl.abort();
  }, [analyse, destination, ancre]);

  const fermer = () => { arretRef.current?.abort(); onClose(); };

  const appliquerUne = (p) => {
    onAppliquer(p.emplacement, p.id, p.patch);
    setApplique(s => new Set(s).add(p.id));
  };
  const toutAppliquer = () => {
    const restantes = (propositions || []).filter(p => !ignores.has(p.id) && !applique.has(p.id));
    restantes.forEach(p => onAppliquer(p.emplacement, p.id, p.patch));
    setApplique(s => { const n = new Set(s); restantes.forEach(p => n.add(p.id)); return n; });
  };

  const enCours = propositions === null;
  const visibles = (propositions || []).filter(p => !ignores.has(p.id));
  const restantes = visibles.filter(p => !applique.has(p.id));

  return (
    <div className="sheet-overlay" onClick={fermer}>
      <div className="sheet sheet--check" onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__header">
          <span className="sheet__title">📍 Contrôle des lieux</span>
          <button className="sheet__close" onClick={fermer} aria-label="Fermer">✕</button>
        </div>

        <div className="sheet__body">
          {enCours && (
            <div className="check-progress">
              <div className="check-progress__bar">
                <div
                  className="check-progress__fill"
                  style={{ width: `${progres.total ? (progres.fait / progres.total) * 100 : 0}%` }}
                />
              </div>
              <p className="check-progress__label">
                {progres.titre
                  ? <>Vérification de <strong>{progres.titre}</strong>…</>
                  : 'Recherche en cours…'}
              </p>
              <p className="check-progress__note">
                {progres.fait} / {progres.total} — une seconde par lieu, pour rester
                correct avec OpenStreetMap.
              </p>
            </div>
          )}

          {!enCours && !visibles.length && (
            <div className="check-empty">
              <div className="check-empty__icon">✅</div>
              <p>Rien à corriger.</p>
              <p className="check-empty__hint">
                {analyse.total > 0
                  ? "Les lieux signalés n'ont pas de meilleure correspondance en ligne. Tu peux les corriger à la main depuis leur fiche."
                  : 'Toutes les fiches sont cohérentes avec la destination.'}
              </p>
            </div>
          )}

          {!enCours && visibles.map(p => {
            const fait = applique.has(p.id);
            return (
              <div key={p.id} className={`check-card${fait ? ' check-card--done' : ''}`}>
                <div className="check-card__head">
                  <span className="check-card__title">{p.titre}</span>
                  <span className="check-card__where">{p.ou}</span>
                </div>

                {p.motif === 'ecarte' ? (
                  <>
                    <p className="check-card__why">
                      Situé à <strong>{formatKm(p.distanceKm)}</strong> de {destination || 'la destination'}.
                    </p>
                    <div className="check-card__diff">
                      <div className="check-card__from">{p.avant.address}</div>
                      <div className="check-card__to">{p.apres.address}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="check-card__why">Informations trouvées&nbsp;:</p>
                    {/* On n'affiche que ce qui sera réellement ajouté. Montrer
                        aussi l'adresse déjà connue laissait croire qu'elle
                        allait changer. */}
                    <dl className="check-card__adds">
                      {p.ajouts.map(k => (
                        <div key={k} className="check-card__add">
                          <dt>{LIBELLE[k] || k}</dt>
                          <dd>{formatValeur(k, p.patch)}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}

                {fait ? (
                  <p className="check-card__done">✅ Corrigé</p>
                ) : (
                  <div className="check-card__actions">
                    <button
                      className="btn btn--ghost btn--sm check-card__skip"
                      onClick={() => setIgnores(s => new Set(s).add(p.id))}
                    >
                      Laisser
                    </button>
                    <button className="btn btn--primary btn--sm" onClick={() => appliquerUne(p)}>
                      Corriger
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!enCours && restantes.length > 1 && (
          <div className="sheet__footer">
            <button className="btn btn--ghost" onClick={fermer}>Fermer</button>
            <button className="btn btn--primary" onClick={toutAppliquer}>
              Tout corriger ({restantes.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const LIBELLE = {
  address: 'Adresse',
  lat: 'Position',
  openingHours: 'Horaires',
  price: 'Prix',
  link: 'Site web',
};

function formatValeur(cle, patch) {
  if (cle === 'lat') return 'sur la carte';
  if (cle === 'price') return `${patch.price} €`;
  if (cle === 'link') {
    // Une URL complète déborde de l'écran et n'apprend rien : le domaine suffit.
    try { return new URL(patch.link).hostname.replace(/^www\./, ''); }
    catch { return patch.link; }
  }
  return patch[cle];
}
