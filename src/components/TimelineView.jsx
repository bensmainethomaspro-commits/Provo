import { useState } from 'react';
import { totalMinutes, formatDuration, getDayLabel, formatDateShort, totalBudget, formatPrice, getCategoryMeta, getTimeSlots } from '../utils/helpers';

function TlActivity({ activity, slot, compareMode, compareSelected, onToggleCompare, onTouchDragStart }) {
  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);

  return (
    <div
      className={`tl-activity tl-activity--${activity.status}${compareMode && compareSelected ? ' tl-activity--compare-selected' : ''}`}
      data-category={activity.category}
      draggable={!compareMode}
      onDragStart={(e) => {
        if (compareMode) { e.preventDefault(); return; }
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', activity.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => { if (compareMode) { e.stopPropagation(); onToggleCompare?.(); } }}
    >
      <div className="tl-activity__top">
        {compareMode ? (
          <div className={`tl-activity__compare-check${compareSelected ? ' tl-activity__compare-check--on' : ''}`}>
            {compareSelected ? '☑' : '☐'}
          </div>
        ) : onTouchDragStart ? (
          <div
            className="tl-activity__drag-handle"
            onTouchStart={(e) => {
              e.preventDefault();
              onTouchDragStart(activity.id, e.touches[0], e.currentTarget.closest('.tl-activity'));
            }}
          >⠿</div>
        ) : null}
        <span className="tl-activity__emoji">{meta.emoji}</span>
        <span className="tl-activity__title">{activity.title}</span>
      </div>
      <div className="tl-activity__meta">
        {slot && <span className="tl-activity__time">{slot.start}</span>}
        {dur > 0 && <span className="tl-activity__dur">{formatDuration(dur)}</span>}
        {activity.price > 0 && <span className="tl-activity__price">{formatPrice(parseFloat(activity.price))}</span>}
      </div>
    </div>
  );
}

function TlDayCard({ day, dayIndex, totalDays, onOpenDetail, onDrop, compareMode, compareSelectedIds, onToggleCompare, onNotesChange, onSweep, onTouchDragStart }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const active = day.activities.filter(a => a.status !== 'nogo');
  const totalMin = totalMinutes(active);
  const budget = totalBudget(day.activities);
  const slots = getTimeSlots(day.activities, day.startTime || '09:00');
  const todoActivities = day.activities.filter(a => a.status === 'todo');

  const handleDragOver = (e) => {
    if (compareMode) return;
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
    <div
      className={`tl-day${isDragOver ? ' tl-day--drop' : ''}`}
      data-drop-zone="true"
      data-zone-type="day"
      data-day-id={day.id}
      onClick={() => !compareMode && !notesOpen && onOpenDetail(day)}
      onDragOver={handleDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      <div className="tl-day__header">
        <div>
          <div className="tl-day__label">{getDayLabel(dayIndex, totalDays)}</div>
          <div className="tl-day__date">{formatDateShort(day.date)}</div>
          <div className="tl-day__stats">
            {totalMin > 0 && <span>{formatDuration(totalMin)}</span>}
            {budget > 0 && <span>{formatPrice(budget)}</span>}
            {active.length === 0 && <span className="tl-day__empty-hint">Vide</span>}
          </div>
        </div>
        <div className="tl-day__actions">
          {todoActivities.length > 0 && !compareMode && onSweep && (
            <button
              className="tl-day__action-btn"
              onClick={(e) => { e.stopPropagation(); onSweep(day.id); }}
              title="On verra demain — envoyer en réserve"
            >🪄</button>
          )}
          <button
            className={`tl-day__action-btn${day.notes ? ' tl-day__action-btn--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setNotesOpen(o => !o); }}
            title="Notes du jour"
          >
            📝{day.notes && !notesOpen ? ' •' : ''}
          </button>
          {!compareMode && (
            <button
              className="tl-day__action-btn"
              onClick={(e) => { e.stopPropagation(); onOpenDetail(day); }}
              title="Détail du jour"
            >
              ↗
            </button>
          )}
        </div>
      </div>
      <div className="tl-day__body">
        {day.activities.length === 0 ? (
          <div className="tl-day__no-act">Aucune activité</div>
        ) : (
          day.activities.map(a => (
            <TlActivity
              key={a.id}
              activity={a}
              slot={slots[a.id]}
              compareMode={compareMode}
              compareSelected={compareSelectedIds?.has(a.id)}
              onToggleCompare={() => onToggleCompare?.(a.id)}
              onTouchDragStart={onTouchDragStart}
            />
          ))
        )}
      </div>
      {notesOpen && (
        <div className="tl-day__notes-area" onClick={(e) => e.stopPropagation()}>
          <textarea
            className="tl-day__notes-input"
            placeholder="Notes du jour : hébergement, infos pratiques…"
            value={day.notes || ''}
            onChange={e => onNotesChange?.(day.id, e.target.value)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

export default function TimelineView({ days, onOpenDetail, onDrop, compareMode, compareSelectedIds, onToggleCompare, onNotesChange, onSweep, onTouchDragStart }) {
  return (
    <div className="timeline-view-wrap">
      {days.map((day, i) => (
        <TlDayCard
          key={day.id}
          day={day}
          dayIndex={i}
          totalDays={days.length}
          onOpenDetail={onOpenDetail}
          onDrop={onDrop}
          compareMode={compareMode}
          compareSelectedIds={compareSelectedIds}
          onToggleCompare={onToggleCompare}
          onNotesChange={onNotesChange}
          onSweep={onSweep}
          onTouchDragStart={onTouchDragStart}
        />
      ))}
    </div>
  );
}
