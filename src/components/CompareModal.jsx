import { getCategoryMeta, formatDuration, formatPrice, STATUS_CONFIG, CATEGORY_COLORS, haversineKm } from '../utils/helpers';

export default function CompareModal({ activities, onClose, onChoose }) {
  if (!activities?.length) return null;

  const maxPrice = Math.max(...activities.map(a => parseFloat(a.price) || 0));
  const maxDur   = Math.max(...activities.map(a => (a.durationHours || 0) * 60 + (a.durationMinutes || 0)));
  const base = activities[0];

  // Best value = lowest price with non-zero duration (or just lowest price)
  const getBestBadge = (a, idx) => {
    const price = parseFloat(a.price) || 0;
    const dur = (a.durationHours || 0) * 60 + (a.durationMinutes || 0);
    if (maxPrice > 0 && price === Math.min(...activities.map(x => parseFloat(x.price) || 0)) && price > 0) return 'Moins cher';
    if (maxDur > 0 && dur === maxDur) return 'Plus long';
    return null;
  };

  return (
    <div className="compare-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="compare-panel">
        <div className="compare-header">
          <div className="compare-header__left">
            <span className="compare-header__icon">⚖️</span>
            <div>
              <div className="compare-title">Comparer</div>
              <div className="compare-subtitle">{activities.length} activités · Tape pour choisir</div>
            </div>
          </div>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>

        <div className="compare-body">
          {activities.map((a, idx) => {
            const meta = getCategoryMeta(a.category);
            const dur = (a.durationHours || 0) * 60 + (a.durationMinutes || 0);
            const price = parseFloat(a.price) || 0;
            const color = CATEGORY_COLORS[a.category] || '#FF6B35';
            const badge = getBestBadge(a, idx);
            const distKm = (idx > 0 && base.lat && base.lon && a.lat && a.lon)
              ? haversineKm(base.lat, base.lon, a.lat, a.lon).toFixed(1) : null;

            return (
              <div key={a.id} className="compare-card">
                <div className="compare-card__accent" style={{ background: color }} />

                {badge && <div className="compare-card__badge" style={{ background: color }}>{badge}</div>}

                {a.photoUrl && (
                  <div className="compare-card__photo-wrap">
                    <img src={a.photoUrl} className="compare-card__photo" alt="" />
                  </div>
                )}

                <div className="compare-card__body">
                  <div className="compare-card__cat">
                    <span className="compare-card__cat-emoji">{meta.emoji}</span>
                    <span className="compare-card__cat-label" style={{ color }}>{meta.label}</span>
                  </div>
                  <div className="compare-card__title">{a.title}</div>

                  <div className="compare-card__metrics">
                    {dur > 0 && (
                      <div className="compare-card__metric">
                        <span className="compare-card__metric-icon">⏱</span>
                        <span className="compare-card__metric-val">{formatDuration(dur)}</span>
                        {maxDur > 0 && <div className="compare-card__bar-track"><div className="compare-card__bar-fill compare-card__bar-fill--dur" style={{ width: `${(dur / maxDur) * 100}%` }} /></div>}
                      </div>
                    )}
                    {price > 0 && (
                      <div className="compare-card__metric">
                        <span className="compare-card__metric-icon">💶</span>
                        <span className="compare-card__metric-val compare-card__metric-val--price">{formatPrice(price)}</span>
                        {maxPrice > 0 && <div className="compare-card__bar-track"><div className="compare-card__bar-fill compare-card__bar-fill--price" style={{ width: `${(price / maxPrice) * 100}%` }} /></div>}
                      </div>
                    )}
                  </div>

                  {a.address && (
                    <div className="compare-card__row">
                      <span>📍</span><span className="compare-card__row-val">{a.address}</span>
                    </div>
                  )}
                  {distKm !== null && (
                    <div className="compare-card__row">
                      <span>📏</span><span className="compare-card__row-val">{distKm} km</span>
                    </div>
                  )}
                  {a.openingHours && (
                    <div className="compare-card__row">
                      <span>🕐</span><span className="compare-card__row-val">{a.openingHours}</span>
                    </div>
                  )}
                  {a.notes && (
                    <div className="compare-card__row compare-card__row--notes">
                      <span>📝</span><span className="compare-card__row-val">{a.notes}</span>
                    </div>
                  )}
                  {a.link && (
                    <div className="compare-card__row">
                      <span>🔗</span>
                      <a href={a.link} target="_blank" rel="noopener noreferrer" className="compare-card__link">
                        {(() => { try { return new URL(a.link).hostname; } catch { return a.link.slice(0, 22); } })()}
                      </a>
                    </div>
                  )}
                  {a.screenshots?.length > 0 && (
                    <div className="compare-card__screenshots">
                      {a.screenshots.map((src, i) => (
                        <img key={i} src={src} className="compare-screenshot" alt="" onClick={() => window.open(src, '_blank')} />
                      ))}
                    </div>
                  )}
                </div>

                {onChoose && (
                  <button
                    className="compare-card__choose"
                    style={{ '--choose-color': color }}
                    onClick={() => { onChoose(a); onClose(); }}
                  >
                    ✓ Je choisis ça
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="compare-footer">
          <button className="btn btn--secondary btn--full" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
