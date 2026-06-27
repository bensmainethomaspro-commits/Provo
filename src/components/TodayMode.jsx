import { useState, useEffect, useRef } from 'react';
import { getCategoryMeta, formatDate, getTimeSlots, getDayLabel } from '../utils/helpers';
import { vibrate } from '../hooks/useSettings';
import Confetti from './Confetti';

// Drag-to-reorder list for the day's remaining activities (touch + mouse).
// Order is tracked as an array of ids; the parent commit happens on drop from a
// ref (never inside a setState updater) so we never feed it a malformed list.
function TodayReorderList({ items, slots, onCommit, onDone, onSkip }) {
  const [orderIds, setOrderIds] = useState(() => items.map(a => a.id));
  const [dragId, setDragId] = useState(null);
  const orderRef = useRef(orderIds);
  orderRef.current = orderIds;

  // Re-sync from parent whenever we're not mid-drag.
  useEffect(() => { if (!dragId) setOrderIds(items.map(a => a.id)); }, [items, dragId]);

  useEffect(() => {
    if (!dragId) return;
    document.body.classList.add('dragging-noselect');
    const move = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      const card = document.elementFromPoint(pt.clientX, pt.clientY)?.closest('[data-today-id]');
      if (!card) return;
      const overId = card.getAttribute('data-today-id');
      if (!overId || overId === dragId) return;
      setOrderIds(prev => {
        const from = prev.indexOf(dragId);
        const to = prev.indexOf(overId);
        if (from === -1 || to === -1 || from === to) return prev;
        const next = [...prev];
        next.splice(from, 1);
        next.splice(to, 0, dragId);
        return next;
      });
      if (e.cancelable) e.preventDefault();
    };
    const end = () => {
      document.body.classList.remove('dragging-noselect');
      setDragId(null);
      onCommit(orderRef.current);
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchend', end);
    window.addEventListener('mouseup', end);
    return () => {
      document.body.classList.remove('dragging-noselect');
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('mouseup', end);
    };
  }, [dragId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (id) => { setDragId(id); vibrate([10]); };

  const byId = new Map(items.map(a => [a.id, a]));
  const list = orderIds.map(id => byId.get(id)).filter(Boolean);

  return list.map(act => {
    const meta = getCategoryMeta(act.category);
    const slot = slots[act.id];
    return (
      <div
        key={act.id}
        data-today-id={act.id}
        className={`today-act-card${dragId === act.id ? ' today-act-card--dragging' : ''}`}
      >
        <div className="today-act-card__left">
          <span
            className="today-act-card__drag"
            title="Glisser pour réorganiser"
            onTouchStart={(e) => { e.preventDefault(); startDrag(act.id); }}
            onMouseDown={(e) => { e.preventDefault(); startDrag(act.id); }}
          >⠿</span>
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
          <button className="today-act-card__btn today-act-card__btn--skip" onClick={() => onSkip(act.id)}>❌</button>
          <button className="today-act-card__btn today-act-card__btn--done" onClick={() => onDone(act.id)}>✅</button>
        </div>
      </div>
    );
  });
}

export default function TodayMode({ day, dayIndex, totalDays, trip, onStatusChange, onReorderActivities, reserve, days, onAddFromReserve, onMoveFromDay }) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState('reserve');

  if (!day) {
    return (
      <div className="today-mode">
        <div className="today-mode__empty">
          <div style={{ fontSize: 48 }}>🗓️</div>
          <p>Aucun jour planifié pour aujourd'hui.</p>
          <p style={{ fontSize: 13, color: 'var(--text-light)' }}>Va dans l'onglet Planning pour ajouter des activités.</p>
        </div>
      </div>
    );
  }

  const slots = getTimeSlots(day.activities, day.startTime || '09:00');
  const remaining = day.activities.filter(a => a.status === 'todo');
  const done = day.activities.filter(a => a.status === 'done');
  const skipped = day.activities.filter(a => a.status === 'nogo');
  const allDone = day.activities.length > 0 && day.activities.every(a => a.status !== 'todo');

  const otherDays = days?.filter(d => d.id !== day.id) || [];
  const reserveList = reserve || [];

  const pickerActivities = pickerTab === 'reserve'
    ? reserveList
    : (otherDays.find(d => d.id === pickerTab)?.activities || []);

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

  const handlePick = (activity) => {
    if (pickerTab === 'reserve') {
      onAddFromReserve?.(activity.id);
    } else {
      onMoveFromDay?.(pickerTab, activity.id);
    }
    vibrate([10]);
  };

  // Rebuild the full day order from a reordered list of "remaining" ids, leaving
  // done/skipped activities in their existing slots. Defensive: only uses ids that
  // actually exist, so we never store an undefined activity (which would crash render).
  const commitRemainingOrder = (remainingIds) => {
    if (!onReorderActivities) return;
    const byId = new Map(day.activities.map(a => [a.id, a]));
    const reordered = remainingIds.map(id => byId.get(id)).filter(Boolean);
    const remSet = new Set(reordered.map(a => a.id));
    let ri = 0;
    const newOrder = day.activities.map(a => (remSet.has(a.id) ? (reordered[ri++] || a) : a));
    if (newOrder.length !== day.activities.length || newOrder.some(a => !a)) return;
    vibrate([15]);
    onReorderActivities(day.id, newOrder);
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
          <div className="today-mode__section-title">À faire ({remaining.length}) <span className="today-mode__hint">⠿ glisse pour réorganiser</span></div>
          <TodayReorderList
            items={remaining}
            slots={slots}
            onCommit={commitRemainingOrder}
            onDone={handleDone}
            onSkip={handleSkip}
          />
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

      {/* Add from reserve / other days */}
      {(reserveList.length > 0 || otherDays.some(d => d.activities.length > 0)) && (
        <button className="today-mode__add-btn" onClick={() => setShowPicker(true)}>
          + Ajouter depuis la réserve ou un autre jour
        </button>
      )}

      {/* Picker sheet */}
      {showPicker && (
        <div className="act-sheet-overlay" onClick={() => setShowPicker(false)}>
          <div className="act-sheet today-picker-sheet" onClick={e => e.stopPropagation()}>
            <div className="act-sheet__title">Ajouter à aujourd'hui</div>

            {/* Source tabs */}
            <div className="today-picker__tabs">
              {reserveList.length > 0 && (
                <button
                  className={`today-picker__tab${pickerTab === 'reserve' ? ' active' : ''}`}
                  onClick={() => setPickerTab('reserve')}
                >
                  💡 Réserve
                </button>
              )}
              {otherDays.filter(d => d.activities.length > 0).map((d, i) => {
                const idx = days.findIndex(x => x.id === d.id);
                return (
                  <button
                    key={d.id}
                    className={`today-picker__tab${pickerTab === d.id ? ' active' : ''}`}
                    onClick={() => setPickerTab(d.id)}
                  >
                    {getDayLabel(idx, days.length)}
                  </button>
                );
              })}
            </div>

            {/* Activity list */}
            <div className="today-picker__list">
              {pickerActivities.length === 0 ? (
                <div className="today-picker__empty">Aucune activité ici.</div>
              ) : (
                pickerActivities.map(act => {
                  const meta = getCategoryMeta(act.category);
                  return (
                    <button key={act.id} className="today-picker__item" onClick={() => { handlePick(act); setShowPicker(false); }}>
                      <span className="today-picker__emoji">{meta.emoji}</span>
                      <span className="today-picker__title">{act.title}</span>
                      <span className="today-picker__add">+</span>
                    </button>
                  );
                })
              )}
            </div>

            <button className="act-sheet__cancel" onClick={() => setShowPicker(false)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
