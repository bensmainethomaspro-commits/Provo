import { useState } from 'react';
import { getCategoryMeta, formatDate, getTimeSlots } from '../utils/helpers';
import { vibrate } from '../hooks/useSettings';
import Confetti from './Confetti';

export default function TodayMode({ day, dayIndex, totalDays, trip, onStatusChange }) {
  const [showConfetti, setShowConfetti] = useState(false);
  const slots = getTimeSlots(day.activities, day.startTime || '09:00');
  const remaining = day.activities.filter(a => a.status === 'todo');
  const done = day.activities.filter(a => a.status === 'done');
  const skipped = day.activities.filter(a => a.status === 'nogo');
  const allDone = day.activities.length > 0 && day.activities.every(a => a.status !== 'todo');

  const handleDone = (actId) => {
    onStatusChange(day.id, actId, 'done');
    vibrate([10, 5, 20]);
    const allWillBeDone = day.activities.filter(a => a.id !== actId).every(a => a.status !== 'todo');
    if (allWillBeDone && day.activities.length > 1) {
      setTimeout(() => setShowConfetti(true), 100);
    }
  };

  const handleSkip = (actId) => {
    onStatusChange(day.id, actId, 'nogo');
    vibrate([5, 5, 5]);
  };

  return (
    <div className="today-mode">
      <Confetti active={showConfetti} onDone={() => setShowConfetti(false)} />

      <div className="today-mode__header">
        <div className="today-mode__day-label">Jour {dayIndex + 1}/{totalDays}</div>
        <div className="today-mode__date">{formatDate(day.date)}</div>
        {trip.destination && <div className="today-mode__dest">📍 {trip.destination}</div>}
        <div className="today-mode__progress-wrap">
          <div className="today-mode__progress-bar">
            <div
              className="today-mode__progress-fill"
              style={{ width: `${day.activities.length ? ((done.length + skipped.length) / day.activities.length) * 100 : 0}%` }}
            />
          </div>
          <span className="today-mode__progress-label">{done.length}/{day.activities.length} fait{done.length > 1 ? 's' : ''}</span>
        </div>
      </div>

      {allDone && (
        <div className="today-mode__all-done">
          <div className="today-mode__all-done-icon">🎉</div>
          <div className="today-mode__all-done-text">Journée complète !</div>
        </div>
      )}

      {remaining.length > 0 && (
        <div className="today-mode__section">
          <div className="today-mode__section-title">À faire ({remaining.length})</div>
          {remaining.map(act => {
            const meta = getCategoryMeta(act.category);
            const slot = slots[act.id];
            return (
              <div key={act.id} className="today-act-card">
                <div className="today-act-card__left">
                  <span className="today-act-card__emoji">{meta.emoji}</span>
                  <div className="today-act-card__info">
                    <div className="today-act-card__title">{act.title}</div>
                    {slot && <div className="today-act-card__time">{slot.start} – {slot.end}</div>}
                    {act.address && (
                      <a
                        className="today-act-card__addr"
                        href={`https://maps.google.com/maps?daddr=${encodeURIComponent(act.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                      >
                        📍 {act.address}
                      </a>
                    )}
                  </div>
                </div>
                <div className="today-act-card__actions">
                  <button className="today-act-card__btn today-act-card__btn--skip" onClick={() => handleSkip(act.id)}>❌</button>
                  <button className="today-act-card__btn today-act-card__btn--done" onClick={() => handleDone(act.id)}>✅</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <div className="today-mode__section">
          <div className="today-mode__section-title">Faits ✅ ({done.length})</div>
          {done.map(act => {
            const meta = getCategoryMeta(act.category);
            return (
              <div key={act.id} className="today-act-card today-act-card--done">
                <span className="today-act-card__emoji">{meta.emoji}</span>
                <div className="today-act-card__title">{act.title}</div>
                <button className="today-act-card__undo" onClick={() => onStatusChange(day.id, act.id, 'todo')}>↩</button>
              </div>
            );
          })}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="today-mode__section">
          <div className="today-mode__section-title">Skippés ({skipped.length})</div>
          {skipped.map(act => {
            const meta = getCategoryMeta(act.category);
            return (
              <div key={act.id} className="today-act-card today-act-card--skip">
                <span className="today-act-card__emoji">{meta.emoji}</span>
                <div className="today-act-card__title">{act.title}</div>
                <button className="today-act-card__undo" onClick={() => onStatusChange(day.id, act.id, 'todo')}>↩</button>
              </div>
            );
          })}
        </div>
      )}

      {day.activities.length === 0 && (
        <div className="today-mode__empty">
          <div style={{ fontSize: 48 }}>☀️</div>
          <p>Aucune activité planifiée aujourd'hui.</p>
          <p style={{ fontSize: 13, color: 'var(--text-light)' }}>Profites-en !</p>
        </div>
      )}
    </div>
  );
}
