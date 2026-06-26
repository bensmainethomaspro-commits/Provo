import { useState, useRef, useEffect, Fragment } from 'react';
import { totalMinutes, formatDuration, formatDate, getDayLabel, getTimeSlots, totalBudget, formatPrice, haversineKm, getCategoryMeta, isClosedOnDate } from '../utils/helpers';
import ActivityCard from './ActivityCard';
import LogicAlerts from './LogicAlerts';
import ConfirmDialog from './ConfirmDialog';
import Confetti from './Confetti';

function formatDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export default function DaySection({
  day, dayIndex, totalDays, isPastTrip,
  onStatusChange, onDelete, onMoveToReserve, onMoveToNextDay,
  onReorder, onStartTimeChange, onEdit, onAddActivity,
  onOpenDetail, onDrop, onNotesChange, onSweep,
  days, onDuplicate,
  compareMode, compareSelectedIds, onToggleCompare,
  weather, onTouchDragStart,
  reserve, onAddFromReserve, onAddTravel, onOptimizeOrder,
  onSwipeDay,
  distFromPrev, getTravelTime,
  onCopyDay, onSortByTime,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [localDragId, setLocalDragId] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [sweepConfirm, setSweepConfirm] = useState(false);
  const [sweepIds, setSweepIds] = useState(new Set());
  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const [copyDayOpen, setCopyDayOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const prevAllDoneRef = useRef(false);
  const dayMenuRef = useRef(null);
  const touchStartRef = useRef(null);

  useEffect(() => {
    if (!dayMenuOpen) return;
    const handle = (e) => { if (dayMenuRef.current && !dayMenuRef.current.contains(e.target)) setDayMenuOpen(false); };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle, { passive: true });
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('touchstart', handle); };
  }, [dayMenuOpen]);
  const isLast = dayIndex === totalDays - 1;

  const notDone = day.activities.filter(a => a.status !== 'done');
  const done = day.activities.filter(a => a.status === 'done');
  const sorted = [...notDone, ...done];

  const active = day.activities.filter(a => a.status !== 'nogo');
  const total = totalMinutes(active);
  const budget = totalBudget(active);
  const overload = total > 8 * 60;
  const slots = getTimeSlots(sorted, day.startTime || '09:00');

  const todoActivities = day.activities.filter(a => a.status === 'todo');
  const hasTodo = todoActivities.length > 0;

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const isPastDay = !isPastTrip && day.date < todayStr;

  // Confetti: trigger when all activities become done/nogo
  const allActsDone = day.activities.length > 0 && day.activities.every(a => a.status !== 'todo');
  useEffect(() => {
    if (allActsDone && !prevAllDoneRef.current && day.activities.length > 0) {
      setShowConfetti(true);
    }
    prevAllDoneRef.current = allActsDone;
  }, [allActsDone, day.activities.length]);

  // Opening hours alerts
  const closedAlerts = day.activities
    .filter(a => a.status !== 'nogo' && a.openingHours && isClosedOnDate(a.openingHours, day.date))
    .map(a => a.title);

  // Rain → indoor reserve suggestions
  const isRainy = weather && (
    (weather.code >= 51 && weather.code <= 67) ||
    (weather.code >= 80 && weather.code <= 82) ||
    (weather.code >= 95 && weather.code <= 99)
  );
  const INDOOR_CATS = ['visite', 'resto', 'fun', 'repos'];
  const indoorSuggestions = isRainy
    ? (reserve || []).filter(a => INDOOR_CATS.includes(a.category)).slice(0, 3)
    : [];

  const freeMin = Math.max(0, 8 * 60 - total);
  const suggestions = freeMin >= 60 ? (reserve || [])
    .filter(a => { const dur = (a.durationHours||0)*60 + (a.durationMinutes||0); return dur > 0 && dur <= freeMin + 30; })
    .slice(0, 3) : [];

  const geoCount = day.activities.filter(a => a.lat && a.lon && a.status !== 'nogo').length;

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

  const handleSweepConfirm = () => {
    const ids = new Set(todoActivities.map(a => a.id));
    setSweepIds(ids);
    setSweepConfirm(false);
    setTimeout(() => {
      onSweep?.(day.id);
      setSweepIds(new Set());
    }, 380);
  };

  const handleHeaderTouchStart = (e) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleHeaderTouchEnd = (e) => {
    if (!touchStartRef.current || !onSwipeDay) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = Math.abs(t.clientY - touchStartRef.current.y);
    touchStartRef.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * dy) {
      onSwipeDay(dx < 0 ? 1 : -1);
    }
  };

  return (
    <div id={`day-${day.id}`} className={`day-section${isPastDay ? ' day-section--past' : ''}`}>
      <Confetti active={showConfetti} onDone={() => setShowConfetti(false)} />
      <div
        className="day-section__header"
        onTouchStart={handleHeaderTouchStart}
        onTouchEnd={handleHeaderTouchEnd}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="day-section__title">{getDayLabel(dayIndex, totalDays)}</div>
          <div className="day-section__date">{formatDate(day.date)}</div>
          {weather && (
            <div className="day-section__weather">
              <span className="day-weather__icon">{weather.icon}</span>
              <span className="day-weather__temps">{weather.max}°/{weather.min}°</span>
              {weather.description && (
                <span className="day-weather__desc">{weather.description}</span>
              )}
            </div>
          )}
          {distFromPrev != null && (
            <div className="day-dist-prev">
              🛣 {distFromPrev < 1 ? `${Math.round(distFromPrev * 1000)} m` : `${distFromPrev.toFixed(1)} km`} depuis le jour précédent
            </div>
          )}
        </div>
        <div className="day-section__right">
          {day.activities.length > 0 && (
            <span className={`day-section__total${overload ? ' day-section__total--overload' : ''}`}>
              {overload ? '⚠️ ' : '⏱ '}{formatDuration(total)}
            </span>
          )}
          {budget > 0 && <span className="day-section__budget">💶 {formatPrice(budget)}</span>}
          <div className="day-menu-wrap" ref={dayMenuRef}>
            <button
              className={`btn btn--xs btn--ghost-white${day.notes ? ' day-menu-btn--noted' : ''}`}
              onClick={() => setDayMenuOpen(o => !o)}
              title="Options du jour"
            >⋯{day.notes ? ' •' : ''}</button>
            {dayMenuOpen && (
              <div className="day-menu">
                <button className="day-menu__item" onClick={() => { setNotesOpen(o => !o); setDayMenuOpen(false); }}>
                  📝 Notes{day.notes ? ' •' : ''}
                </button>
                {onSortByTime && day.activities.some(a => a.fixedStart) && (
                  <button className="day-menu__item" onClick={() => { onSortByTime(day.id); setDayMenuOpen(false); }}>
                    🕐 Trier par heure
                  </button>
                )}
                {geoCount >= 2 && onOptimizeOrder && (
                  <button className="day-menu__item" onClick={() => { onOptimizeOrder(day.id); setDayMenuOpen(false); }}>
                    🗺 Optimiser l'ordre
                  </button>
                )}
                {onCopyDay && days && days.length > 1 && (
                  <button className="day-menu__item" onClick={() => { setCopyDayOpen(true); setDayMenuOpen(false); }}>
                    📋 Copier ce jour vers…
                  </button>
                )}
                <button className="day-menu__item" onClick={() => { onOpenDetail(day); setDayMenuOpen(false); }}>
                  ↗ Détail du jour
                </button>
              </div>
            )}
          </div>
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
        {hasTodo && onSweep && (
          <button
            className="btn btn--xs btn--ghost sweep-btn"
            onClick={() => setSweepConfirm(true)}
            title="Déplacer tout ce qu'il reste à faire dans la Réserve"
          >
            🪄 On verra plus tard
          </button>
        )}
      </div>

      <LogicAlerts activities={day.activities} slots={slots} />

      {closedAlerts.length > 0 && (
        <div className="logic-alerts">
          {closedAlerts.map((title, i) => (
            <div key={i} className="logic-alert logic-alert--closed">
              <span>🔒</span>
              <span>« {title} » pourrait être fermé ce jour-là — vérifiez les horaires.</span>
            </div>
          ))}
        </div>
      )}

      {isRainy && indoorSuggestions.length > 0 && onAddFromReserve && (
        <div className="rain-suggestions">
          <div className="rain-suggestions__header">🌧 Temps pluvieux — idées d'activités en intérieur :</div>
          <div className="rain-suggestions__list">
            {indoorSuggestions.map(a => {
              const meta = getCategoryMeta(a.category);
              return (
                <button key={a.id} className="day-suggestion-pill day-suggestion-pill--rain" onClick={() => onAddFromReserve(day.id, a.id)}>
                  {meta.emoji} {a.title} +
                </button>
              );
            })}
          </div>
        </div>
      )}

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
            const isSweeping = sweepIds.has(activity.id);
            return (
              <Fragment key={activity.id}>
                <div className={isSweeping ? 'activity-sweep-out' : undefined}>
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
                    onTouchDragStart={onTouchDragStart}
                  />
                </div>
                {dist !== null && (() => {
                  const osrm = getTravelTime?.(activity.id, next?.id);
                  const driveMin = osrm ? osrm.minutes : Math.max(5, Math.round(dist * 2));
                  const walkMin = Math.round(dist * 12);
                  return (
                    <div className="activity-bridge">
                      <span className="activity-bridge__line" />
                      <span className="activity-bridge__dist">↕ {formatDist(dist)}</span>
                      {osrm
                        ? <span className="activity-bridge__osrm">🚗 {osrm.minutes}min</span>
                        : null
                      }
                      {onAddTravel && (
                        <>
                          {!osrm && <button className="travel-btn" title="Ajouter trajet à pied" onClick={() => onAddTravel(day.id, activity.id, walkMin)}>🚶 {walkMin}min</button>}
                          <button className="travel-btn" title="Ajouter trajet en voiture" onClick={() => onAddTravel(day.id, activity.id, driveMin)}>🚗 {driveMin}min</button>
                        </>
                      )}
                      <span className="activity-bridge__line" />
                    </div>
                  );
                })()}
              </Fragment>
            );
          })
        }
      </div>

      {suggestions.length > 0 && onAddFromReserve && (
        <div className="day-suggestions">
          <div className="day-suggestions__header">✨ {Math.floor(freeMin / 60)}h{freeMin % 60 > 0 ? `${freeMin % 60}min` : ''} de libre — idées depuis la réserve :</div>
          <div className="day-suggestions__list">
            {suggestions.map(a => {
              const meta = getCategoryMeta(a.category);
              const dur = (a.durationHours||0)*60 + (a.durationMinutes||0);
              return (
                <button key={a.id} className="day-suggestion-pill" onClick={() => onAddFromReserve(day.id, a.id)}>
                  {meta.emoji} {a.title} · {formatDuration(dur)} +
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {copyDayOpen && (
        <div className="sheet-overlay" onClick={() => setCopyDayOpen(false)}>
          <div className="copy-day-picker" onClick={e => e.stopPropagation()}>
            <div className="copy-day-picker__title">📋 Copier {getDayLabel(dayIndex, totalDays)} vers :</div>
            {(days || []).filter(d => d.id !== day.id).map((d, _, arr) => {
              const idx = days.findIndex(x => x.id === d.id);
              return (
                <button key={d.id} className="copy-day-picker__item"
                  onClick={() => { onCopyDay(day.id, d.id); setCopyDayOpen(false); }}>
                  {getDayLabel(idx, totalDays)} · {formatDate(d.date).split(' ').slice(0, 3).join(' ')}
                </button>
              );
            })}
            <button className="btn btn--secondary btn--full" style={{ marginTop: 8 }} onClick={() => setCopyDayOpen(false)}>Annuler</button>
          </div>
        </div>
      )}

      {sweepConfirm && (
        <ConfirmDialog
          icon="🪄"
          title="On verra plus tard ?"
          message={`${todoActivities.length} activité${todoActivities.length > 1 ? 's' : ''} "à faire" seront déplacées au sommet de la Réserve.`}
          confirmLabel="Balayer !"
          onConfirm={handleSweepConfirm}
          onCancel={() => setSweepConfirm(false)}
        />
      )}
    </div>
  );
}
