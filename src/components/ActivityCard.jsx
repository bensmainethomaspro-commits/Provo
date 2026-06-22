import { useState } from 'react';
import { getCategoryMeta, formatDuration, STATUS_CONFIG } from '../utils/helpers';
import ConfirmDialog from './ConfirmDialog';

export default function ActivityCard({ activity, context, days, onStatusChange, onDelete,
  onMoveToReserve, onMoveToDay, onMoveToNextDay, isLastDay }) {
  const [nogoConfirm, setNogoConfirm] = useState(false);
  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);

  const handleStatus = (status) => {
    if (status === 'nogo') { setNogoConfirm(true); return; }
    onStatusChange(status);
  };

  return (
    <>
      <div className={`activity-card activity-card--${activity.status}`}>
        <div className="activity-card__top">
          <div className="activity-card__emoji">{meta.emoji}</div>
          <div className="activity-card__main">
            <div className="activity-card__title">{activity.title}</div>
            <div className="activity-card__meta">
              {dur > 0 && <span className="activity-card__duration">⏱ {formatDuration(dur)}</span>}
              {activity.address && <span className="activity-card__address">📍 {activity.address}</span>}
            </div>
            {activity.notes && <div className="activity-card__notes">{activity.notes}</div>}
          </div>
        </div>

        <div className="activity-card__actions">
          {(['todo', 'done', 'nogo']).map(s => (
            <button key={s}
              className={`status-btn status-btn--${s}${activity.status === s ? ' active' : ''}`}
              onClick={() => handleStatus(s)}>
              {STATUS_CONFIG[s].emoji} {STATUS_CONFIG[s].label}
            </button>
          ))}
          <div className="activity-card__move-actions">
            {context === 'day' && !isLastDay && onMoveToNextDay && (
              <button className="move-btn" title="Reporter au lendemain" onClick={onMoveToNextDay}>📅</button>
            )}
            {context === 'day' && (
              <button className="move-btn" title="Mettre en réserve" onClick={onMoveToReserve}>📦</button>
            )}
            <button className="move-btn move-btn--danger" title="Supprimer" onClick={onDelete}>🗑️</button>
          </div>
        </div>
      </div>

      {nogoConfirm && (
        <ConfirmDialog
          icon="❌"
          title="Activité annulée"
          message={`Que veux-tu faire avec "${activity.title}" ?`}
          confirmLabel="Supprimer"
          cancelLabel="Mettre en réserve"
          danger
          onConfirm={() => { setNogoConfirm(false); onDelete(); }}
          onCancel={() => {
            setNogoConfirm(false);
            onStatusChange('nogo');
            if (context === 'day' && onMoveToReserve) onMoveToReserve();
          }}
        />
      )}
    </>
  );
}
