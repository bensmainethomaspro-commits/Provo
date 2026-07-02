import { useState, useRef, useEffect } from 'react';
import { formatDateShort } from '../utils/helpers';

export default function TripCard({ trip, onClick, onEdit, onDelete, onDuplicate, onPreview }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const menuRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const today = new Date(); today.setHours(0,0,0,0);
  const startDate = new Date(trip.startDate + 'T00:00:00');
  const endDate = new Date(trip.endDate + 'T00:00:00');
  const isPast = endDate < today;
  const isActive = !isPast && startDate <= today && today <= endDate;
  const daysUntil = Math.round((startDate - today) / 86400000);
  const dayIdx = isActive ? Math.round((today - startDate) / 86400000) : -1;

  const dayActs = trip.days.reduce((s, d) => s + d.activities.length, 0);
  const doneActs = trip.days.reduce((s, d) => s + d.activities.filter(a => a.status === 'done').length, 0);
  const actCount = dayActs + trip.reserve.length;

  let badgeText, badgeVariant;
  if (isPast) { badgeText = 'Passé'; badgeVariant = 'past'; }
  else if (isActive) { badgeText = `Jour ${dayIdx + 1}/${trip.days.length}`; badgeVariant = 'active'; }
  else if (daysUntil === 0) { badgeText = 'Aujourd\'hui !'; badgeVariant = 'urgent'; }
  else if (daysUntil === 1) { badgeText = 'Demain !'; badgeVariant = 'urgent'; }
  else { badgeText = `Dans ${daysUntil}j`; badgeVariant = 'upcoming'; }

  const handleTouchStart = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      navigator.vibrate?.(40);
      setActionSheetOpen(true);
    }, 500);
  };

  const cancelLongPress = () => {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [menuOpen]);

  return (
    <>
    <div
      className={`trip-card${isPast ? ' trip-card--past' : isActive ? ' trip-card--active' : ''}${trip.coverPhoto ? ' trip-card--has-cover' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
    >
      {trip.coverPhoto && (
        <div className="trip-card__cover-wrap">
          <img src={trip.coverPhoto} className="trip-card__cover-blur" alt="" loading="lazy" decoding="async" />
        </div>
      )}
      <div
        className="trip-card__emoji"
        onClick={onPreview ? (e) => { e.stopPropagation(); onPreview(); } : undefined}
        style={onPreview ? { cursor: 'pointer' } : {}}
        title={onPreview ? 'Aperçu rapide' : undefined}
      >
        {trip.emoji || '✈️'}
        {onPreview && <span className="trip-card__emoji-hint">ℹ</span>}
      </div>
      <div className="trip-card__info trip-card--clickable" onClick={onClick} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <div className="trip-card__name">{trip.name}</div>
        {trip.destination && <div className="trip-card__dest">📍 {trip.destination}</div>}
        <div className="trip-card__dates">
          {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)}
          {' · '}{trip.days.length}j
          {actCount > 0 && ` · ${actCount} activité${actCount > 1 ? 's' : ''}`}
          {(trip.travelers || 1) > 1 && <span className="trip-card__travelers"> · 👥 {trip.travelers}</span>}
        </div>
        {dayActs > 0 && (
          <div className="trip-card__progress-row">
            <div className="trip-card__progress-track" role="progressbar" aria-valuenow={doneActs} aria-valuemin={0} aria-valuemax={dayActs} aria-label={`${doneActs} activités faites sur ${dayActs}`}>
              <div className="trip-card__progress-bar" style={{ width: `${Math.round(doneActs / dayActs * 100)}%` }} />
            </div>
            <span className="trip-card__progress-label" aria-hidden="true">{doneActs}/{dayActs}</span>
          </div>
        )}
      </div>
      <span className={`trip-card__badge trip-card__badge--${badgeVariant}`}>
        {badgeText}
      </span>
      <div className="trip-card__menu" ref={menuRef}>
        <button className="trip-card__menu-btn" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }} title="Options" aria-label={`Options pour ${trip.name}`} aria-expanded={menuOpen} aria-haspopup="menu">
          ⋮
        </button>
        {menuOpen && (
          <div className="trip-card__dropdown">
            <button className="trip-card__dropdown-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}>
              ✏️ Modifier
            </button>
            {onDuplicate && (
              <button className="trip-card__dropdown-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}>
                📋 Dupliquer
              </button>
            )}
            <button className="trip-card__dropdown-item trip-card__dropdown-item--danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}>
              🗑️ Supprimer
            </button>
          </div>
        )}
      </div>
    </div>
    {actionSheetOpen && (
      <div className="card-action-sheet">
        <div className="card-action-sheet__backdrop" onClick={() => setActionSheetOpen(false)} />
        <div className="card-action-sheet__panel">
          <div className="card-action-sheet__handle" />
          <button className="card-action-sheet__item" onClick={() => { setActionSheetOpen(false); onClick(); }}>
            ✈️ Ouvrir
          </button>
          <button className="card-action-sheet__item" onClick={() => { setActionSheetOpen(false); onEdit(); }}>
            ✏️ Modifier
          </button>
          {onDuplicate && (
            <button className="card-action-sheet__item" onClick={() => { setActionSheetOpen(false); onDuplicate(); }}>
              📋 Dupliquer
            </button>
          )}
          <button className="card-action-sheet__item card-action-sheet__item--danger" onClick={() => { setActionSheetOpen(false); onDelete(); }}>
            🗑️ Supprimer
          </button>
          <button className="card-action-sheet__cancel" onClick={() => setActionSheetOpen(false)}>
            Annuler
          </button>
        </div>
      </div>
    )}
    </>
  );
}
