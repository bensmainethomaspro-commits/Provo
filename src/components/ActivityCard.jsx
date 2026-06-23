import { useState, useRef, useEffect, useCallback } from 'react';
import { getCategoryMeta, formatDuration, formatPrice, STATUS_CONFIG, getDayLabel } from '../utils/helpers';
import ConfirmDialog from './ConfirmDialog';

export default function ActivityCard({
  activity, context, isLastDay, slot, isPastTrip,
  onStatusChange, onDelete, onMoveToReserve, onMoveToNextDay,
  onEdit, onReorderUp, onReorderDown, isFirst, isLast,
  onDragStart, onDragEnd, isDragging,
  days, currentDayId, onDuplicate,
  compareMode, compareSelected, onToggleCompare,
  onTouchDragStart,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeRef = useRef({ startX: null, startY: null, isDragging: false });
  const copyRef = useRef(null);
  const SWIPE_MAX = 110;
  const SWIPE_THRESHOLD = 55;

  const handleSwipeTouchStart = useCallback((e) => {
    if (compareMode || e.target.closest('.activity-card__drag-handle')) return;
    if (swipeOffset < -SWIPE_THRESHOLD) { setSwipeOffset(0); return; }
    swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, isDragging: false };
  }, [compareMode, swipeOffset]);

  const handleSwipeTouchMove = useCallback((e) => {
    const s = swipeRef.current;
    if (s.startX === null) return;
    const dx = e.touches[0].clientX - s.startX;
    const dy = Math.abs(e.touches[0].clientY - s.startY);
    if (!s.isDragging) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > dy) s.isDragging = true;
      else if (dy > 8) { s.startX = null; return; }
      else return;
    }
    if (dx < 0) { e.stopPropagation(); setSwipeOffset(Math.max(-SWIPE_MAX, dx)); }
  }, []);

  const handleSwipeTouchEnd = useCallback(() => {
    swipeRef.current.startX = null;
    setSwipeOffset(p => Math.abs(p) > SWIPE_THRESHOLD ? -SWIPE_MAX : 0);
  }, []);

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
        className="activity-card-swipe"
        onTouchStart={handleSwipeTouchStart}
        onTouchMove={handleSwipeTouchMove}
        onTouchEnd={handleSwipeTouchEnd}
      >
      <div
        className={[
          'activity-card',
          `activity-card--${activity.status}`,
          isDragging ? 'activity-card--dragging' : '',
          showPolaroid ? 'activity-card--polaroid' : '',
          compareSelected ? 'activity-card--compare-selected' : '',
        ].filter(Boolean).join(' ')}
        style={{ transform: `translateX(${swipeOffset}px)`, transition: swipeRef.current.isDragging ? 'none' : 'transform 0.2s ease' }}
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
          {!compareMode && (
          <div
            className="activity-card__drag-handle"
            title="Glisser"
            onTouchStart={(e) => {
              if (!onTouchDragStart) return;
              e.preventDefault();
              onTouchDragStart(activity.id, e.touches[0], e.currentTarget.closest('.activity-card'));
            }}
          >⠿</div>
        )}
          <div className="activity-card__emoji">{meta.emoji}</div>
          <div className="activity-card__main">
            <div className="activity-card__title">{activity.title}</div>
            <div className="activity-card__meta">
              {slot && <span className={`time-slot${slot.fixed ? ' time-slot--fixed' : ''}`}>{slot.fixed ? '📌 ' : ''}{slot.start} – {slot.end}</span>}
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

      {swipeOffset < -20 && (
        <div className="activity-card__swipe-actions">
          <button className="swipe-action swipe-action--done"
            onTouchEnd={(e) => { e.preventDefault(); onStatusChange('done'); setSwipeOffset(0); }}>
            <span>✅</span><span>Fait</span>
          </button>
          {context === 'day' && onMoveToReserve && (
            <button className="swipe-action swipe-action--reserve"
              onTouchEnd={(e) => { e.preventDefault(); onMoveToReserve(); setSwipeOffset(0); }}>
              <span>📦</span><span>Réserve</span>
            </button>
          )}
          <button className="swipe-action swipe-action--delete"
            onTouchEnd={(e) => { e.preventDefault(); setDeleteConfirm(true); setSwipeOffset(0); }}>
            <span>🗑️</span><span>Suppr.</span>
          </button>
        </div>
      )}
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
