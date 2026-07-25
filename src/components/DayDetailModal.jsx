import { useState } from 'react';
import { formatDate, getDayLabel, formatDuration, formatPrice, totalMinutes, getTimeSlots, budgetStats } from '../utils/helpers';
import ActivityCard from './ActivityCard';
import LogicAlerts from './LogicAlerts';

export default function DayDetailModal({
  day, dayIndex, totalDays, isPastTrip,
  onClose, onStatusChange, onDelete, onMoveToReserve, onMoveToNextDay,
  onReorder, onStartTimeChange, onEdit, onAddActivity,
  days, onDuplicate,
  compareMode, compareSelectedIds, onToggleCompare,
  onNotesChange, onSweep, routeGain, onOptimizeRoute,
}) {
  const [closing, setClosing] = useState(false);
  const todoActivities = day.activities.filter(a => a.status === 'todo');

  const close = () => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 250);
  };

  const notDone = day.activities.filter(a => a.status !== 'done');
  const done = day.activities.filter(a => a.status === 'done');
  const sorted = [...notDone, ...done];

  const active = day.activities.filter(a => a.status !== 'nogo');
  const totalMin = totalMinutes(active);
  const slots = getTimeSlots(sorted, day.startTime || '09:00');
  const stats = budgetStats(day.activities);

  return (
    <div className={`day-detail-overlay${closing ? ' closing' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="day-detail-sheet">
        <div className="day-detail__header">
          <div>
            <div className="day-detail__title">{getDayLabel(dayIndex, totalDays)} — {formatDate(day.date)}</div>
            <div className="day-detail__subtitle">
              {day.activities.length > 0
                ? `${formatDuration(totalMin)} · ${day.activities.filter(a => a.status !== 'nogo').length} activité${day.activities.length > 1 ? 's' : ''}`
                : 'Aucune activité'
              }
              {stats.total > 0 && ` · ${formatPrice(stats.total)}`}
            </div>
          </div>
          <button className="sheet__close" onClick={close}>✕</button>
        </div>

        <div className="day-detail__body">
          <div className="day-section__start-time" style={{ marginBottom: 12 }}>
            <label htmlFor={`modal-start-${day.id}`}>🕘 Départ :</label>
            <input id={`modal-start-${day.id}`} type="time"
              value={day.startTime || '09:00'}
              onChange={e => onStartTimeChange(day.id, e.target.value)} />
          </div>

          {stats.total > 0 && (
            <div className="budget-row" style={{ marginBottom: 12 }}>
              <span className="budget-pill" style={{ background: '#fef3c7', color: '#92400e' }}>
                💰 {formatPrice(stats.total)}
              </span>
              {stats.spent > 0 && (
                <span className="budget-pill" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                  ✅ {formatPrice(stats.spent)}
                </span>
              )}
              {stats.remaining > 0 && (
                <span className="budget-pill" style={{ background: '#dcfce7', color: '#15803d' }}>
                  💵 {formatPrice(stats.remaining)}
                </span>
              )}
            </div>
          )}

          <LogicAlerts activities={day.activities} />

          {/* Suggestion d'itinéraire : proposée, jamais appliquée d'office */}
          {routeGain && onOptimizeRoute && (
            <button className="route-suggest" onClick={onOptimizeRoute}>
              <span className="route-suggest__icon">🗺</span>
              <span className="route-suggest__text">
                <strong>Itinéraire plus court possible</strong>
                <small>Environ {routeGain.saved < 1
                  ? `${Math.round(routeGain.saved * 1000)} m`
                  : `${routeGain.saved.toFixed(1)} km`} de trajet en moins</small>
              </span>
              <span className="route-suggest__cta">Voir</span>
            </button>
          )}

          <div className="day-section__body" style={{ marginTop: 8 }}>
            {sorted.length === 0
              ? (
                <div className="day-section__empty">
                  <span>Aucune activité planifiée</span>
                </div>
              )
              : sorted.map((activity) => {
                const origIdx = day.activities.findIndex(a => a.id === activity.id);
                return (
                  <ActivityCard
                    key={activity.id}
                    activity={activity}
                    context="day"
                    isLastDay={dayIndex === totalDays - 1}
                    slot={slots[activity.id]}
                    isPastTrip={isPastTrip}
                    onStatusChange={(s) => onStatusChange(day.id, activity.id, s)}
                    onDelete={() => onDelete(day.id, activity.id)}
                    onMoveToReserve={() => onMoveToReserve(day.id, activity.id)}
                    onMoveToNextDay={dayIndex < totalDays - 1 ? () => onMoveToNextDay(day.id, activity.id) : null}
                    onEdit={() => { close(); onEdit(activity, { type: 'day', dayId: day.id }); }}
                    onReorderUp={() => onReorder(day.id, activity.id, 'up')}
                    onReorderDown={() => onReorder(day.id, activity.id, 'down')}
                    isFirst={origIdx === 0}
                    isLast={origIdx === day.activities.length - 1}
                    onDragStart={() => {}}
                    onDragEnd={() => {}}
                    days={days}
                    currentDayId={day.id}
                    onDuplicate={onDuplicate ? (targetDayId) => onDuplicate(activity.id, targetDayId) : null}
                    compareMode={compareMode}
                    compareSelected={compareSelectedIds?.has(activity.id)}
                    onToggleCompare={onToggleCompare ? () => onToggleCompare(activity.id) : null}
                  />
                );
              })
            }
          </div>

          <button
            className="btn btn--primary"
            style={{ width: '100%', marginTop: 14 }}
            onClick={() => { close(); onAddActivity(day.id); }}
          >
            + Ajouter une activité à ce jour
          </button>

          {onSweep && todoActivities.length > 0 && (
            <button
              className="btn btn--ghost day-detail__sweep"
              onClick={() => onSweep(day.id)}
              title="Déplacer les activités « à faire » vers la Réserve"
            >
              🪄 On verra plus tard · {todoActivities.length} → Réserve
            </button>
          )}

          {onNotesChange && (
            <div className="day-detail__notes">
              <label className="day-detail__notes-label" htmlFor={`modal-notes-${day.id}`}>📝 Notes du jour</label>
              <textarea
                id={`modal-notes-${day.id}`}
                className="day-notes-textarea"
                placeholder="Hébergement, infos pratiques, adresse…"
                value={day.notes || ''}
                onChange={e => onNotesChange(day.id, e.target.value)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
