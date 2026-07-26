import { useState } from 'react';
import { formatDuration, getDayLabel, formatDateShort, totalBudget, formatPrice, getCategoryMeta, getTimeSlots } from '../utils/helpers';

function TlActivity({ activity, slot, compareMode, compareSelected, onToggleCompare, onTouchDragStart }) {
  const [open, setOpen] = useState(false);
  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);
  // Replié, on ne montre que l'essentiel (heure + titre). Le détail (durée, prix,
  // adresse) se déroule au tap — moins d'informations affichées d'un coup.
  const hasDetails = dur > 0 || activity.price > 0 || !!activity.address;

  return (
    <div
      className={`tl-activity tl-activity--${activity.status}${compareMode && compareSelected ? ' tl-activity--compare-selected' : ''}${open ? ' tl-activity--open' : ''}`}
      data-category={activity.category}
      draggable={!compareMode}
      onDragStart={(e) => {
        if (compareMode) { e.preventDefault(); return; }
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', activity.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        if (compareMode) { e.stopPropagation(); onToggleCompare?.(); return; }
        // Ne pas laisser le tap remonter jusqu'à la carte du jour (qui ouvre la modale)
        e.stopPropagation();
        if (hasDetails) setOpen(o => !o);
      }}
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
        {slot && <span className="tl-activity__time">{slot.start}</span>}
        <span className="tl-activity__emoji">{meta.emoji}</span>
        <span className="tl-activity__title">{activity.title}</span>
        {hasDetails && !compareMode && (
          <span className="tl-activity__chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
        )}
      </div>
      {open && hasDetails && (
        <div className="tl-activity__meta">
          {dur > 0 && <span className="tl-activity__dur">⏱ {formatDuration(dur)}</span>}
          {activity.price > 0 && <span className="tl-activity__price">💶 {formatPrice(parseFloat(activity.price))}</span>}
          {activity.address && <span className="tl-activity__addr">📍 {activity.address}</span>}
        </div>
      )}
    </div>
  );
}

function TlDayCard({ day, dayIndex, totalDays, onOpenDetail, onDrop, compareMode, compareSelectedIds, onToggleCompare, onTouchDragStart, weather }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const active = day.activities.filter(a => a.status !== 'nogo');
  const budget = totalBudget(day.activities);
  const slots = getTimeSlots(day.activities, day.startTime || '09:00');

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
      onClick={() => !compareMode && onOpenDetail(day)}
      onDragOver={handleDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      <div className="tl-day__header">
        <div className="tl-day__head-main">
          <div className="tl-day__label">{getDayLabel(dayIndex, totalDays)}</div>
          <div className="tl-day__date">{formatDateShort(day.date)}</div>
          <div className="tl-day__stats">
            {budget > 0 && <span>💶 {formatPrice(budget)}</span>}
            {weather && <span>{weather.icon} {weather.max}°/{weather.min}°</span>}
            {day.notes && <span className="tl-day__note-flag" title="Notes du jour">📝</span>}
            {active.length === 0 && <span className="tl-day__empty-hint">Vide</span>}
          </div>
        </div>
        {!compareMode && <span className="tl-day__open" aria-hidden="true">›</span>}
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
    </div>
  );
}

export default function TimelineView({ days, onOpenDetail, onDrop, compareMode, compareSelectedIds, onToggleCompare, onTouchDragStart, weatherByDate }) {
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
          onTouchDragStart={onTouchDragStart}
          weather={weatherByDate?.[day.date]}
        />
      ))}
    </div>
  );
}
