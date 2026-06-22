import { useState } from 'react';
import { getCategoryMeta, formatDuration, formatPrice, STATUS_CONFIG } from '../utils/helpers';
import ConfirmDialog from './ConfirmDialog';

export default function ActivityCard({
  activity, context, isLastDay, slot, isPastTrip,
  onStatusChange, onDelete, onMoveToReserve, onMoveToDay, onMoveToNextDay,
  onEdit, onReorderUp, onReorderDown, isFirst, isLast,
  onDragStart, onDragEnd, isDragging
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);
  const showPolaroid = isPastTrip && activity.status === 'done';

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', activity.id);
    onDragStart?.();
  };

  return (
    <>
      <div
        className={`activity-card activity-card--${activity.status}${isDragging ? ' activity-card--dragging' : ''}${showPolaroid ? ' activity-card--polaroid' : ''}`}
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={() => onDragEnd?.()}
      >
        <div className="activity-card__top">
          <div className="activity-card__drag-handle" title="Glisser">⠿</div>
          <div className="activity-card__emoji">{meta.emoji}</div>
          <div className="activity-card__main">
            <div className="activity-card__title">{activity.title}</div>
            <div className="activity-card__meta">
              {slot && <span className="time-slot">{slot.start} – {slot.end}</span>}
              {dur > 0 && <span className="activity-card__duration">⏱ {formatDuration(dur)}</span>}
              {activity.price > 0 && <span className="activity-card__price">💶 {formatPrice(parseFloat(activity.price))}</span>}
              {activity.address && <span className="activity-card__address">📍 {activity.address}</span>}
            </div>
            {activity.link && (
              <div className="activity-card__link">
                <a href={activity.link} target="_blank" rel="noopener noreferrer">🔗 {(() => { try { return new URL(activity.link).hostname; } catch { return activity.link; } })()}</a>
              </div>
            )}
            {activity.notes && <div className="activity-card__notes">{activity.notes}</div>}
          </div>
          <div className="activity-card__reorder">
            <button className="reorder-btn" onClick={onReorderUp} disabled={isFirst} title="Monter">▲</button>
            <button className="reorder-btn" onClick={onReorderDown} disabled={isLast} title="Descendre">▼</button>
          </div>
        </div>

        <div className="activity-card__actions">
          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
            <button key={s}
              className={`status-btn status-btn--${s}${activity.status === s ? ' active' : ''}`}
              onClick={() => onStatusChange(s)}>
              {cfg.emoji} {cfg.label}
            </button>
          ))}
          <div className="activity-card__move-actions">
            <button className="move-btn" title="Modifier" onClick={onEdit}>✏️</button>
            {context === 'day' && !isLastDay && onMoveToNextDay && (
              <button className="move-btn" title="Reporter au lendemain" onClick={onMoveToNextDay}>📅</button>
            )}
            {context === 'day' && (
              <button className="move-btn" title="Mettre en réserve" onClick={onMoveToReserve}>📦</button>
            )}
            <button className="move-btn move-btn--danger" title="Supprimer" onClick={() => setDeleteConfirm(true)}>🗑️</button>
          </div>
        </div>
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          icon="🗑️"
          title="Supprimer cette activité ?"
          message={`"${activity.title}" sera supprimée définitivement.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={() => { setDeleteConfirm(false); onDelete(); }}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </>
  );
}
