import { useState, useRef, useEffect, useCallback } from 'react';
import { getCategoryMeta, formatDuration, formatPrice, STATUS_CONFIG, getDayLabel } from '../utils/helpers';
import { vibrate } from '../hooks/useSettings';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeRef = useRef({ startX: null, startY: null, isDragging: false });
  const lastTapRef = useRef(0);
  const SWIPE_MAX = 90;
  const SWIPE_THRESHOLD = 50;
  const [swipeDir, setSwipeDir] = useState(null);

  const handleSwipeTouchStart = useCallback((e) => {
    if (compareMode || e.target.closest('.activity-card__drag-handle')) return;
    swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, isDragging: false };
    setSwipeDir(null);
  }, [compareMode]);

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
    e.stopPropagation();
    const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
    setSwipeOffset(clamped);
    setSwipeDir(dx > 0 ? 'right' : 'left');
  }, []);

  const handleSwipeTouchEnd = useCallback(() => {
    swipeRef.current.startX = null;
    setSwipeOffset(prev => {
      if (prev > SWIPE_THRESHOLD) {
        onStatusChange?.('done');
        vibrate([15, 10, 30]);
        setSwipeDir(null);
        return 0;
      }
      if (prev < -SWIPE_THRESHOLD) {
        onStatusChange?.('nogo');
        vibrate([5, 5, 5]);
        setSwipeDir(null);
        return 0;
      }
      setSwipeDir(null);
      return 0;
    });
  }, [onStatusChange]);

  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);
  const showPolaroid = isPastTrip && activity.status === 'done';
  const otherDays = days?.filter(d => d.id !== currentDayId) || [];

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', activity.id);
    onDragStart?.();
  };

  const handleTap = useCallback(() => {
    if (compareMode) return;
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      // Double-tap: toggle done/todo
      const newStatus = activity.status === 'done' ? 'todo' : 'done';
      onStatusChange?.(newStatus);
      vibrate([15, 10, 30]);
    } else {
      // Single-tap: toggle expand/collapse
      setExpanded(e => !e);
      vibrate([8]);
    }
    lastTapRef.current = now;
  }, [compareMode, activity.status, onStatusChange]);

  const handleShareActivity = useCallback(() => {
    const parts = [`📌 ${activity.title}`];
    if (activity.address) parts.push(`📍 ${activity.address}`);
    if (activity.link) parts.push(`🔗 ${activity.link}`);
    const text = parts.join('\n');
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
    setMenuOpen(false);
  }, [activity]);

  const isExpandedOrPast = expanded || showPolaroid;

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
            isExpandedOrPast ? 'activity-card--expanded' : '',
            activity.mustDo ? 'activity-card--mustdo' : '',
          ].filter(Boolean).join(' ')}
          style={{ transform: `translateX(${swipeOffset}px)`, transition: swipeRef.current.isDragging ? 'none' : 'transform 0.2s ease' }}
          data-category={activity.category}
          draggable={!compareMode}
          onDragStart={handleDragStart}
          onDragEnd={() => onDragEnd?.()}
          onClick={handleTap}
        >
          {activity.photoUrl && (
            <img
              src={activity.photoUrl}
              className="activity-card__photo"
              alt=""
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
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
              </div>
            </div>
            {!compareMode && (
              <button
                className="activity-card__dots-btn"
                onClick={e => { e.stopPropagation(); setMenuOpen(true); vibrate([8]); }}
                title="Options"
                aria-label="Options de l'activité"
              >
                ⋯
              </button>
            )}
          </div>

          {/* Expanded content */}
          {isExpandedOrPast && (
            <div className="activity-card__expand" onClick={e => e.stopPropagation()}>
              {activity.openingHours && <div className="activity-card__hours">🕐 {activity.openingHours}</div>}
              {activity.address && (
                <div className="activity-card__nav">
                  <a
                    href={activity.lat && activity.lon
                      ? `https://maps.google.com/maps?daddr=${activity.lat},${activity.lon}&directionsmode=driving`
                      : `https://maps.google.com/maps?daddr=${encodeURIComponent(activity.address)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nav-btn"
                    title="Naviguer vers ce lieu"
                  >
                    🧭 Y aller
                  </a>
                </div>
              )}
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

              <div className="activity-card__actions">
                <div className="activity-card__status-row">
                  {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
                    <button key={s}
                      className={`status-btn status-btn--${s}${activity.status === s ? ' active' : ''}`}
                      onClick={() => { onStatusChange(s); vibrate([10]); }}>
                      {cfg.emoji} {cfg.label}
                    </button>
                  ))}
                </div>
                {(activity.pdfs || []).length > 0 && (
                  <div className="pdf-list" style={{ marginTop: 6 }}>
                    {activity.pdfs.map((p, i) => (
                      <a key={i} href={p.data} target="_blank" rel="noopener noreferrer" className="pdf-chip">
                        <span className="pdf-chip__icon">📄</span>
                        <span className="pdf-chip__name">{p.name}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {Math.abs(swipeOffset) > 12 && (
          <div className={`swipe-hint swipe-hint--${swipeDir}`}>
            {swipeDir === 'right' ? (
              <><span className="swipe-hint__icon">✅</span><span className="swipe-hint__label">Fait</span></>
            ) : (
              <><span className="swipe-hint__label">Skip</span><span className="swipe-hint__icon">❌</span></>
            )}
          </div>
        )}
      </div>

      {/* iOS-style action sheet — rendered outside overflow:hidden container */}
      {menuOpen && (
        <div className="act-sheet-overlay" onClick={() => setMenuOpen(false)}>
          <div className="act-sheet" onClick={e => e.stopPropagation()}>
            <div className="act-sheet__title">{activity.title}</div>
            <div className="act-sheet__actions">
              <button className="act-sheet__item" onClick={() => { onEdit(); setMenuOpen(false); }}>
                ✏️ Modifier
              </button>
              {!isFirst && onReorderUp && (
                <button className="act-sheet__item" onClick={() => { onReorderUp(); setMenuOpen(false); }}>
                  ▲ Remonter
                </button>
              )}
              {!isLast && onReorderDown && (
                <button className="act-sheet__item" onClick={() => { onReorderDown(); setMenuOpen(false); }}>
                  ▼ Descendre
                </button>
              )}
              {context === 'day' && onMoveToNextDay && (
                <button className="act-sheet__item" onClick={() => { onMoveToNextDay(); setMenuOpen(false); }}>
                  🌅 On verra demain
                </button>
              )}
              {onDuplicate && otherDays.length > 0 && (
                <>
                  <div className="act-sheet__sep" />
                  <div className="act-sheet__label">Copier vers :</div>
                  {otherDays.map(d => {
                    const idx = days.findIndex(x => x.id === d.id);
                    return (
                      <button key={d.id} className="act-sheet__item" onClick={() => { onDuplicate(d.id); setMenuOpen(false); }}>
                        📋 {getDayLabel(idx, days.length)}
                      </button>
                    );
                  })}
                </>
              )}
              <div className="act-sheet__sep" />
              <button className="act-sheet__item" onClick={handleShareActivity}>
                ↗️ Partager
              </button>
              <button className="act-sheet__item act-sheet__item--danger" onClick={() => { setDeleteConfirm(true); setMenuOpen(false); }}>
                🗑️ Supprimer
              </button>
            </div>
            <button className="act-sheet__cancel" onClick={() => setMenuOpen(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}

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
