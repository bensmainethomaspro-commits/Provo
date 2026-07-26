import { useState, useRef, useEffect } from 'react';
import { formatDuration, getDayLabel, formatDateShort, totalBudget, formatPrice, getCategoryMeta, getTimeSlots } from '../utils/helpers';

// Appui long avant de déclencher le glisser : assez court pour rester fluide,
// assez long pour ne pas se déclencher pendant un défilement.
const LONG_PRESS_MS = 380;
const MOVE_TOLERANCE = 10;

function TlActivity({
  activity, slot, dayId, days, onMoveToDay, onMoveToReserve,
  compareMode, compareSelected, onToggleCompare, onTouchDragStart,
}) {
  const [open, setOpen] = useState(false);
  const press = useRef({ timer: null, x: 0, y: 0, dragged: false });
  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);
  // Replié, on ne montre que l'essentiel (heure + titre). Le détail (durée, prix,
  // adresse) se déroule au tap — moins d'informations affichées d'un coup.
  const hasDetails = dur > 0 || activity.price > 0 || !!activity.address;
  const canMove = !!onMoveToDay && days?.length > 1;
  const canOpen = hasDetails || canMove;

  useEffect(() => () => clearTimeout(press.current.timer), []);

  // Glisser au doigt : viser la petite poignée ⠿ demandait trop de précision.
  // Un appui long n'importe où sur l'activité démarre maintenant le glisser.
  const cancelPress = () => { clearTimeout(press.current.timer); press.current.timer = null; };

  const onTouchStart = (e) => {
    if (compareMode || !onTouchDragStart) return;
    const t = e.touches[0];
    const el = e.currentTarget; // capturé maintenant : nul dans le setTimeout
    press.current.x = t.clientX;
    press.current.y = t.clientY;
    press.current.dragged = false;
    cancelPress();
    press.current.timer = setTimeout(() => {
      press.current.timer = null;
      press.current.dragged = true;
      navigator.vibrate?.(12);
      onTouchDragStart(activity.id, { clientX: press.current.x, clientY: press.current.y }, el);
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (e) => {
    if (!press.current.timer) return;
    const t = e.touches[0];
    // L'utilisateur fait défiler la liste : ce n'est pas un appui long.
    if (Math.abs(t.clientX - press.current.x) > MOVE_TOLERANCE
      || Math.abs(t.clientY - press.current.y) > MOVE_TOLERANCE) cancelPress();
  };

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
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
      onClick={(e) => {
        if (compareMode) { e.stopPropagation(); onToggleCompare?.(); return; }
        // Ne pas laisser le tap remonter jusqu'à la carte du jour (qui ouvre la modale)
        e.stopPropagation();
        // Le clic qui suit un glisser ne doit pas déplier la fiche.
        if (press.current.dragged) { press.current.dragged = false; return; }
        if (canOpen) setOpen(o => !o);
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
              e.stopPropagation(); // sinon l'appui long démarrerait un second glisser
              onTouchDragStart(activity.id, e.touches[0], e.currentTarget.closest('.tl-activity'));
            }}
          >⠿</div>
        ) : null}
        {slot && <span className="tl-activity__time">{slot.start}</span>}
        <span className="tl-activity__emoji">{meta.emoji}</span>
        <span className="tl-activity__title">{activity.title}</span>
        {canOpen && !compareMode && (
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
      {/* Repli sans glisser : un jour se choisit en un tap, ce qui reste le plus
          sûr sur un téléphone où la timeline défile horizontalement. */}
      {open && canMove && (
        <div className="tl-activity__move" onClick={e => e.stopPropagation()}>
          <span className="tl-activity__move-label">Déplacer vers</span>
          <div className="tl-activity__move-pills">
            {days.map((d, i) => d.id === dayId ? null : (
              <button
                key={d.id}
                className="day-pill"
                onClick={() => { setOpen(false); onMoveToDay(dayId, d.id, activity.id); }}
              >J{i + 1}</button>
            ))}
            {onMoveToReserve && (
              <button
                className="day-pill day-pill--reserve"
                onClick={() => { setOpen(false); onMoveToReserve(dayId, activity.id); }}
              >📦 Réserve</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TlDayCard({ day, dayIndex, totalDays, days, onMoveToDay, onMoveToReserve, onOpenDetail, onDrop, compareMode, compareSelectedIds, onToggleCompare, onTouchDragStart, weather }) {
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
              dayId={day.id}
              days={days}
              onMoveToDay={onMoveToDay}
              onMoveToReserve={onMoveToReserve}
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

export default function TimelineView({ days, onOpenDetail, onDrop, onMoveToDay, onMoveToReserve, compareMode, compareSelectedIds, onToggleCompare, onTouchDragStart, weatherByDate }) {
  return (
    <div className="timeline-view-wrap">
      {days.map((day, i) => (
        <TlDayCard
          key={day.id}
          day={day}
          dayIndex={i}
          totalDays={days.length}
          days={days}
          onMoveToDay={onMoveToDay}
          onMoveToReserve={onMoveToReserve}
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
