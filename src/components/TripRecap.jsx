import { useState, useEffect } from 'react';
import { formatPrice, formatDateShort, getCategoryMeta, haversineKm, enEuros, repasEnAttente, destinationUtile } from '../utils/helpers';
import RecapCarte from './RecapCarte';
import Icone from './Icone';
import { X, Share } from 'lucide-react';

// Bilan de voyage (« Provo Wrapped ») : chiffres clés du séjour, partageables.
export default function TripRecap({ trip, onClose }) {
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, 250); };

  // Les repas posés d'office ne sont pas des activités : ils gonflaient le
  // total (« 0/16 ») et sacraient « Resto ×12 » activité préférée.
  const allActs = trip.days.flatMap(d => d.activities).filter(a => !repasEnAttente(a));
  const done = allActs.filter(a => a.status === 'done');
  const skipped = allActs.filter(a => a.status === 'nogo');
  const total = allActs.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;

  // Le pourcentage monte jusqu'à sa valeur à l'ouverture : le seul moment
  // du bilan qui mérite un mouvement. Rien si le système demande moins
  // d'animations.
  const [pctAffiche, setPctAffiche] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? pct : 0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    let image = 0;
    const debut = performance.now(), duree = 700;
    const pas = (t) => {
      const x = Math.min(1, (t - debut) / duree);
      setPctAffiche(Math.round(pct * (1 - Math.pow(1 - x, 3))));
      if (x < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [pct]);

  // Budget : prévu vs réel (activités faites + dépenses hors remboursements)
  const initBudget = parseFloat(trip.initialBudget) || 0;
  const doneCost = done.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const expensesTotal = (trip.expenses || [])
    .filter(e => !e.isSettlement)
    .reduce((s, e) => s + enEuros(e), 0);
  const realSpent = doneCost + expensesTotal;

  // Km parcourus : distances entre activités géolocalisées consécutives, par jour
  let km = 0;
  trip.days.forEach(day => {
    const geo = day.activities.filter(a => a.lat && a.lon && a.status !== 'nogo');
    for (let i = 1; i < geo.length; i++) {
      km += haversineKm(geo[i - 1].lat, geo[i - 1].lon, geo[i].lat, geo[i].lon);
    }
  });
  km = Math.round(km * 10) / 10;

  // Top catégories (sur les activités faites, sinon toutes)
  // Un repas n'est pas une préférence, même mangé : on parle de ce qu'on a choisi de faire.
  const catSource = (done.length > 0 ? done : allActs).filter(a => !a.isMeal);
  const catCounts = {};
  catSource.forEach(a => { catCounts[a.category] = (catCounts[a.category] || 0) + 1; });
  const topCats = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count]) => ({ ...getCategoryMeta(id), count }));

  // Meilleur jour (le plus d'activités faites)
  let bestDay = null;
  trip.days.forEach((d, i) => {
    const n = d.activities.filter(a => a.status === 'done').length;
    if (n > 0 && (!bestDay || n > bestDay.n)) bestDay = { idx: i, date: d.date, n };
  });

  const shareText = [
    `${trip.emoji || '✈️'} Bilan de mon voyage « ${trip.name} »`,
    trip.destination ? `📍 ${trip.destination}` : null,
    `📅 ${trip.days.length} jour${trip.days.length > 1 ? 's' : ''}`,
    `✅ ${done.length}/${total} activités faites (${pct}%)`,
    km > 0 ? `🛣️ ${km} km parcourus` : null,
    realSpent > 0 ? `💶 ${formatPrice(realSpent)} dépensés${initBudget > 0 ? ` (budget : ${formatPrice(initBudget)})` : ''}` : null,
    topCats.length > 0 ? `🏆 Top : ${topCats.map(c => `${c.emoji} ${c.label}`).join(' · ')}` : null,
    '',
    'Planifié avec Provo 🧳',
  ].filter(v => v !== null).join('\n');

  const handleShare = async () => {
    try {
      if (navigator.share) { await navigator.share({ text: shareText }); return; }
    } catch { /* annulé */ }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const budgetDelta = initBudget > 0 ? initBudget - realSpent : null;

  return (
    <div className={`sheet-overlay${closing ? ' closing' : ''}`} onClick={e => e.target === e.currentTarget && close()}>
      <div className="sheet recap">
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h2 className="sheet__title">Bilan du voyage</h2>
          <button aria-label="Fermer" className="sheet__close" onClick={close}><Icone de={X} /></button>
        </div>
        <div className="sheet__body">

          <div className="recap-hero">
            <div className="recap-hero__emoji">{trip.emoji || '✈️'}</div>
            <div className="recap-hero__name">{trip.name}</div>
            {destinationUtile(trip) && <div className="recap-hero__dest">{destinationUtile(trip)}</div>}
            <div className="recap-hero__dates">
              {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)} · {trip.days.length}j
            </div>
            <div className="recap-hero__pct">
              <div className="recap-hero__pct-value">{pctAffiche}%</div>
              <div className="recap-hero__pct-label">du programme réalisé</div>
            </div>
          </div>

          {/* Le trajet parcouru : un bilan chiffré dit ce qu'on a fait, une
              carte le fait revoir. C'est elle qui donne envie de rouvrir un
              voyage terminé. */}
          <RecapCarte days={trip.days} />

          {/* Grille de stats */}
          <div className="recap-grid">
            <div className="recap-stat">
              <div className="recap-stat__value">{done.length}</div>
              <div className="recap-stat__label">activités faites</div>
            </div>
            <div className="recap-stat">
              <div className="recap-stat__value">{skipped.length}</div>
              <div className="recap-stat__label">annulées</div>
            </div>
            {km > 0 && (
              <div className="recap-stat">
                <div className="recap-stat__value">{km} km</div>
                <div className="recap-stat__label">entre les lieux</div>
              </div>
            )}
            {(trip.expenses || []).length > 0 && (
              <div className="recap-stat">
                <div className="recap-stat__value">{(trip.expenses || []).filter(e => !e.isSettlement).length}</div>
                <div className="recap-stat__label">dépenses notées</div>
              </div>
            )}
          </div>

          {/* Budget */}
          {(realSpent > 0 || initBudget > 0) && (
            <div className="recap-section">
              <div className="recap-section__title">Budget</div>
              <div className="recap-budget">
                <div className="recap-budget__row">
                  <span>Dépensé (activités faites + dépenses)</span>
                  <strong>{formatPrice(realSpent)}</strong>
                </div>
                {initBudget > 0 && (
                  <>
                    <div className="recap-budget__row">
                      <span>Budget prévu</span>
                      <strong>{formatPrice(initBudget)}</strong>
                    </div>
                    <div className={`recap-budget__verdict${budgetDelta >= 0 ? ' recap-budget__verdict--ok' : ' recap-budget__verdict--over'}`}>
                      {budgetDelta >= 0
                        ? `${formatPrice(budgetDelta)} sous le budget, bravo !`
                        : `${formatPrice(-budgetDelta)} au-dessus du budget`}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Top catégories */}
          {topCats.length > 0 && (
            <div className="recap-section">
              <div className="recap-section__title">Tes activités préférées</div>
              <div className="recap-cats">
                {topCats.map((c, i) => (
                  <div key={c.label} className="recap-cat">
                    <span className="recap-cat__medal">{['🥇', '🥈', '🥉'][i]}</span>
                    <span className="recap-cat__emoji">{c.emoji}</span>
                    <span className="recap-cat__label">{c.label}</span>
                    <span className="recap-cat__count">×{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meilleur jour */}
          {bestDay && (
            <div className="recap-section">
              <div className="recap-best">
                ⭐ Journée la plus remplie : <strong>Jour {bestDay.idx + 1}</strong> ({formatDateShort(bestDay.date)}) — {bestDay.n} activité{bestDay.n > 1 ? 's' : ''} faites
              </div>
            </div>
          )}

          <button className="btn btn--primary btn--full" style={{ marginTop: 14 }} onClick={handleShare}>
            {copied ? 'Copié' : <><Icone de={Share} taille={18} /> Partager le bilan</>}
          </button>
        </div>
      </div>
    </div>
  );
}
