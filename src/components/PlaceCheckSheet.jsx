import { useEffect, useRef, useState } from 'react';
import { chercherCorrections, aExaminer, signaturePlace, formatKm } from '../utils/verifyPlaces';

/**
 * Contrôle des lieux — propose, n'impose pas.
 *
 * L'app ne corrige jamais d'office : elle montre ce qu'elle a trouvé, dit
 * pourquoi elle le trouve douteux, et laisse trancher. Un lieu ignoré le reste.
 */
export default function PlaceCheckSheet({ analyse, destination, ancre, onAppliquer, onOuvrirFiche, onClose }) {
  const [progres, setProgres] = useState({ fait: 0, total: 0, titre: null });
  const [propositions, setPropositions] = useState(null);
  const [ignores, setIgnores] = useState(() => new Set());
  const [applique, setApplique] = useState(() => new Set());
  // Une reprise complète est un choix explicite : par défaut on ne repasse pas
  // une seconde par lieu sur ce qui a déjà été examiné.
  const [tout, setTout] = useState(false);
  const arretRef = useRef(null);
  // La recherche dure plusieurs dizaines de secondes : elle ne doit pas
  // repartir de zéro parce que le parent s'est redessiné. Le rappel passe donc
  // par un ref, tenu à jour hors du rendu.
  const appliquerRef = useRef(onAppliquer);
  useEffect(() => { appliquerRef.current = onAppliquer; }, [onAppliquer]);

  const aVerifier = aExaminer(analyse, tout);

  useEffect(() => {
    const ctrl = new AbortController();
    arretRef.current = ctrl;
    chercherCorrections(aVerifier, {
      destination, ancre, arret: ctrl.signal,
      onProgres: (p) => { if (!ctrl.signal.aborted) setProgres(p); },
    }).then(({ propositions: props, examines }) => {
      if (ctrl.signal.aborted) return;
      // Rien à montrer pour celles-là, mais il faut s'en souvenir : sans ça,
      // la prochaine ouverture redépense le même temps pour le même vide.
      examines.forEach(e => appliquerRef.current(e.emplacement, e.id, e.patch));
      setPropositions(props);
    }).catch(() => { if (!ctrl.signal.aborted) setPropositions([]); });
    return () => ctrl.abort();
    // `aVerifier` est recalculé à chaque rendu : le déclencheur, c'est la
    // demande de reprise complète, pas l'identité du tableau.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tout, destination, ancre]);

  const fermer = () => { arretRef.current?.abort(); onClose(); };

  const appliquerUne = (p) => {
    onAppliquer(p.emplacement, p.id, p.patch);
    setApplique(s => new Set(s).add(p.id));
  };
  // « Laisser » est une décision, pas un report : on la retient pour ne plus
  // reposer la question tant que le lieu n'a pas changé.
  const laisserUne = (p) => {
    const act = trouverActivite(analyse, p.id);
    if (act) onAppliquer(p.emplacement, p.id, { placeCheckSig: signaturePlace(act) });
    setIgnores(s => new Set(s).add(p.id));
  };
  const toutAppliquer = () => {
    const restantes = (propositions || [])
      .filter(p => p.motif !== 'introuvable' && !ignores.has(p.id) && !applique.has(p.id));
    restantes.forEach(p => onAppliquer(p.emplacement, p.id, p.patch));
    setApplique(s => { const n = new Set(s); restantes.forEach(p => n.add(p.id)); return n; });
  };

  const enCours = propositions === null;
  const visibles = (propositions || []).filter(p => !ignores.has(p.id));
  const restantes = visibles.filter(p => p.motif !== 'introuvable' && !applique.has(p.id));
  const dejaVus = analyse.total - aExaminer(analyse, false).length;

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
              <p>Rien de nouveau à corriger.</p>
              <p className="check-empty__hint">
                {dejaVus > 0 && !tout
                  ? `${dejaVus} ${dejaVus > 1 ? 'fiches ont déjà été passées' : 'fiche a déjà été passée'} en revue. Tu peux tout reprendre si besoin.`
                  : 'Toutes les fiches sont cohérentes avec la destination.'}
              </p>
            </div>
          )}

          {!enCours && dejaVus > 0 && !tout && (
            <button className="check-recheck" onClick={() => { setPropositions(null); setTout(true); }}>
              Tout revérifier ({analyse.total})
            </button>
          )}

          {!enCours && visibles.map(p => {
            const fait = applique.has(p.id);
            return (
              <div key={p.id} className={`check-card${fait ? ' check-card--done' : ''}`}>
                <div className="check-card__head">
                  <span className="check-card__title">{p.titre}</span>
                  <span className="check-card__where">{p.ou}</span>
                </div>

                {p.motif === 'introuvable' ? (
                  <>
                    <p className="check-card__why">
                      Situé à <strong>{formatKm(p.distanceKm)}</strong> de {destination || 'la destination'},
                      mais {RAISON[p.raison]}
                    </p>
                    <div className="check-card__diff">
                      <div className="check-card__to check-card__to--soft">{p.avant.address}</div>
                    </div>
                    <div className="check-card__actions">
                      <button
                        className="btn btn--ghost btn--sm check-card__skip"
                        onClick={() => laisserUne(p)}
                      >
                        C'est correct
                      </button>
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={() => { onOuvrirFiche?.(p.emplacement, p.id); onClose(); }}
                      >
                        Corriger à la main
                      </button>
                    </div>
                  </>
                ) : p.motif === 'ecarte' ? (
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

                {p.motif === 'introuvable' ? null : fait ? (
                  <p className="check-card__done">✅ Corrigé</p>
                ) : (
                  <div className="check-card__actions">
                    <button
                      className="btn btn--ghost btn--sm check-card__skip"
                      onClick={() => laisserUne(p)}
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

const RAISON = {
  aucun: "aucun lieu de ce nom n'a été trouvé près de là.",
  loin: "le seul lieu de ce nom est bien là-bas — c'est peut-être le bon.",
  identique: 'la recherche renvoie exactement le même endroit.',
};

/** Retrouve l'activité dans l'analyse, pour calculer son empreinte. */
function trouverActivite(analyse, id) {
  const x = [...analyse.ecartes, ...analyse.incompletes].find(e => e.activite.id === id);
  return x?.activite || null;
}

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
