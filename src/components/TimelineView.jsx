import { totalMinutes, formatDuration, getDayLabel, formatDateShort, totalBudget, formatPrice, getCategoryMeta, getTimeSlots } from '../utils/helpers';

function TlActivity({ activity, slot }) {
  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);
  return (
    <div
      className={`tl-activity tl-activity--${activity.status}`}
      data-category={activity.category}
    >
      <div className="tl-activity__top">
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

function TlDayCard({ day, dayIndex, totalDays, onOpenDetail }) {
  const active = day.activities.filter(a => a.status !== 'nogo');
  const totalMin = totalMinutes(active);
  const budget = totalBudget(day.activities);
  const slots = getTimeSlots(day.activities, day.startTime || '09:00');

  return (
    <div className="tl-day" onClick={() => onOpenDetail(day)}>
      <div className="tl-day__header">
        <div className="tl-day__label">{getDayLabel(dayIndex, totalDays)}</div>
        <div className="tl-day__date">{formatDateShort(day.date)}</div>
        <div className="tl-day__stats">
          {totalMin > 0 && <span>{formatDuration(totalMin)}</span>}
          {budget > 0 && <span>{formatPrice(budget)}</span>}
          {active.length === 0 && <span className="tl-day__empty-hint">Vide</span>}
        </div>
      </div>
      <div className="tl-day__body">
        {day.activities.length === 0 ? (
          <div className="tl-day__no-act">Aucune activité</div>
        ) : (
          day.activities.map(a => (
            <TlActivity key={a.id} activity={a} slot={slots[a.id]} />
          ))
        )}
      </div>
    </div>
  );
}

export default function TimelineView({ days, onOpenDetail }) {
  return (
    <div className="timeline-view-wrap">
      {days.map((day, i) => (
        <TlDayCard
          key={day.id}
          day={day}
          dayIndex={i}
          totalDays={days.length}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}
