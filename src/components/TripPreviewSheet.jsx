import { formatDateShort, formatPrice, CATEGORIES } from '../utils/helpers';

export default function TripPreviewSheet({ trip, onClose, onOpen }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDate = new Date(trip.startDate + 'T00:00:00');
  const endDate = new Date(trip.endDate + 'T00:00:00');
  const isActive = startDate <= today && today <= endDate;
  const daysUntil = Math.round((startDate - today) / 86400000);
  const dayIdx = isActive ? Math.round((today - startDate) / 86400000) : -1;

  const dayActs = trip.days.flatMap(d => d.activities);
  const allActs = [...dayActs, ...trip.reserve];
  const doneCount = dayActs.filter(a => a.status === 'done').length;
  const totalBudgetAmt = allActs.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);

  const catCounts = {};
  dayActs.forEach(a => { catCounts[a.category] = (catCounts[a.category] || 0) + 1; });
  const topCats = CATEGORIES.filter(c => catCounts[c.id])
    .sort((a, b) => catCounts[b.id] - catCounts[a.id]).slice(0, 5);

  let countdown = null;
  if (isActive) countdown = { text: `Jour ${dayIdx + 1}/${trip.days.length} en cours`, active: true };
  else if (daysUntil === 0) countdown = { text: 'Départ aujourd\'hui !', urgent: true };
  else if (daysUntil === 1) countdown = { text: 'Départ demain !', urgent: true };
  else if (daysUntil > 0) countdown = { text: `Dans ${daysUntil} jours` };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet sheet--preview" onClick={e => e.stopPropagation()}>
        <div className="sheet__handle" />

        <div className="preview-hero">
          <div className="preview-hero__emoji">{trip.emoji || '✈️'}</div>
          <div className="preview-hero__info">
            <div className="preview-hero__name">{trip.name}</div>
            {trip.destination && <div className="preview-hero__dest">📍 {trip.destination}</div>}
            <div className="preview-hero__dates">
              {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)} · {trip.days.length}j
            </div>
          </div>
        </div>

        {countdown && (
          <div className={`preview-countdown${countdown.active ? ' preview-countdown--active' : countdown.urgent ? ' preview-countdown--urgent' : ''}`}>
            {countdown.active ? '🟢' : countdown.urgent ? '🎉' : '⏳'} {countdown.text}
          </div>
        )}

        <div className="preview-stats">
          <div className="preview-stat">
            <div className="preview-stat__val">{dayActs.length}</div>
            <div className="preview-stat__lbl">Activités</div>
          </div>
          <div className="preview-stat">
            <div className="preview-stat__val">{doneCount}</div>
            <div className="preview-stat__lbl">Faites</div>
          </div>
          {trip.reserve.length > 0 && (
            <div className="preview-stat">
              <div className="preview-stat__val">{trip.reserve.length}</div>
              <div className="preview-stat__lbl">Réserve</div>
            </div>
          )}
          {totalBudgetAmt > 0 && (
            <div className="preview-stat">
              <div className="preview-stat__val">{formatPrice(totalBudgetAmt)}</div>
              <div className="preview-stat__lbl">Budget</div>
            </div>
          )}
        </div>

        {topCats.length > 0 && (
          <div className="preview-cats">
            {topCats.map(cat => (
              <span key={cat.id} className="preview-cat-pill">
                {cat.emoji} {catCounts[cat.id]}
              </span>
            ))}
          </div>
        )}

        <button className="btn btn--primary btn--full preview-open-btn" onClick={onOpen}>
          Ouvrir le voyage →
        </button>
      </div>
    </div>
  );
}
