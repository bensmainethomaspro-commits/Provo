import { totalMinutes, formatDuration, formatDate, getDayLabel } from '../utils/helpers';
import ActivityCard from './ActivityCard';
import LogicAlerts from './LogicAlerts';

export default function DaySection({ day, dayIndex, totalDays, tripId, onStatusChange, onDelete,
  onMoveToReserve, onMoveToNextDay }) {
  const total = totalMinutes(day.activities.filter(a => a.status !== 'nogo'));
  const isLast = dayIndex === totalDays - 1;
  const overload = total > 8 * 60;

  return (
    <div className="day-section">
      <div className="day-section__header">
        <div>
          <div className="day-section__title">{getDayLabel(dayIndex, totalDays)}</div>
          <div className="day-section__date">{formatDate(day.date)}</div>
        </div>
        {day.activities.length > 0 && (
          <span className={`day-section__total${overload ? ' day-section__total--overload' : ''}`}>
            {overload ? '⚠️ ' : ''}Total : {formatDuration(total)}
          </span>
        )}
      </div>

      <LogicAlerts activities={day.activities} />

      <div className="day-section__body">
        {day.activities.length === 0
          ? <div className="day-section__empty">Aucune activité — glisse-en une depuis la Réserve !</div>
          : day.activities.map(activity => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              context="day"
              isLastDay={isLast}
              onStatusChange={(s) => onStatusChange(day.id, activity.id, s)}
              onDelete={() => onDelete(day.id, activity.id)}
              onMoveToReserve={() => onMoveToReserve(day.id, activity.id)}
              onMoveToNextDay={!isLast ? () => onMoveToNextDay(day.id, activity.id) : null}
            />
          ))
        }
      </div>
    </div>
  );
}
