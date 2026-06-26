import { totalMinutes, formatDuration, getDayLabel, formatDateShort, totalBudget, formatPrice, getCategoryMeta } from '../utils/helpers';

export default function AgendaView({ days, onOpenDetail, compareMode, onReorderDay, weatherByDate }) {
  return (
    <div className="agenda-view">
      {days.map((day, i) => {
        const active = day.activities.filter(a => a.status !== 'nogo');
        const totalMin = totalMinutes(active);
        const budget = totalBudget(active);
        const done = day.activities.filter(a => a.status === 'done').length;
        const total = day.activities.length;
        const pct = total > 0 ? Math.round(done / total * 100) : 0;
        const emojis = [...new Set(day.activities.map(a => getCategoryMeta(a.category).emoji))].slice(0, 5).join(' ');
        const w = weatherByDate?.[day.date];

        return (
          <div
            key={day.id}
            className={`agenda-day${total === 0 ? ' agenda-day--empty' : ''}`}
            onClick={() => !compareMode && onOpenDetail(day)}
          >
            <div className="agenda-day__header">
              <span className="agenda-day__label">{getDayLabel(i, days.length)}</span>
              <span className="agenda-day__date">{formatDateShort(day.date)}</span>
              {w && (
                <span className="agenda-day__weather">
                  <span>{w.icon}</span>
                  <span>{w.max}°/{w.min}°</span>
                </span>
              )}
              {onReorderDay && (
                <div className="agenda-day__reorder" onClick={e => e.stopPropagation()}>
                  <button className="agenda-reorder-btn" onClick={() => onReorderDay(day.id, 'up')} disabled={i === 0}>▲</button>
                  <button className="agenda-reorder-btn" onClick={() => onReorderDay(day.id, 'down')} disabled={i === days.length - 1}>▼</button>
                </div>
              )}
            </div>
            {total > 0 ? (
              <>
                <div className="agenda-day__emojis">{emojis}</div>
                <div className="agenda-day__stats">
                  {totalMin > 0 && <span>{formatDuration(totalMin)}</span>}
                  {budget > 0 && <span>{formatPrice(budget)}</span>}
                </div>
                <div className="agenda-day__progress">
                  <div className="agenda-day__track">
                    <div className="agenda-day__fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="agenda-day__count">{done}/{total}</span>
                </div>
              </>
            ) : (
              <div className="agenda-day__empty-hint">Vide</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
