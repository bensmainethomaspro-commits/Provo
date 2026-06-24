import { useState, useEffect } from 'react';
import { getTimeSlots, getCategoryMeta, formatDuration } from '../utils/helpers';

const timeToMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export default function LiveDayCard({ day, dayIndex, onStatusChange }) {
  const [now, setNow] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    }, 60000);
    return () => clearInterval(t);
  }, []);

  const active = day.activities.filter(a => a.status !== 'nogo');
  const slots = getTimeSlots(active, day.startTime || '09:00');
  const done = day.activities.filter(a => a.status === 'done').length;
  const total = active.length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  let currentAct = null;
  let nextAct = null;
  for (const act of active) {
    const s = slots[act.id];
    if (!s) continue;
    const start = timeToMin(s.start);
    const end = timeToMin(s.end);
    if (now >= start && now < end && !currentAct) currentAct = { act, slot: s };
    else if (now < start && !nextAct) nextAct = { act, slot: s };
  }

  const nowStr = `${String(Math.floor(now / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}`;

  return (
    <div className="live-day-card">
      <div className="live-day-card__header">
        <span className="live-day-card__tag">⚡ En route — Jour {dayIndex + 1}</span>
        <span className="live-day-card__time">{nowStr}</span>
      </div>
      <div className="live-day-card__progress-row">
        <div className="live-day-card__track">
          <div className="live-day-card__fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="live-day-card__pct">{done}/{total}</span>
      </div>

      {currentAct && (
        <div className="live-day-card__now">
          <div className="live-day-card__row-label">Maintenant</div>
          <div className="live-day-card__row-content">
            <span className="live-day-card__emoji">{getCategoryMeta(currentAct.act.category).emoji}</span>
            <span className="live-day-card__title">{currentAct.act.title}</span>
            {currentAct.act.status !== 'done' && (
              <button className="live-day-card__done-btn" onClick={() => onStatusChange(day.id, currentAct.act.id, 'done')}>
                ✓ Fait
              </button>
            )}
          </div>
        </div>
      )}

      {nextAct && (
        <div className="live-day-card__next">
          <div className="live-day-card__row-label">Ensuite · {nextAct.slot.start}</div>
          <div className="live-day-card__row-content">
            <span className="live-day-card__emoji">{getCategoryMeta(nextAct.act.category).emoji}</span>
            <span className="live-day-card__title">{nextAct.act.title}</span>
            {(() => {
              const dur = (nextAct.act.durationHours || 0) * 60 + (nextAct.act.durationMinutes || 0);
              return dur > 0 ? <span className="live-day-card__dur">{formatDuration(dur)}</span> : null;
            })()}
          </div>
        </div>
      )}

      {!currentAct && !nextAct && total > 0 && pct === 100 && (
        <div className="live-day-card__done-all">🎉 Toutes les activités sont terminées !</div>
      )}
      {!currentAct && !nextAct && total > 0 && pct < 100 && (
        <div className="live-day-card__done-all">Ouvre ton voyage pour voir les activités du jour.</div>
      )}
    </div>
  );
}
