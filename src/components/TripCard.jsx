import { useState, useRef, useEffect } from 'react';
import { formatDateShort } from '../utils/helpers';

export default function TripCard({ trip, onClick, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isPast = (() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return new Date(trip.endDate + 'T00:00:00') < today;
  })();

  const actCount = trip.days.reduce((s, d) => s + d.activities.length, 0) + trip.reserve.length;

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
    <div className={`trip-card${isPast ? ' trip-card--past' : ''}`}>
      <div className="trip-card__emoji">{trip.emoji || '✈️'}</div>
      <div className="trip-card__info trip-card--clickable" onClick={onClick} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <div className="trip-card__name">{trip.name}</div>
        {trip.destination && <div className="trip-card__dest">📍 {trip.destination}</div>}
        <div className="trip-card__dates">
          {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)}
          {' · '}{trip.days.length}j
          {actCount > 0 && ` · ${actCount} activité${actCount > 1 ? 's' : ''}`}
        </div>
      </div>
      <span className={`trip-card__badge trip-card__badge--${isPast ? 'past' : 'upcoming'}`}>
        {isPast ? 'Passé' : 'À venir'}
      </span>
      <div className="trip-card__menu" ref={menuRef}>
        <button className="trip-card__menu-btn" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }} title="Options">
          ⋮
        </button>
        {menuOpen && (
          <div className="trip-card__dropdown">
            <button className="trip-card__dropdown-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}>
              ✏️ Modifier
            </button>
            <button className="trip-card__dropdown-item trip-card__dropdown-item--danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}>
              🗑️ Supprimer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
