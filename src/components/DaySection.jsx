import { useState, Fragment } from 'react';
import { totalMinutes, formatDuration, formatDate, getDayLabel, getTimeSlots, totalBudget, formatPrice, haversineKm } from '../utils/helpers';
import ActivityCard from './ActivityCard';
import LogicAlerts from './LogicAlerts';

function formatDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export default function DaySection({
  day, dayIndex, totalDays, isPastTrip,
  onStatusChange, onDelete, onMoveToReserve, onMoveToNextDay,
  onReorder, onStartTimeChange, onEdit, onAddActivity,
  onOpenDetail, onDrop, onNotesChange,
  days, onDuplicate,
  compareMode, compareSelectedIds, onToggleCompare,
  weather,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [localDragId, setLocalDragId] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const isLast = dayIndex === totalDays - 1;

  const notDone = day.activities.filter(a => a.status !== 'done');
  const done = day.activities.filter(a => a.status === 'done');
  const sorted = [...notDone, ...done];

  const active = day.activities.filter(a => a.status !== 'nogo');
  const total = totalMinutes(active);
  const budget = totalBudget(active);
  const overload = total > 8 * 60;
  const slots = getTimeSlots(sorted, day.startTime || '09:00');

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const activityId = e.dataTransfer.getData('text/plain');
    if (activityId) onDrop?.(day.id, activityId);
  };

  return (
    <div className="day-section">
      <div className="day-section__header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="day-section__title">{getDayLabel(dayIndex, totalDays)}</div>
          <div className="day-section__date">{formatDate(day.date)}</div>
          {weather && (
            <div className="day-section__weather">{weather.icon} {weather.max}°/{weather.min}°</div>
          )}
        </div>
        <div className="day-section__right">
          {day.activities.length > 0 && (
            <span className={`day-section__total${overload ? ' day-section__total--overload' : ''}`}>
              {overload ? '⚠️ ' : '⏱ '}{formatDuration(total)}
            </span>
          )}
          {budget > 0 && <span className="day-section__budget">💶 {formatPrice(budget)}</span>}
          <button
            className="btn btn--xs btn--ghost-white"
            onClick={() => setNotesOpen(o => !o)}
            title="Notes du jour"
            style={day.notes ? { background: 'rgba(255,255,255,0.4)' } : {}}
          >📝{day.notes && !notesOpen ? ' •' : ''}</button>
          <button className="btn btn--xs btn--ghost-white" onClick={() => onOpenDetail(day)}>↗ Détail</button>
        </div>
      </div>

      <div className="day-section__start-time">
        <label htmlFor={`start-${day.id}`}>🕘 Départ :</label>
        <input
          id={`start-${day.id}`}
          type="time"
          value={day.startTime || '09:00'}
          onChange={e => onStartTimeChange(day.id, e.target.value)}
        />
      </div>

      <LogicAlerts activities={day.activities} />

      <div
        className={`day-section__body${isDragOver ? ' day-section__body--drop-target' : ''}`}
        data-drop-zone="true"
        data-zone-type="day"
        data-day-id={day.id}
        onDragOver={handleDragOver}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
        onDrop={handleDrop}
      >
        {sorted.length === 0
          ? (
            <div className="day-section__empty">
              <div className="day-section__empty-actions">
                <span>Glisse ou ajoute une activité</span>
                <button className="btn btn--primary btn--xs" onClick={() => onAddActivity(day.id)}>+ Ajouter</button>
              </div>
            </div>
          )
          : sorted.map((activity, sortedIdx) => {
            const origIdx = day.activities.findIndex(a => a.id === activity.id);
            const next = sorted[sortedIdx + 1];
            const dist = (next && activity.lat && activity.lon && next.lat && next.lon
              && activity.status !== 'nogo' && next.status !== 'nogo')
              ? haversineKm(activity.lat, activity.lon, next.lat, next.lon)
              : null;
            return (
              <Fragment key={activity.id}>
                <ActivityCard
                  activity={activity}
                  context="day"
                  isLastDay={isLast}
                  slot={slots[activity.id]}
                  isPastTrip={isPastTrip}
                  onStatusChange={(s) => onStatusChange(day.id, activity.id, s)}
                  onDelete={() => onDelete(day.id, activity.id)}
                  onMoveToReserve={() => onMoveToReserve(day.id, activity.id)}
                  onMoveToNextDay={!isLast ? () => onMoveToNextDay(day.id, activity.id) : null}
                  onEdit={() => onEdit(activity, { type: 'day', dayId: day.id })}
                  onReorderUp={() => onReorder(day.id, activity.id, 'up')}
                  onReorderDown={() => onReorder(day.id, activity.id, 'down')}
                  isFirst={origIdx === 0}
                  isLast={origIdx === day.activities.length - 1}
                  onDragStart={() => setLocalDragId(activity.id)}
                  onDragEnd={() => setLocalDragId(null)}
                  isDragging={localDragId === activity.id}
                  days={days}
                  currentDayId={day.id}
                  onDuplicate={onDuplicate ? (targetDayId) => onDuplicate(activity.id, targetDayId) : null}
                  compareMode={compareMode}
                  compareSelected={compareSelectedIds?.has(activity.id)}
                  onToggleCompare={onToggleCompare ? () => onToggleCompare(activity.id) : null}
                />
                {dist !== null && (
                  <div className="activity-bridge">
                    <span className="activity-bridge__line" />
                    <span className="activity-bridge__dist">↕ {formatDist(dist)}</span>
                    <span className="activity-bridge__line" />
                  </div>
                )}
              </Fragment>
            );
          })
        }
      </div>

      {notesOpen && (
        <div className="day-section__notes">
          <textarea
            className="day-notes-textarea"
            placeholder="Notes du jour : hébergement, infos pratiques, adresse…"
            value={day.notes || ''}
            onChange={e => onNotesChange?.(day.id, e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
