import { useState, useEffect, useRef } from 'react';
import { useTripsContext } from '../context/TripsContext';
import DaySection from '../components/DaySection';
import DayDetailModal from '../components/DayDetailModal';
import ActivityCard from '../components/ActivityCard';
import AddActivitySheet from '../components/AddActivitySheet';
import ShareModal from '../components/ShareModal';
import ConfirmDialog from '../components/ConfirmDialog';
import CompareModal from '../components/CompareModal';
import TimelineView from '../components/TimelineView';
import AgendaView from '../components/AgendaView';
import LiveDayCard from '../components/LiveDayCard';
import MapView from '../components/MapView';
import PackingList from '../components/PackingList';
import TripSummary from '../components/TripSummary';
import { useWeather } from '../hooks/useWeather';
import { formatDateShort, budgetStats, formatPrice, formatDate, formatDuration, getCategoryMeta, CATEGORIES, nearestNeighborSort } from '../utils/helpers';

function useTouchDnd({ tripId, tripRef, moveFromReserveToDay, moveDayToDay, moveToReserve }) {
  const stateRef = useRef({ id: null, ghost: null, offset: { x: 0, y: 0 }, sourceEl: null, dropZone: null });

  const handleTouchDragStart = (activityId, touch, sourceEl) => {
    const s = stateRef.current;
    s.id = activityId;
    s.sourceEl = sourceEl;
    const rect = sourceEl.getBoundingClientRect();
    s.offset = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    const ghost = sourceEl.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', pointerEvents: 'none', zIndex: '9999',
      opacity: '0.88', transform: 'scale(1.03) rotate(1deg)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)', transition: 'none', borderRadius: '16px',
    });
    document.body.appendChild(ghost);
    s.ghost = ghost;
    sourceEl.classList.add('activity-card--dragging');
  };

  useEffect(() => {
    const onMove = (e) => {
      const s = stateRef.current;
      if (!s.ghost) return;
      e.preventDefault();
      const touch = e.touches[0];
      s.ghost.style.left = (touch.clientX - s.offset.x) + 'px';
      s.ghost.style.top = (touch.clientY - s.offset.y) + 'px';
      s.ghost.style.visibility = 'hidden';
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      s.ghost.style.visibility = '';
      const newZone = el?.closest('[data-drop-zone="true"]') || null;
      if (newZone !== s.dropZone) {
        s.dropZone?.classList.remove('day-section__body--drop-target');
        newZone?.classList.add('day-section__body--drop-target');
        s.dropZone = newZone;
      }
    };

    const onEnd = (e) => {
      const s = stateRef.current;
      if (!s.ghost) return;
      const touch = e.changedTouches[0];
      s.ghost.style.visibility = 'hidden';
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      s.ghost.style.visibility = '';
      const zone = el?.closest('[data-drop-zone="true"]') || s.dropZone;
      if (zone && s.id) {
        const zoneType = zone.dataset.zoneType;
        const dayId = zone.dataset.dayId;
        const itemId = s.id;
        const trip = tripRef.current;
        if (zoneType === 'day' && dayId) {
          const isInReserve = trip.reserve.some(a => a.id === itemId);
          if (isInReserve) moveFromReserveToDay(tripId, dayId, itemId);
          else {
            const srcDay = trip.days.find(d => d.activities.some(a => a.id === itemId));
            if (srcDay && srcDay.id !== dayId) moveDayToDay(tripId, srcDay.id, dayId, itemId);
          }
        } else if (zoneType === 'reserve') {
          const srcDay = trip.days.find(d => d.activities.some(a => a.id === itemId));
          if (srcDay) moveToReserve(tripId, srcDay.id, itemId);
        }
      }
      s.dropZone?.classList.remove('day-section__body--drop-target');
      zone?.classList.remove('day-section__body--drop-target');
      if (s.ghost) { s.ghost.remove(); s.ghost = null; }
      s.sourceEl?.classList.remove('activity-card--dragging');
      s.id = null; s.sourceEl = null; s.dropZone = null;
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [tripId, moveFromReserveToDay, moveDayToDay, moveToReserve]); // eslint-disable-line react-hooks/exhaustive-deps

  return handleTouchDragStart;
}

export default function TripView({ tripId, onBack, darkMode, onToggleDark }) {
  const {
    getTripById, setActivityStatus, updateActivity, deleteActivity,
    moveToReserve, moveFromReserveToDay, moveDayToDay, moveToNextDay,
    addToReserve, addToDay, reorderActivity, reorderInReserve,
    setDayStartTime, deleteTrip, duplicateToDay, updateTrip,
    setDayNotes, addPackingItem, togglePackingItem, deletePackingItem,
    setPackingOrder, sweepDayToReserve,
    restoreTrip, addTravelBlock, setDayActivitiesOrder,
  } = useTripsContext();

  const trip = getTripById(tripId);
  const weather = useWeather(trip);
  const [tab, setTab] = useState('planning');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDefaultDayId, setSheetDefaultDayId] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);
  const [detailDay, setDetailDay] = useState(null);
  const [reserveExpanded, setReserveExpanded] = useState(false);
  const [reserveDragOver, setReserveDragOver] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelectedIds, setCompareSelectedIds] = useState(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [viewMode, setViewMode] = useState('timeline');
  const [reserveFilter, setReserveFilter] = useState('all');
  const [reserveSearch, setReserveSearch] = useState('');
  const [reserveSort, setReserveSort] = useState('default');
  const [copyDone, setCopyDone] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoMsg, setUndoMsg] = useState('');
  const [tripMenuOpen, setTripMenuOpen] = useState(false);
  const undoRef = useRef(null);
  const undoTimerRef = useRef(null);
  const tabContentRef = useRef(null);
  const tripRef = useRef(trip);
  const tripMenuRef = useRef(null);
  useEffect(() => { tripRef.current = trip; }, [trip]);

  useEffect(() => {
    if (!tripMenuOpen) return;
    const handle = (e) => { if (tripMenuRef.current && !tripMenuRef.current.contains(e.target)) setTripMenuOpen(false); };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle, { passive: true });
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('touchstart', handle); };
  }, [tripMenuOpen]);

  const pushUndo = (snapshot, msg = 'Action annulée') => {
    undoRef.current = snapshot;
    setUndoMsg(msg);
    setUndoVisible(true);
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => { setUndoVisible(false); undoRef.current = null; }, 5000);
  };

  const handleUndo = () => {
    if (undoRef.current) restoreTrip(tripId, undoRef.current);
    clearTimeout(undoTimerRef.current);
    setUndoVisible(false);
    undoRef.current = null;
  };

  const handleTouchDragStart = useTouchDnd({
    tripId, tripRef,
    moveFromReserveToDay, moveDayToDay, moveToReserve,
  });

  // Auto-scroll during drag near viewport edges
  useEffect(() => {
    let animFrame;
    let dy = 0;
    const EDGE = 90;
    const MAX = 14;
    const onDragOver = (e) => {
      const y = e.clientY;
      const h = window.innerHeight;
      if (y < EDGE) dy = -Math.round(MAX * Math.pow(1 - y / EDGE, 1.5));
      else if (y > h - EDGE) dy = Math.round(MAX * Math.pow(1 - (h - y) / EDGE, 1.5));
      else dy = 0;
    };
    const stop = () => { dy = 0; };
    const tick = () => {
      if (dy !== 0 && tabContentRef.current) tabContentRef.current.scrollTop += dy;
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragend', stop);
    window.addEventListener('drop', stop);
    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragend', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  if (!trip) return (
    <div className="trip-view">
      <div className="header">
        <button className="header__back" onClick={onBack}>←</button>
        <div className="header__title"><h1>Voyage introuvable</h1></div>
      </div>
      <div className="tab-content" style={{ textAlign: 'center', paddingTop: 40, color: 'var(--text-muted)' }}>
        Ce voyage n'existe plus.
        <br /><button className="btn btn--primary" style={{ marginTop: 16 }} onClick={onBack}>Retour</button>
      </div>
    </div>
  );

  const isPast = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [y, m, d] = trip.endDate.split('-').map(Number);
    return new Date(y, m - 1, d) < today;
  })();

  const { isActive, todayDay, todayDayIndex } = (() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const start = new Date(trip.startDate + 'T00:00:00');
    const end = new Date(trip.endDate + 'T00:00:00');
    const active = !isPast && start <= now && now <= end;
    if (!active) return { isActive: false, todayDay: null, todayDayIndex: -1 };
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const idx = trip.days.findIndex(d => d.date === todayStr);
    return { isActive: true, todayDay: idx >= 0 ? trip.days[idx] : null, todayDayIndex: idx };
  })();

  const allActivities = [...trip.days.flatMap(d => d.activities), ...trip.reserve];
  const stats = budgetStats(allActivities);
  const actTotal = trip.days.reduce((s, d) => s + d.activities.length, 0);

  const initBudget = parseFloat(trip.initialBudget) || 0;
  const budgetRemaining = initBudget > 0 ? initBudget - stats.spent : stats.remaining;
  const showBudget = initBudget > 0 || stats.total > 0;

  // ─── Day swipe navigation ─────────────────────────────
  const handleSwipeDay = (dayId, direction) => {
    const currentIdx = trip.days.findIndex(d => d.id === dayId);
    const targetIdx = currentIdx + direction;
    if (targetIdx < 0 || targetIdx >= trip.days.length) return;
    const el = document.getElementById(`day-${trip.days[targetIdx].id}`);
    if (el && tabContentRef.current) {
      const offset = el.offsetTop - tabContentRef.current.offsetTop;
      tabContentRef.current.scrollTo({ top: offset, behavior: 'smooth' });
    }
  };

  // ─── Compare helpers ──────────────────────────────────
  const toggleCompare = (id) => {
    setCompareSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const compareActivities = allActivities.filter(a => compareSelectedIds.has(a.id));

  // Auto-open compare panel when 2+ activities are selected
  useEffect(() => {
    if (compareSelectedIds.size >= 2) setShowCompare(true);
  }, [compareSelectedIds.size]);

  const VIEW_MODES = [
    { id: 'timeline', icon: '🗓', label: 'Timeline' },
    { id: 'list',     icon: '☰',  label: 'Liste' },
    { id: 'agenda',   icon: '📆', label: 'Agenda' },
  ];
  const cycleView = () => {
    const idx = VIEW_MODES.findIndex(v => v.id === viewMode);
    setViewMode(VIEW_MODES[(idx + 1) % VIEW_MODES.length].id);
  };
  const currentViewMeta = VIEW_MODES.find(v => v.id === viewMode);

  // ─── Handlers ────────────────────────────────────────
  const handleStatusChange = (dayId, activityId, status) =>
    setActivityStatus(tripId, { type: 'day', dayId }, activityId, status);

  const handleDeleteFromDay = (dayId, activityId) => {
    pushUndo(trip, 'Activité supprimée');
    deleteActivity(tripId, { type: 'day', dayId }, activityId);
  };

  const handleDeleteFromReserve = (activityId) => {
    pushUndo(trip, 'Activité supprimée');
    deleteActivity(tripId, { type: 'reserve' }, activityId);
  };

  const handleEditSave = (updates) => {
    if (!editingActivity) return;
    updateActivity(tripId, editingActivity.location, editingActivity.activity.id, updates);
    setEditingActivity(null);
  };

  const openAddSheet = (dayId = null) => {
    setSheetDefaultDayId(dayId);
    setSheetOpen(true);
  };

  const handleDuplicate = (activityId, targetDayId) =>
    duplicateToDay(tripId, activityId, targetDayId);

  const copyItinerary = async () => {
    const lines = [];
    lines.push(`${trip.emoji || '✈️'} ${trip.name}`);
    if (trip.destination) lines.push(`📍 ${trip.destination}`);
    lines.push(`${formatDateShort(trip.startDate)} → ${formatDateShort(trip.endDate)} · ${trip.days.length} jour${trip.days.length > 1 ? 's' : ''}`);
    lines.push('');
    trip.days.forEach((day, i) => {
      lines.push(`── Jour ${i + 1} · ${formatDate(day.date)} ──`);
      if (day.activities.length === 0) {
        lines.push('  (aucune activité planifiée)');
      } else {
        const slots = {};
        let cur = day.startTime || '09:00';
        day.activities.forEach(a => {
          slots[a.id] = cur;
          const mins = (parseInt(a.durationHours) || 0) * 60 + (parseInt(a.durationMinutes) || 0);
          const [h, m] = cur.split(':').map(Number);
          const next = h * 60 + m + mins;
          cur = `${String(Math.floor(next / 60) % 24).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
        });
        day.activities.forEach(a => {
          const icon = a.status === 'done' ? '✅' : a.status === 'nogo' ? '❌' : '•';
          const dur = (a.durationHours || 0) * 60 + (a.durationMinutes || 0);
          const durStr = dur > 0 ? ` (${formatDuration(dur)})` : '';
          const priceStr = (parseFloat(a.price) || 0) > 0 ? ` · ${formatPrice(a.price)}` : '';
          lines.push(`  ${icon} ${slots[a.id]} ${a.title}${durStr}${priceStr}`);
          if (a.address) lines.push(`       📍 ${a.address}`);
        });
      }
      if (day.notes) lines.push(`  📝 ${day.notes}`);
      lines.push('');
    });
    if (trip.reserve.length > 0) {
      lines.push(`── 📦 Réserve (${trip.reserve.length} idée${trip.reserve.length > 1 ? 's' : ''}) ──`);
      trip.reserve.forEach(a => lines.push(`  • ${a.title}`));
      lines.push('');
    }
    if (trip.tripNotes?.trim()) {
      lines.push('── 📝 Notes ──');
      lines.push(trip.tripNotes.trim());
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {}
  };

  const handleExportPDF = () => {
    const w = window.open('', '_blank');
    if (!w) { alert("Autoriser les pop-ups pour exporter."); return; }
    const fmtDur = (h, m) => { const t = h * 60 + m; if (!t) return ''; const hh = Math.floor(t/60), mm = t%60; return mm ? `${hh}h${String(mm).padStart(2,'0')}` : `${hh}h`; };
    const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const daysHtml = trip.days.map((day, i) => {
      const acts = day.activities.map(a => {
        const icon = a.status === 'done' ? '✅' : a.status === 'nogo' ? '❌' : '·';
        const dur = fmtDur(a.durationHours||0, a.durationMinutes||0);
        const price = parseFloat(a.price) > 0 ? ` — ${parseFloat(a.price).toFixed(2)} €` : '';
        return `<div class="act ${a.status}"><span class="s">${icon}</span><span class="t">${a.title}</span>${dur ? `<span class="d">${dur}</span>` : ''}${price ? `<span class="p">${price}</span>` : ''}${a.address ? `<div class="addr">📍 ${a.address}</div>` : ''}</div>`;
      }).join('');
      const notes = day.notes ? `<div class="notes">📝 ${day.notes}</div>` : '';
      return `<div class="day"><div class="dh">Jour ${i+1} — ${fmtDate(day.date)}</div>${acts || '<div class="empty">Aucune activité planifiée</div>'}${notes}</div>`;
    }).join('');
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${trip.name}</title><style>
      body{font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1a1a2e;font-size:13px}
      h1{font-size:22px;margin:0 0 2px}
      .meta{color:#5a5a7a;margin-bottom:20px}
      .day{margin-bottom:18px;page-break-inside:avoid}
      .dh{background:#FF6B35;color:#fff;padding:7px 12px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px}
      .act{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:5px 12px;border-left:3px solid #FF6B35;margin:4px 0}
      .act.done{opacity:.7}.act.nogo{opacity:.4;text-decoration:line-through}
      .s{flex-shrink:0}.t{font-weight:600;flex:1}.d,.p{color:#5a5a7a;font-size:12px}
      .addr{width:100%;font-size:11px;color:#9090b0;padding-left:18px}
      .notes{padding:5px 12px;font-size:12px;color:#5a5a7a;border-left:3px solid #FFCF56;margin:4px 0}
      .empty{padding:5px 12px;color:#9090b0;font-style:italic}
    </style></head><body>
    <h1>${trip.emoji || '✈️'} ${trip.name}</h1>
    ${trip.destination ? `<div class="meta">📍 ${trip.destination}</div>` : ''}
    <div class="meta">${trip.days.length} jours · ${trip.days.reduce((s,d)=>s+d.activities.length,0)} activités${trip.reserve.length ? ` · ${trip.reserve.length} en réserve` : ''}</div>
    ${daysHtml}
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // ─── Drag & Drop ─────────────────────────────────────
  const handleDropOnDay = (targetDayId, activityId) => {
    if (!activityId) return;
    const isInReserve = trip.reserve.some(a => a.id === activityId);
    if (isInReserve) { moveFromReserveToDay(tripId, targetDayId, activityId); return; }
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay && srcDay.id !== targetDayId) moveDayToDay(tripId, srcDay.id, targetDayId, activityId);
  };

  const handleDropOnReserve = (e) => {
    e.preventDefault();
    const activityId = e.dataTransfer.getData('text/plain');
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay) moveToReserve(tripId, srcDay.id, activityId);
    setReserveDragOver(false);
  };

  const detailDay_ = detailDay ? trip.days.find(d => d.id === detailDay.id) : null;

  const sharedDayProps = {
    days: trip.days,
    onDuplicate: handleDuplicate,
    compareMode,
    compareSelectedIds,
    onToggleCompare: toggleCompare,
  };

  return (
    <div className="trip-view">
      {/* Header */}
      <div className="header">
        <button className="header__back" onClick={onBack}>←</button>
        <div className="header__title">
          <h1>{trip.emoji || '✈️'} {trip.name}</h1>
          {trip.destination && <p>📍 {trip.destination}</p>}
        </div>
        <div className="header__action">
          <button className="btn btn--ghost-white btn--sm" onClick={onToggleDark} title={darkMode ? 'Mode clair' : 'Mode sombre'}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <div className="trip-header-menu-wrap" ref={tripMenuRef}>
            <button className="btn btn--ghost-white btn--sm" onClick={() => setTripMenuOpen(o => !o)} title="Options">⋯</button>
            {tripMenuOpen && (
              <div className="trip-header-menu">
                <button className="trip-header-menu__item" onClick={() => { copyItinerary(); setTripMenuOpen(false); }}>
                  {copyDone ? '✅ Copié !' : '📋 Copier l\'itinéraire'}
                </button>
                <button className="trip-header-menu__item" onClick={() => { setShowShare(true); setTripMenuOpen(false); }}>
                  🔗 Partager
                </button>
                <button className="trip-header-menu__item" onClick={() => { handleExportPDF(); setTripMenuOpen(false); }}>
                  📄 Exporter en PDF
                </button>
                <div className="trip-header-menu__divider" />
                <button className="trip-header-menu__item trip-header-menu__item--danger" onClick={() => { setShowDeleteTrip(true); setTripMenuOpen(false); }}>
                  🗑️ Supprimer le voyage
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cover photo */}
      {trip.coverPhoto && (
        <div className="trip-cover-photo">
          <img src={trip.coverPhoto} alt="" className="trip-cover-photo__img" />
        </div>
      )}

      {/* Trip meta + budget */}
      <div className="trip-meta">
        <span className="trip-meta__item">
          📅 {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)} · {trip.days.length}j
        </span>
        {showBudget && (
          <>
            {initBudget > 0
              ? <span className="budget-pill budget-pill--total">💰 {formatPrice(initBudget)}</span>
              : stats.total > 0 && <span className="budget-pill budget-pill--total">💰 {formatPrice(stats.total)}</span>
            }
            {stats.spent > 0 && <span className="budget-pill budget-pill--spent">✅ {formatPrice(stats.spent)}</span>}
            {budgetRemaining > 0 && <span className="budget-pill budget-pill--remaining">💵 {formatPrice(budgetRemaining)}</span>}
            {budgetRemaining < 0 && <span className="budget-pill budget-pill--over">🚨 {formatPrice(Math.abs(budgetRemaining))} dépassé</span>}
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab-btn${tab === 'planning' ? ' tab-btn--active' : ''}`} onClick={() => setTab('planning')}>
          📅 Planning
          {actTotal > 0 && <span className="tab-badge">{actTotal}</span>}
        </button>
        <button className={`tab-btn${tab === 'reserve' ? ' tab-btn--active' : ''}`} onClick={() => setTab('reserve')}>
          📦 Réserve
          {trip.reserve.length > 0 && <span className="tab-badge">{trip.reserve.length}</span>}
        </button>
        <button className={`tab-btn${tab === 'map' ? ' tab-btn--active' : ''}`} onClick={() => setTab('map')}>
          🗺 Carte
        </button>
        <button className={`tab-btn${tab === 'valise' ? ' tab-btn--active' : ''}`} onClick={() => setTab('valise')}>
          🎒 Valise
          {(trip.packingList?.length || 0) > 0 && (
            <span className="tab-badge">{trip.packingList.filter(i => i.checked).length}/{trip.packingList.length}</span>
          )}
        </button>
        <button className={`tab-btn${tab === 'notes' ? ' tab-btn--active' : ''}`} onClick={() => setTab('notes')}>
          📝 Notes
          {trip.tripNotes?.trim() && <span className="tab-badge tab-badge--dot" />}
        </button>
      </div>

      {/* Planning tools */}
      <div className="planning-tools">
        {compareMode ? (
          <>
            <div className="compare-toolbar__state">
              <span className="compare-toolbar__count">
                {compareSelectedIds.size === 0 ? 'Touche des activités' : `${compareSelectedIds.size} sélectionné${compareSelectedIds.size > 1 ? 's' : ''}`}
              </span>
              {compareSelectedIds.size >= 2 && (
                <span className="compare-toolbar__hint">↓ Résultat ci-dessous</span>
              )}
            </div>
            <button className="btn btn--xs btn--secondary" onClick={() => { setCompareMode(false); setCompareSelectedIds(new Set()); setShowCompare(false); }}>
              ✕ Quitter
            </button>
          </>
        ) : (
          <>
            {tab === 'planning' && (
              <button className="tool-btn tool-btn--view-cycle" onClick={cycleView} title="Changer de vue">
                <span className="tool-btn__icon">{currentViewMeta.icon}</span>
                <span className="tool-btn__label">{currentViewMeta.label}</span>
                <span className="tool-btn__chevron">›</span>
              </button>
            )}
            <button className="tool-btn" onClick={() => setCompareMode(true)} title="Comparer des activités">⚖️</button>
          </>
        )}
      </div>

      {/* Tab content */}
      <div ref={tabContentRef} className="tab-content">

        {/* ── PLANNING TAB ── */}
        {tab === 'planning' && (
          <>
            {isActive && todayDay && (
              <LiveDayCard
                day={todayDay}
                dayIndex={todayDayIndex}
                onStatusChange={handleStatusChange}
              />
            )}
            {viewMode === 'agenda' ? (
              <AgendaView
                days={trip.days}
                onOpenDetail={(day) => setDetailDay(day)}
                compareMode={compareMode}
              />
            ) : viewMode === 'timeline' ? (
              <TimelineView
                days={trip.days}
                onOpenDetail={(day) => setDetailDay(day)}
                onDrop={handleDropOnDay}
                compareMode={compareMode}
                compareSelectedIds={compareSelectedIds}
                onToggleCompare={toggleCompare}
                onNotesChange={(dayId, notes) => setDayNotes(tripId, dayId, notes)}
                onSweep={(dayId) => sweepDayToReserve(tripId, dayId)}
                onTouchDragStart={handleTouchDragStart}
              />
            ) : (
              trip.days.map((day, i) => (
                <DaySection
                  key={day.id}
                  day={day}
                  dayIndex={i}
                  totalDays={trip.days.length}
                  isPastTrip={isPast}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDeleteFromDay}
                  onMoveToReserve={(dayId, actId) => { pushUndo(trip, 'Activité déplacée en réserve'); moveToReserve(tripId, dayId, actId); }}
                  onMoveToNextDay={(dayId, actId) => moveToNextDay(tripId, dayId, actId)}
                  onReorder={(dayId, actId, dir) => reorderActivity(tripId, dayId, actId, dir)}
                  onStartTimeChange={(dayId, time) => setDayStartTime(tripId, dayId, time)}
                  onEdit={(activity, location) => setEditingActivity({ activity, location })}
                  onAddActivity={openAddSheet}
                  onOpenDetail={(day) => setDetailDay(day)}
                  onDrop={handleDropOnDay}
                  onNotesChange={(dayId, notes) => setDayNotes(tripId, dayId, notes)}
                  onSweep={(dayId) => sweepDayToReserve(tripId, dayId)}
                  weather={weather?.byDate[day.date]}
                  onTouchDragStart={handleTouchDragStart}
                  reserve={trip.reserve}
                  onAddFromReserve={(dayId, actId) => { pushUndo(trip, 'Activité ajoutée depuis la réserve'); moveFromReserveToDay(tripId, dayId, actId); }}
                  onAddTravel={(dayId, afterId, durationMin) => { pushUndo(trip); addTravelBlock(tripId, dayId, afterId, durationMin); }}
                  onOptimizeOrder={(dayId) => {
                    const d = trip.days.find(x => x.id === dayId);
                    if (!d) return;
                    pushUndo(trip, 'Ordre optimisé');
                    setDayActivitiesOrder(tripId, dayId, nearestNeighborSort(d.activities));
                  }}
                  onSwipeDay={(dir) => handleSwipeDay(day.id, dir)}
                  {...sharedDayProps}
                />
              ))
            )}

            <TripSummary trip={trip} />

            {/* Reserve mini-panel */}
            <div className="planning-reserve">
              <button
                className="planning-reserve__toggle"
                onClick={() => setReserveExpanded(v => !v)}
              >
                <span>📦 Réserve d'idées {trip.reserve.length > 0 && <span className="planning-reserve__count">{trip.reserve.length}</span>}</span>
                <span>{reserveExpanded ? '▲' : '▼'}</span>
              </button>
              {reserveExpanded && (
                <div className="planning-reserve__body">
                  {trip.reserve.length === 0
                    ? <p className="planning-reserve__hint">Aucune idée en réserve pour l'instant.</p>
                    : (
                      <>
                        <p className="planning-reserve__hint">Glisse une carte vers un jour ci-dessus ✨</p>
                        {trip.reserve.map((activity, i) => (
                          <div key={activity.id} className="reserve-mini-card">
                            <ActivityCard
                              activity={activity}
                              context="reserve"
                              isPastTrip={isPast}
                              onStatusChange={(s) => setActivityStatus(tripId, { type: 'reserve' }, activity.id, s)}
                              onDelete={() => handleDeleteFromReserve(activity.id)}
                              onEdit={() => setEditingActivity({ activity, location: { type: 'reserve' } })}
                              onReorderUp={() => reorderInReserve(tripId, activity.id, 'up')}
                              onReorderDown={() => reorderInReserve(tripId, activity.id, 'down')}
                              isFirst={i === 0}
                              isLast={i === trip.reserve.length - 1}
                              onDragStart={() => {}}
                              onDragEnd={() => {}}
                              compareMode={compareMode}
                              compareSelected={compareSelectedIds.has(activity.id)}
                              onToggleCompare={() => toggleCompare(activity.id)}
                            />
                          </div>
                        ))}
                      </>
                    )
                  }
                </div>
              )}
            </div>
          </>
        )}

        {/* ── RESERVE TAB ── */}
        {tab === 'reserve' && (
          <>
            {trip.reserve.length === 0 ? (
              <div
                className={`reserve-section__empty day-section__body${reserveDragOver ? ' day-section__body--drop-target' : ''}`}
                style={{ minHeight: 120 }}
                onDragOver={(e) => { e.preventDefault(); setReserveDragOver(true); }}
                onDragLeave={() => setReserveDragOver(false)}
                onDrop={handleDropOnReserve}
              >
                <div className="reserve-section__empty-icon">💡</div>
                <p style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Boîte à idées vide</p>
                <p style={{ color: 'var(--text-light)', fontSize: 13 }}>Glisse des activités ici ou clique + pour en ajouter.</p>
              </div>
            ) : (
              <>
                <div className="reserve-search-bar">
                  <input
                    className="reserve-search-input"
                    placeholder="🔍 Rechercher…"
                    value={reserveSearch}
                    onChange={e => setReserveSearch(e.target.value)}
                  />
                  <select className="reserve-sort-select" value={reserveSort} onChange={e => setReserveSort(e.target.value)}>
                    <option value="default">Ordre d'ajout</option>
                    <option value="alpha">A–Z</option>
                    <option value="duration">Durée</option>
                    <option value="price">Prix</option>
                  </select>
                </div>
                <div className="reserve-filter">
                  <button
                    className={`reserve-filter__pill${reserveFilter === 'all' ? ' reserve-filter__pill--active' : ''}`}
                    onClick={() => setReserveFilter('all')}
                  >Tout ({trip.reserve.length})</button>
                  {CATEGORIES.filter(cat => trip.reserve.some(a => a.category === cat.id)).map(cat => {
                    const count = trip.reserve.filter(a => a.category === cat.id).length;
                    return (
                      <button key={cat.id}
                        className={`reserve-filter__pill${reserveFilter === cat.id ? ' reserve-filter__pill--active' : ''}`}
                        onClick={() => setReserveFilter(cat.id)}
                      >{cat.emoji} {count}</button>
                    );
                  })}
                </div>
                <div
                  style={{ borderRadius: 'var(--radius-md)', border: reserveDragOver ? '2px dashed var(--orange)' : '2px dashed transparent', transition: 'border-color 0.15s', marginBottom: 10, minHeight: 8 }}
                  onDragOver={(e) => { e.preventDefault(); setReserveDragOver(true); }}
                  onDragLeave={() => setReserveDragOver(false)}
                  onDrop={handleDropOnReserve}
                />
                {(() => {
                  const q = reserveSearch.toLowerCase();
                  return trip.reserve
                    .filter(a => {
                      if (reserveFilter !== 'all' && a.category !== reserveFilter) return false;
                      if (q) return a.title.toLowerCase().includes(q) || (a.address || '').toLowerCase().includes(q) || (a.notes || '').toLowerCase().includes(q);
                      return true;
                    })
                    .sort((a, b) => {
                      if (reserveSort === 'alpha') return a.title.localeCompare(b.title, 'fr');
                      if (reserveSort === 'duration') return ((a.durationHours||0)*60+(a.durationMinutes||0)) - ((b.durationHours||0)*60+(b.durationMinutes||0));
                      if (reserveSort === 'price') return (parseFloat(a.price)||0) - (parseFloat(b.price)||0);
                      return 0;
                    })
                    .map((activity, i, arr) => (
                  <div key={activity.id} className="reserve-card">
                    <ActivityCard
                      activity={activity}
                      context="reserve"
                      isPastTrip={isPast}
                      onStatusChange={(s) => setActivityStatus(tripId, { type: 'reserve' }, activity.id, s)}
                      onDelete={() => handleDeleteFromReserve(activity.id)}
                      onEdit={() => setEditingActivity({ activity, location: { type: 'reserve' } })}
                      onReorderUp={() => reorderInReserve(tripId, activity.id, 'up')}
                      onReorderDown={() => reorderInReserve(tripId, activity.id, 'down')}
                      isFirst={i === 0}
                      isLast={i === arr.length - 1}
                      onDragStart={() => {}}
                      onDragEnd={() => {}}
                      compareMode={compareMode}
                      compareSelected={compareSelectedIds.has(activity.id)}
                      onToggleCompare={() => toggleCompare(activity.id)}
                    />
                    <div className="reserve-card__assign">
                      <span className="reserve-card__assign-label">Assigner :</span>
                      {trip.days.map((d, di) => (
                        <button key={d.id} className="day-pill"
                          onClick={() => moveFromReserveToDay(tripId, d.id, activity.id)}>
                          J{di + 1} {formatDate(d.date).split(' ').slice(0, 2).join(' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                  ))
                })()}
              </>
            )}
          </>
        )}

        {/* ── VALISE TAB ── */}
        {tab === 'valise' && (
          <PackingList
            items={trip.packingList || []}
            onAdd={(text, category) => addPackingItem(tripId, text, category)}
            onToggle={(itemId) => togglePackingItem(tripId, itemId)}
            onDelete={(itemId) => deletePackingItem(tripId, itemId)}
            onReorder={(newList) => setPackingOrder(tripId, newList)}
          />
        )}

        {/* ── NOTES TAB ── */}
        {tab === 'notes' && (
          <div className="notes-tab">
            <p className="notes-tab__hint">
              Numéros de vol, adresses d'hôtels, contacts, check-list de départ…
            </p>
            <textarea
              className="notes-textarea"
              placeholder={'Ex:\n✈️ Vol: AB1234 — départ 14h30 Terminal 2\n🏨 Hôtel Le Palais — 5 rue Victor Hugo\n📞 Urgence: +33 6 12 34 56 78\n\n☐ Passeport\n☐ Assurance voyage\n☐ Adaptateur prise'}
              value={trip.tripNotes || ''}
              onChange={e => updateTrip(tripId, { tripNotes: e.target.value })}
            />
          </div>
        )}

        {/* ── MAP TAB ── */}
        {tab === 'map' && (
          <MapView days={trip.days} reserve={trip.reserve} />
        )}
      </div>

      {/* FAB — hidden on notes, map, and valise tabs */}
      {tab !== 'notes' && tab !== 'map' && tab !== 'valise' && (
        <div className="fab">
          <button className="fab__btn" onClick={() => openAddSheet(null)}>
            + Ajouter une activité
          </button>
        </div>
      )}

      {/* Modals & sheets */}
      <AddActivitySheet
        isOpen={sheetOpen && !editingActivity}
        onClose={() => { setSheetOpen(false); setSheetDefaultDayId(null); }}
        days={trip.days}
        defaultDayId={sheetDefaultDayId}
        onAddToReserve={(a) => addToReserve(tripId, a)}
        onAddToDay={(dayId, a) => addToDay(tripId, dayId, a)}
        reserveActivities={trip.reserve}
        onMoveFromReserve={(actId) => { if (sheetDefaultDayId) moveFromReserveToDay(tripId, sheetDefaultDayId, actId); }}
      />

      {editingActivity && (
        <AddActivitySheet
          isOpen={true}
          onClose={() => setEditingActivity(null)}
          days={trip.days}
          editActivity={editingActivity.activity}
          onAddToReserve={() => {}}
          onAddToDay={() => {}}
          onEditSave={handleEditSave}
        />
      )}

      {detailDay_ && (
        <DayDetailModal
          day={detailDay_}
          dayIndex={trip.days.findIndex(d => d.id === detailDay_.id)}
          totalDays={trip.days.length}
          isPastTrip={isPast}
          onClose={() => setDetailDay(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDeleteFromDay}
          onMoveToReserve={(dayId, actId) => moveToReserve(tripId, dayId, actId)}
          onMoveToNextDay={(dayId, actId) => moveToNextDay(tripId, dayId, actId)}
          onReorder={(dayId, actId, dir) => reorderActivity(tripId, dayId, actId, dir)}
          onStartTimeChange={(dayId, time) => setDayStartTime(tripId, dayId, time)}
          onEdit={(activity, location) => { setDetailDay(null); setEditingActivity({ activity, location }); }}
          onAddActivity={(dayId) => { setDetailDay(null); openAddSheet(dayId); }}
          {...sharedDayProps}
        />
      )}

      {showShare && <ShareModal trip={trip} onClose={() => setShowShare(false)} />}

      {showDeleteTrip && (
        <ConfirmDialog
          icon="🗑️"
          title="Supprimer ce voyage ?"
          message={`"${trip.name}" et toutes ses activités seront supprimés définitivement.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={() => { deleteTrip(tripId); onBack(); }}
          onCancel={() => setShowDeleteTrip(false)}
        />
      )}

      {showCompare && compareActivities.length >= 2 && (
        <CompareModal
          activities={compareActivities}
          onClose={() => setShowCompare(false)}
          onChoose={(chosen) => {
            // Mark chosen as todo, others as nogo — find each in their day or reserve
            compareActivities.forEach(a => {
              const status = a.id === chosen.id ? 'todo' : 'nogo';
              const day = trip.days.find(d => d.activities.some(x => x.id === a.id));
              if (day) setActivityStatus(tripId, { type: 'day', dayId: day.id }, a.id, status);
              else setActivityStatus(tripId, { type: 'reserve' }, a.id, status);
            });
            setCompareMode(false);
            setCompareSelectedIds(new Set());
          }}
        />
      )}

      <div className={`undo-toast${undoVisible ? ' undo-toast--visible' : ''}`}>
        <span>{undoMsg}</span>
        <button className="undo-toast__btn" onClick={handleUndo}>↩ Annuler</button>
      </div>
    </div>
  );
}
