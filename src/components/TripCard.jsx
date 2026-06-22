import { formatDateShort } from '../utils/helpers';

export default function TripCard({ trip, onClick }) {
  const isPast = (() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return new Date(trip.endDate + 'T00:00:00') < today;
  })();

  const activityCount = trip.days.reduce((s, d) => s + d.activities.length, 0) + trip.reserve.length;

  return (
    <div className={`trip-card${isPast ? ' trip-card--past' : ''}`} onClick={onClick}>
      <div className="trip-card__icon">✈️</div>
      <div className="trip-card__info">
        <div className="trip-card__name">{trip.name}</div>
        {trip.destination && <div className="trip-card__dest">📍 {trip.destination}</div>}
        <div className="trip-card__dates">
          {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)}
          {' · '}{trip.days.length} jour{trip.days.length > 1 ? 's' : ''}
          {activityCount > 0 && ` · ${activityCount} activité${activityCount > 1 ? 's' : ''}`}
        </div>
      </div>
      <span className={`trip-card__badge trip-card__badge--${isPast ? 'past' : 'upcoming'}`}>
        {isPast ? 'Passé' : 'À venir'}
      </span>
      <span className="trip-card__arrow">›</span>
    </div>
  );
}
