import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getCategoryMeta, CATEGORY_COLORS, formatDuration, formatPrice, STATUS_CONFIG, getDayLabel, lienItineraire, nomDeLieu } from '../utils/helpers';
import { vibrate } from '../hooks/useSettings';
import ConfirmDialog from './ConfirmDialog';

function ActivityCard({
  activity, context, isLastDay, slot, isPastTrip,
  onStatusChange, onDelete, onMoveToReserve, onMoveToNextDay,
  onEdit, onReorderUp, onReorderDown, isFirst, isLast,
  onDragStart, onDragEnd, isDragging,
  days, currentDayId, onDuplicate,
  compareMode, compareSelected, onToggleCompare,
  onTouchDragStart, enVoiture,
  // Deux fentes, pour que la Réserve n'ait pas son propre dessin de fiche.
  // Elle empilait sa ligne d'état au-dessus et son bouton « Assigner » en
  // dessous : 73 px de rangées à moitié vides, et une fiche qui ne ressemblait
  // plus à celle d'un jour. `etat` se range dans la ligne de méta, où vivent
  // déjà durée, prix et adresse ; `action` se range dans la rangée du haut, à
  // côté du ⋯, qui a de la hauteur à revendre.
  etat, action,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeRef = useRef({ startX: null, startY: null, isDragging: false });
  const SWIPE_MAX = 90;
  const SWIPE_THRESHOLD = 50;
  const [swipeDir, setSwipeDir] = useState(null);

  // L'adresse affichée EST le lien vers l'itinéraire : pas de bouton en plus,
  // et la navigation ne demande plus de déplier la fiche.
  const itineraire = lienItineraire(activity, { enVoiture });

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
  // Pastille de statut : uniquement là où « fait » a du sens (activités d'un jour),
  // pas dans la réserve (boîte à idées) ni sur les polaroids des voyages passés.
  const showCheck = !compareMode && context !== 'reserve' && !showPolaroid;
  const checkLabel = activity.status === 'done' ? 'Marquer comme à faire'
    : activity.status === 'nogo' ? 'Remettre à faire'
    : 'Marquer comme fait';

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', activity.id);
    onDragStart?.();
  };

  const handleTap = useCallback(() => {
    if (compareMode) return;
    // Un tap = déplier/replier les détails. Marquer « fait » se fait désormais
    // via la pastille visible (ou le swipe) — plus de double-tap caché qui
    // entrait en conflit avec l'ouverture des détails.
    setExpanded(e => !e);
    vibrate([8]);
  }, [compareMode]);

  const toggleDone = useCallback((e) => {
    e.stopPropagation();
    // done → à faire · à faire → fait · skippé → remis à faire
    const next = activity.status === 'done' ? 'todo'
      : activity.status === 'nogo' ? 'todo'
      : 'done';
    onStatusChange?.(next);
    vibrate(next === 'done' ? [15, 10, 30] : [8]);
  }, [activity.status, onStatusChange]);

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
            {showCheck && (
              <button
                className={`activity-card__check activity-card__check--${activity.status}`}
                onClick={toggleDone}
                title={checkLabel}
                aria-label={checkLabel}
                aria-pressed={activity.status === 'done'}
              >
                {activity.status === 'done' ? '✓' : activity.status === 'nogo' ? '✕' : ''}
              </button>
            )}
            <div className="activity-card__emoji">{meta.emoji}</div>
            <div className="activity-card__main">
              <div className="activity-card__title">
                {/* La carte est colorée par catégorie, les listes ne l'étaient
                    pas : l'œil ne pouvait pas trier. Un point de 8 px rebranche
                    les deux, sans la lourdeur des barres colorées. */}
                {!activity.isMeal && (
                  <span
                    className="activity-card__dot"
                    style={{ background: CATEGORY_COLORS[activity.category] || 'var(--accent)' }}
                    aria-hidden="true"
                  />
                )}
                {/* Un titre est un nom, jamais une adresse. « Café bel étage,
                    Kärntner Straße 38, 1010 Vienna Austria » tenait sur trois
                    lignes ici, avec la même adresse répétée juste dessous. Le
                    nettoyage existait déjà — mais seulement à l'import : les
                    fiches déjà enregistrées, elles, restaient illisibles. Le
                    faire à l'affichage les répare toutes, sans rien réécrire. */}
                {nomDeLieu(activity.title)}
              </div>
              <div className="activity-card__meta">
                {/* Les métadonnées se lisent, elles ne se décorent pas : l'émoji
                    devant chaque valeur ajoutait quatre pictogrammes colorés par
                    ligne, là où la position et la graisse suffisent à distinguer
                    une heure d'un prix. */}
                {slot && <span className={`time-slot${slot.fixed ? ' time-slot--fixed' : ''}`}>{slot.start} – {slot.end}</span>}
                {dur > 0 && <span className="activity-card__duration">{formatDuration(dur)}</span>}
                {activity.price > 0 && <span className="activity-card__price">{formatPrice(parseFloat(activity.price))}</span>}
                {etat}
                {activity.address && (itineraire
                  ? (
                    <a
                      className="activity-card__address activity-card__address--nav"
                      href={itineraire}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      aria-label={`Itinéraire vers ${nomDeLieu(activity.title)}`}
                    >{activity.address}</a>
                  )
                  : <span className="activity-card__address">{activity.address}</span>
                )}
              </div>
            </div>
            {!compareMode && onTouchDragStart && (
              <div
                className="activity-card__drag-handle"
                title="Glisser pour déplacer"
                onTouchStart={(e) => {
                  e.preventDefault();
                  onTouchDragStart(activity.id, e.touches[0], e.currentTarget.closest('.activity-card'));
                }}
              >⠿</div>
            )}
            {!compareMode && action}
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
                    <img key={i} src={src} className="screenshot-thumb" alt="" loading="lazy" decoding="async"
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

      {/* Un calque plein écran doit être posé sur le document, pas dans la
          carte. Sortir du `<div>` de la fiche ne suffisait pas : la carte de la
          Réserve porte `content-visibility: auto` — posé pour la fluidité des
          longues listes — et cette propriété implique le CONFINEMENT DE
          PEINTURE, ce qui fait de la carte le bloc conteneur de tout
          `position: fixed` situé dedans. Mesuré : le voile faisait 356 × 174 px
          au lieu de 390 × 844, et l'`overflow: hidden` de la carte découpait le
          reste. « ✏️ Modifier », dessiné plus haut que la boîte, n'existait
          simplement pas à l'écran — seuls « Supprimer » et « Annuler » y
          tombaient. Le portail règle les trois calques d'un coup. */}
      {menuOpen && createPortal(
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
                  🌅 On verra plus tard
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
        </div>,
        document.body
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

      {lightboxSrc && createPortal(
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} className="lightbox-img" alt="" />
          <button className="lightbox-close" onClick={() => setLightboxSrc(null)}>✕</button>
        </div>,
        document.body
      )}
    </>
  );
}

/**
 * Mémoïsé : c'est le composant le plus instancié de l'app. Sans lui, allumer
 * « Me situer » redessine toutes les fiches de la liste à chaque relevé GPS,
 * alors qu'aucune n'a changé.
 */
export default memo(ActivityCard);
