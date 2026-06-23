import { getCategoryMeta, formatDuration, formatPrice, STATUS_CONFIG, CATEGORY_COLORS } from '../utils/helpers';

export default function CompareModal({ activities, onClose }) {
  if (!activities?.length) return null;

  return (
    <div className="compare-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="compare-panel">
        <div className="compare-header">
          <span className="compare-title">⚖️ Comparaison</span>
          <span className="compare-count">{activities.length} activité{activities.length > 1 ? 's' : ''}</span>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <div className="compare-body">
          {activities.map(a => {
            const meta = getCategoryMeta(a.category);
            const dur = (a.durationHours || 0) * 60 + (a.durationMinutes || 0);
            const color = CATEGORY_COLORS[a.category] || '#FF6B35';
            const statusCfg = STATUS_CONFIG[a.status];
            return (
              <div key={a.id} className="compare-card">
                <div className="compare-card__bar" style={{ background: color }} />
                <div className="compare-card__body">
                  <div className="compare-card__cat">
                    <span className="compare-card__cat-emoji">{meta.emoji}</span>
                    <span className="compare-card__cat-label" style={{ color }}>{meta.label}</span>
                  </div>
                  <div className="compare-card__title">{a.title}</div>

                  {dur > 0 && (
                    <div className="compare-card__row">
                      <span className="compare-card__row-icon">⏱</span>
                      <span className="compare-card__row-val">{formatDuration(dur)}</span>
                    </div>
                  )}
                  {a.price > 0 && (
                    <div className="compare-card__row">
                      <span className="compare-card__row-icon">💶</span>
                      <span className="compare-card__row-val" style={{ color: '#15803d', fontWeight: 700 }}>{formatPrice(parseFloat(a.price))}</span>
                    </div>
                  )}
                  {a.address && (
                    <div className="compare-card__row">
                      <span className="compare-card__row-icon">📍</span>
                      <span className="compare-card__row-val">{a.address}</span>
                    </div>
                  )}
                  {a.link && (
                    <div className="compare-card__row">
                      <span className="compare-card__row-icon">🔗</span>
                      <a href={a.link} target="_blank" rel="noopener noreferrer" className="compare-card__link">
                        {(() => { try { return new URL(a.link).hostname; } catch { return a.link.slice(0, 28); } })()}
                      </a>
                    </div>
                  )}
                  {a.notes && (
                    <div className="compare-card__row compare-card__row--notes">
                      <span className="compare-card__row-icon">📝</span>
                      <span className="compare-card__row-val">{a.notes}</span>
                    </div>
                  )}
                  {a.screenshots?.length > 0 && (
                    <div className="compare-card__screenshots">
                      {a.screenshots.map((src, i) => (
                        <img key={i} src={src} className="compare-screenshot" alt=""
                          onClick={() => window.open(src, '_blank')} />
                      ))}
                    </div>
                  )}
                  <div className="compare-card__status">
                    <span className="compare-card__status-badge"
                      style={{ background: a.status === 'done' ? '#dcfce7' : a.status === 'nogo' ? '#fee2e2' : '#fef3c7',
                               color: a.status === 'done' ? '#15803d' : a.status === 'nogo' ? '#b91c1c' : '#92400e' }}>
                      {statusCfg.emoji} {statusCfg.label}
                    </span>
                  </div>
                </div>
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
