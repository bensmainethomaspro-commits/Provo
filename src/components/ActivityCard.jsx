import { useState, useRef, useEffect } from 'react';
import { getCategoryMeta, formatDuration, formatPrice, STATUS_CONFIG, getDayLabel } from '../utils/helpers';
import ConfirmDialog from './ConfirmDialog';

export default function ActivityCard({
  activity, context, isLastDay, slot, isPastTrip,
  onStatusChange, onDelete, onMoveToReserve, onMoveToNextDay,
  onEdit, onReorderUp, onReorderDown, isFirst, isLast,
  onDragStart, onDragEnd, isDragging,
  days, currentDayId, onDuplicate,
  compareMode, compareSelected, onToggleCompare,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const copyRef = useRef(null);

  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);
  const showPolaroid = isPastTrip && activity.status === 'done';
  const otherDays = days?.filter(d => d.id !== currentDayId) || [];

  useEffect(() => {
    if (!showCopyPicker) return;
    const handler = (e) => {
      if (copyRef.current && !copyRef.current.contains(e.target)) setShowCopyPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCopyPicker]);

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', activity.id);
    onDragStart?.();
  };

  return (
    <>
      <div
        className={[
          'activity-card',
          `activity-card--${activity.status}`,
          isDragging ? 'activity-card--dragging' : '',
          showPolaroid ? 'activity-card--polaroid' : '',
          compareSelected ? 'activity-card--compare-selected' : '',
        ].filter(Boolean).join(' ')}
        data-category={activity.category}
        draggable={!compareMode}
        onDragStart={handleDragStart}
        onDragEnd={() => onDragEnd?.()}
      >
        {activity.photoUrl && (
          <img src={activity.photoUrl} className="activity-card__photo" alt="" />
        )}

        {compareMode && (
          <label className="activity-card__compare-check" onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={!!compareSelected} onChange={onToggleCompare} />
            <span>{compareSelected ? '✓' : ''}</span>
          </label>
        )}

        <div className="activity-card__top">
          {!compareMode && <div className="activity-card__drag-handle" title="Glisser">⠿</div>}
          <div className="activity-card__emoji">{meta.emoji}</div>
          <div className="activity-card__main">
            <div className="activity-card__title">{activity.title}</div>
            <div className="activity-card__meta">
              {slot && <span className="time-slot">{slot.start} – {slot.end}</span>}
              {dur > 0 && <span className="activity-card__duration">⏱ {formatDuration(dur)}</span>}
              {activity.price > 0 && <span className="activity-card__price">💶 {formatPrice(parseFloat(activity.price))}</span>}
              {activity.address && <span className="activity-card__address">📍 {activity.address}</span>}
              {activity.openingHours && <span className="activity-card__hours">🕐 {activity.openingHours}</span>}
            </div>
            {activity.link && (
              <div className="activity-card__link">
                <a href={activity.link} target="_blank" rel="noopener noreferrer">
                  🔗 {(() => { try { return new URL(activity.link).hostname; } catch { return activity.link.slice(0, 30); } })()}
                </a>
              </div>
            )}
            {activity.notes && <div className="activity-card__notes">{activity.notes}</div>}
            {activity.screenshots?.length > 0 && (
              <div className="activity-card__screenshots">
                {activity.screenshots.map((src, i) => (
                  <img key={i} src={src} className="screenshot-thumb" alt=""
                    onClick={() => setLightboxSrc(src)} />
                ))}
              </div>
            )}
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
            {onDuplicate && otherDays.length > 0 && (
              <div ref={copyRef} style={{ position: 'relative' }}>
                <button className="move-btn" title="Copier vers un autre jour"
                  onClick={(e) => { e.stopPropagation(); setShowCopyPicker(p => !p); }}>
                  📋
                </button>
                {showCopyPicker && (
                  <div className="copy-picker">
                    <div className="copy-picker__label">Copier vers :</div>
                    {otherDays.map(d => {
                      const idx = days.findIndex(x => x.id === d.id);
                      return (
                        <button key={d.id} className="copy-picker__item"
                          onClick={(e) => { e.stopPropagation(); onDuplicate(d.id); setShowCopyPicker(false); }}>
                          {getDayLabel(idx, days.length)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
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

      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} className="lightbox-img" alt="" />
          <button className="lightbox-close" onClick={() => setLightboxSrc(null)}>✕</button>
        </div>
      )}
    </>
  );
}
