import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useTripsContext } from '../context/TripsContext';
import DayDetailModal from '../components/DayDetailModal';
import ActivityCard from '../components/ActivityCard';
import AddActivitySheet from '../components/AddActivitySheet';
import ShareModal from '../components/ShareModal';
import ConfirmDialog from '../components/ConfirmDialog';
import CompareModal from '../components/CompareModal';
import TimelineView from '../components/TimelineView';
import AgendaView from '../components/AgendaView';
import PackingList from '../components/PackingList';
import { forceRefreshApp } from '../components/RefreshButton';
import TripRecap from '../components/TripRecap';
import ExpensesTab from '../components/ExpensesTab';
import TodayMode from '../components/TodayMode';
import { useWeather } from '../hooks/useWeather';
import { useSettings } from '../hooks/useSettings';
import { useLocalNews } from '../hooks/useLocalNews';
import TripSettingsSheet from '../components/TripSettingsSheet';
import { formatDateShort, budgetStats, formatPrice, formatDate, formatDuration, CATEGORIES, detectCountryTheme } from '../utils/helpers';

// Leaflet (~150 KB) is only fetched when the Carte tab is actually opened.
const MapView = lazy(() => import('../components/MapView'));

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
    // Disable scroll-snap on the timeline so the horizontal auto-scroll is smooth.
    document.body.classList.add('dnd-active');
  };

  useEffect(() => {
    const onMove = (e) => {
      const s = stateRef.current;
      if (!s.ghost) return;
      e.preventDefault();
      const touch = e.touches[0];
      s.ghost.style.left = (touch.clientX - s.offset.x) + 'px';
      s.ghost.style.top = (touch.clientY - s.offset.y) + 'px';

      // Vertical auto-scroll (Liste / Agenda). Use the container's own bounding box for the
      // edge zones — otherwise the sticky header eats the top zone and you can't drag an
      // activity *upward* onto an earlier day.
      const sc = s.scrollContainer || (s.scrollContainer = document.querySelector('.tab-content'));
      if (sc) {
        const r = sc.getBoundingClientRect();
        const EDGE = 110, MAX = 20;
        const y = touch.clientY;
        if (y < r.top + EDGE) {
          const k = Math.min(1, (r.top + EDGE - y) / EDGE);
          sc.scrollTop -= Math.round(MAX * Math.pow(k, 1.4));
        } else if (y > r.bottom - EDGE) {
          const k = Math.min(1, (y - (r.bottom - EDGE)) / EDGE);
          sc.scrollTop += Math.round(MAX * Math.pow(k, 1.4));
        }
      }
      // Horizontal auto-scroll for the Timeline, where days are laid out left-to-right.
      // Lets you drag an activity onto a day several days further along.
      if (s.timelineWrap === undefined) s.timelineWrap = document.querySelector('.timeline-view-wrap') || null;
      const tl = s.timelineWrap;
      if (tl) {
        const r = tl.getBoundingClientRect();
        const HEDGE = 84, HMAX = 20;
        const x = touch.clientX;
        if (x < r.left + HEDGE) {
          const k = Math.min(1, (r.left + HEDGE - x) / HEDGE);
          tl.scrollLeft -= Math.round(HMAX * Math.pow(k, 1.4));
        } else if (x > r.right - HEDGE) {
          const k = Math.min(1, (x - (r.right - HEDGE)) / HEDGE);
          tl.scrollLeft += Math.round(HMAX * Math.pow(k, 1.4));
        }
      }

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
      document.body.classList.remove('dnd-active');
      s.id = null; s.sourceEl = null; s.dropZone = null; s.scrollContainer = null; s.timelineWrap = undefined;
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
    restoreTrip, setDayActivitiesOrder,
    reorderDay, addToAllDays,
    addExpense, deleteExpense,
    addDailyTemplate, removeDailyTemplate,
    enableCollaboration, userId,
    fetchTripMembers, removeTripMember,
  } = useTripsContext();

  const trip = getTripById(tripId);
  const weather = useWeather(trip);
  const { settings, setSetting } = useSettings();
  const { news: localNews } = useLocalNews(trip?.destination, !!trip?.destination);
  const [showTripSettings, setShowTripSettings] = useState(false);
  const [swUpdateReady, setSwUpdateReady] = useState(false);
  const [tab, setTab] = useState('planning');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDefaultDayId, setSheetDefaultDayId] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
  const [detailDay, setDetailDay] = useState(null);
  const [reserveExpanded, setReserveExpanded] = useState(false);
  const [reserveDragOver, setReserveDragOver] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelectedIds, setCompareSelectedIds] = useState(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    const stored = localStorage.getItem('provo_viewMode');
    return stored === 'agenda' ? 'agenda' : 'timeline'; // 'list' removed → fallback timeline
  });
  const [reserveFilter, setReserveFilter] = useState('all');
  const [reserveSearch, setReserveSearch] = useState('');
  const [reserveSort, setReserveSort] = useState('default');
  const [copyDone, setCopyDone] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoMsg, setUndoMsg] = useState('');
  const [tripMenuOpen, setTripMenuOpen] = useState(false);
  const [tripMembers, setTripMembers] = useState([]);
  const [slideClass, setSlideClass] = useState('');
  const undoRef = useRef(null);
  const undoTimerRef = useRef(null);
  const tabContentRef = useRef(null);
  const tabsRef = useRef(null);
  const tabSwipeRef = useRef({ startX: null, startY: null, startTime: null });
  const tripRef = useRef(trip);
  const tripMenuRef = useRef(null);
  useEffect(() => { tripRef.current = trip; }, [trip]);
  useEffect(() => { localStorage.setItem('provo_viewMode', viewMode); }, [viewMode]);

  // Service worker update notification
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (e) => {
      if (e.data?.type === 'SW_UPDATED') setSwUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (!tripMenuOpen) return;
    const handle = (e) => { if (tripMenuRef.current && !tripMenuRef.current.contains(e.target)) setTripMenuOpen(false); };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle, { passive: true });
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('touchstart', handle); };
  }, [tripMenuOpen]);

  // Auto-scroll active tab into view
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const active = el.querySelector('.tab-btn--active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [tab]);

  // Fetch trip members when settings sheet opens
  useEffect(() => {
    if (!showTripSettings || !userId) return;
    fetchTripMembers(tripId).then(members => setTripMembers(members || []));
  }, [showTripSettings, tripId, userId, fetchTripMembers]);

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

  const handleRemoveMember = async (memberUserId) => {
    await removeTripMember(tripId, memberUserId);
    const travelers = trip.tripTravelers || [];
    if (travelers.some(t => t.profileId === memberUserId)) {
      updateTrip(tripId, {
        tripTravelers: travelers.map(t =>
          t.profileId === memberUserId ? { ...t, profileId: null } : t
        ),
      });
    }
    fetchTripMembers(tripId).then(members => setTripMembers(members || []));
  };

  const handleTouchDragStart = useTouchDnd({
    tripId, tripRef,
    moveFromReserveToDay, moveDayToDay, moveToReserve,
  });

  // Auto-scroll during HTML5 (mouse / touch-PC) drag near the edges — vertically
  // for Liste/Agenda and horizontally for the Timeline (days laid out left→right).
  useEffect(() => {
    let animFrame;
    let dy = 0, dx = 0;
    let tlWrap = null;
    const EDGE = 90, MAX = 14;
    const HEDGE = 96, HMAX = 24;
    const onDragStart = () => { document.body.classList.add('dnd-active'); };
    const onDragOver = (e) => {
      const y = e.clientY, x = e.clientX, h = window.innerHeight;
      if (y < EDGE) dy = -Math.round(MAX * Math.pow(1 - y / EDGE, 1.5));
      else if (y > h - EDGE) dy = Math.round(MAX * Math.pow(1 - (h - y) / EDGE, 1.5));
      else dy = 0;
      tlWrap = tlWrap || document.querySelector('.timeline-view-wrap');
      if (tlWrap) {
        const r = tlWrap.getBoundingClientRect();
        if (x < r.left + HEDGE) dx = -Math.round(HMAX * Math.min(1, (r.left + HEDGE - x) / HEDGE));
        else if (x > r.right - HEDGE) dx = Math.round(HMAX * Math.min(1, (x - (r.right - HEDGE)) / HEDGE));
        else dx = 0;
      } else dx = 0;
    };
    const stop = () => { dy = 0; dx = 0; tlWrap = null; document.body.classList.remove('dnd-active'); };
    const tick = () => {
      if (dy !== 0 && tabContentRef.current) tabContentRef.current.scrollTop += dy;
      if (dx !== 0 && tlWrap) tlWrap.scrollLeft += dx;
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    window.addEventListener('dragstart', onDragStart);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragend', stop);
    window.addEventListener('drop', stop);
    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragend', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  // Auto-open compare panel when 2+ activities are selected.
  // These hooks must stay ABOVE the `!trip` early return — a hook below it
  // changes the hook count when a trip is deleted mid-view and crashes the app.
  useEffect(() => {
    if (compareSelectedIds.size >= 2) setShowCompare(true);
  }, [compareSelectedIds.size]);

  if (!trip) return (
    <div className="trip-view">
      <div className="header">
        <button className="header__back" onClick={onBack} aria-label="Retour au tableau de bord">←</button>
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
  const showBudget = initBudget > 0 || stats.total > 0;

  // ─── Tab order + swipe navigation ───────────────────────
  const orderedTabs = [
    ...(isActive ? ['today'] : []),
    'planning', 'reserve', 'depenses', 'map', 'notes', 'valise',
  ];

  const navigateTab = (newTab) => {
    if (newTab === tab) return;
    const fromIdx = orderedTabs.indexOf(tab);
    const toIdx = orderedTabs.indexOf(newTab);
    const dir = toIdx > fromIdx ? 1 : -1;
    setSlideClass(dir > 0 ? 'tab-slide-right' : 'tab-slide-left');
    setTab(newTab);
    setTimeout(() => setSlideClass(''), 250);
  };

  const onTabTouchStart = (e) => {
    if (
      e.target.closest('.activity-card-swipe') ||
      e.target.closest('.day-section__header') ||
      e.target.closest('.leaflet-container') ||
      e.target.closest('input') ||
      e.target.closest('select') ||
      e.target.closest('textarea')
    ) return;
    const t = e.touches[0];
    // Edge-only detection (iOS-style): only trigger from within 60px of screen edges
    if (t.clientX > 60 && t.clientX < window.innerWidth - 60) return;
    tabSwipeRef.current = { startX: t.clientX, startY: t.clientY, startTime: Date.now() };
  };

  const onTabTouchEnd = (e) => {
    const s = tabSwipeRef.current;
    if (s.startX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.startX;
    const dy = Math.abs(t.clientY - s.startY);
    const dt = Date.now() - s.startTime;
    tabSwipeRef.current = { startX: null, startY: null, startTime: null };
    if (Math.abs(dx) < 55 || dy > Math.abs(dx) * 0.65 || dt > 500) return;
    const idx = orderedTabs.indexOf(tab);
    if (dx < 0 && idx < orderedTabs.length - 1) navigateTab(orderedTabs[idx + 1]);
    else if (dx > 0 && idx > 0) navigateTab(orderedTabs[idx - 1]);
  };

  // ─── Day swipe navigation ─────────────────────────────
  // ─── Compare helpers ──────────────────────────────────
  const toggleCompare = (id) => {
    setCompareSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const compareActivities = allActivities.filter(a => compareSelectedIds.has(a.id));

  const VIEW_MODES = [
    { id: 'timeline', icon: '🗓', label: 'Timeline' },
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

  const handleWhatsAppShare = () => {
    const lines = [];
    lines.push(`${trip.emoji || '✈️'} *${trip.name}*`);
    if (trip.destination) lines.push(`📍 ${trip.destination}`);
    lines.push(`📅 ${formatDateShort(trip.startDate)} → ${formatDateShort(trip.endDate)}`);
    lines.push('');
    trip.days.forEach((day, i) => {
      lines.push(`*── Jour ${i + 1} · ${formatDate(day.date)} ──*`);
      if (day.activities.length === 0) {
        lines.push('  (aucune activité planifiée)');
      } else {
        let cur = day.startTime || '09:00';
        day.activities.forEach(a => {
          if (a.status === 'nogo') return;
          const icon = a.status === 'done' ? '✅' : '•';
          lines.push(`  ${icon} ${cur} ${a.title}${a.address ? ` — 📍 ${a.address}` : ''}`);
          const mins = (parseInt(a.durationHours) || 0) * 60 + (parseInt(a.durationMinutes) || 0);
          const [h, m] = cur.split(':').map(Number);
          const next = h * 60 + m + mins;
          cur = `${String(Math.floor(next / 60) % 24).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
        });
      }
      lines.push('');
    });
    const text = lines.join('\n');
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (navigator.share) {
      navigator.share({ title: trip.name, text }).catch(() => window.open(waUrl, '_blank'));
    } else {
      window.open(waUrl, '_blank');
    }
  };

  const handleAutoBackup = () => {
    const json = JSON.stringify(trip, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${trip.name.replace(/[^a-z0-9]/gi, '_')}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
      .dh{background:#35A7DD;color:#fff;padding:7px 12px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px}
      .act{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:5px 12px;border-left:3px solid #35A7DD;margin:4px 0}
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

  const tripAccent = trip.color || detectCountryTheme(trip.destination) || '#35A7DD';
  const expenses = trip.expenses || [];
  // Settlements (remboursements entre voyageurs) are transfers, not spending.
  const totalExpenses = expenses.filter(e => !e.isSettlement).reduce((s, e) => s + (e.eurAmount ?? e.amount), 0);
  const totalActivitiesCost = allActivities.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const totalTripCost = totalActivitiesCost + totalExpenses;
  const doneActivitiesCost = trip.days
    .flatMap(d => d.activities)
    .filter(a => a.status === 'done')
    .reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const alreadySpent = doneActivitiesCost + totalExpenses;
  const budgetExceeded = initBudget > 0 && alreadySpent > initBudget;

  // Budget « dépliant » : le chiffre principal (restant / dépassé, sinon estimé)
  // reste visible ; les autres n'apparaissent qu'une fois déplié.
  const budgetItems = [];
  if (initBudget > 0) {
    budgetItems.push(budgetExceeded
      ? { key: 'over', cls: 'budget-inline__item--over', txt: `🚨 ${formatPrice(alreadySpent - initBudget)} dépassé` }
      : { key: 'left', cls: 'budget-inline__item--ok', txt: `💵 ${formatPrice(initBudget - alreadySpent)} restants` });
    budgetItems.push({ key: 'init', cls: '', txt: `💰 ${formatPrice(initBudget)}` });
  }
  if (totalTripCost > 0) {
    budgetItems.push({ key: 'est', cls: 'budget-inline__item--est', txt: `🧮 ${formatPrice(totalTripCost)} estimé` });
  }

  return (
    <div className="trip-view" style={{ '--trip-accent': tripAccent }}>
      {swUpdateReady && (
        <div className="sw-update-banner">
          🆕 Nouvelle version disponible !
          <button className="sw-update-btn" onClick={() => window.location.reload()}>Mettre à jour</button>
        </div>
      )}
      {/* Header */}
      <div className="header">
        <button className="header__back" onClick={onBack} aria-label="Retour au tableau de bord">←</button>
        <div className="header__title">
          <h1>{trip.emoji || '✈️'} {trip.name}</h1>
          {trip.destination && <p className="header__dest">📍 {trip.destination}</p>}
          <p className="header__dates">
            {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)} · {trip.days.length}j
            {trip.timezoneOffset != null && trip.timezoneOffset !== 0 && ` · UTC${trip.timezoneOffset >= 0 ? '+' : ''}${trip.timezoneOffset}`}
          </p>
        </div>
        <div className="header__action">
          <button className="header__add-btn" onClick={() => openAddSheet(null)} title="Ajouter une activité" aria-label="Ajouter une activité">＋</button>
          <div className="trip-header-menu-wrap" ref={tripMenuRef}>
            <button className="btn btn--ghost-white btn--sm" onClick={() => setTripMenuOpen(o => !o)} title="Options" aria-label="Options du voyage" aria-expanded={tripMenuOpen} aria-haspopup="menu">⋯</button>
            {tripMenuOpen && (
              <div className="trip-header-menu">
                <button className="trip-header-menu__item" onClick={() => { onToggleDark(); setTripMenuOpen(false); }}>
                  {darkMode ? '☀️ Mode clair' : '🌙 Mode sombre'}
                </button>
                <button className="trip-header-menu__item" onClick={() => { forceRefreshApp(); }}>
                  🔄 Recharger l'app
                </button>
                <div className="trip-header-menu__divider" />
                {tab === 'planning' && (
                  <button className="trip-header-menu__item" onClick={() => { setCompareMode(true); setTripMenuOpen(false); }}>
                    ⚖️ Comparer des activités
                  </button>
                )}
                <button className="trip-header-menu__item" onClick={() => { setShowShare(true); setTripMenuOpen(false); }}>
                  🔗 Partager
                </button>
                <button className="trip-header-menu__item" onClick={() => { handleExportPDF(); setTripMenuOpen(false); }}>
                  📄 Exporter en PDF
                </button>
                <button className="trip-header-menu__item" onClick={() => { setShowRecap(true); setTripMenuOpen(false); }}>
                  📊 Bilan du voyage
                </button>
                <button className="trip-header-menu__item" onClick={() => { copyItinerary(); setTripMenuOpen(false); }}>
                  {copyDone ? '✅ Copié !' : '📋 Copier l\'itinéraire'}
                </button>
                <button className="trip-header-menu__item" onClick={() => { handleAutoBackup(); setTripMenuOpen(false); }}>
                  💾 Sauvegarde (fichier)
                </button>
                <button className="trip-header-menu__item" onClick={() => { handleWhatsAppShare(); setTripMenuOpen(false); }}>
                  💬 Partager WhatsApp
                </button>
                <button className="trip-header-menu__item" onClick={() => { setShowTripSettings(true); setTripMenuOpen(false); }}>
                  ⚙️ Paramètres du voyage
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

      {/* Rangée de contrôles alignée : budget à gauche · vue (ou comparaison) à droite */}
      {(showBudget || compareMode || tab === 'planning') && (
        <div className="trip-controls">
          {compareMode ? (
            <>
              <span className="compare-toolbar__count">
                {compareSelectedIds.size === 0 ? 'Touche des activités' : `${compareSelectedIds.size} sélectionné${compareSelectedIds.size > 1 ? 's' : ''}`}
              </span>
              <button className="btn btn--xs btn--secondary" onClick={() => { setCompareMode(false); setCompareSelectedIds(new Set()); setShowCompare(false); }}>
                ✕ Quitter
              </button>
            </>
          ) : (
            <>
              {showBudget && budgetItems.length > 0 ? (
                <button
                  type="button"
                  className={`budget-inline${budgetOpen ? ' budget-inline--open' : ''}`}
                  onClick={() => budgetItems.length > 1 && setBudgetOpen(o => !o)}
                  aria-expanded={budgetItems.length > 1 ? budgetOpen : undefined}
                  title={budgetItems.length > 1 ? 'Détail du budget' : undefined}
                >
                  {(budgetOpen ? budgetItems : budgetItems.slice(0, 1)).map(it => (
                    <span key={it.key} className={`budget-inline__item ${it.cls}`}>{it.txt}</span>
                  ))}
                  {budgetItems.length > 1 && (
                    <span className="budget-inline__chevron" aria-hidden="true">{budgetOpen ? '▴' : '▾'}</span>
                  )}
                </button>
              ) : <span className="trip-controls__spacer" />}
              {tab === 'planning' ? (
                <button className="tool-btn tool-btn--view-cycle" onClick={cycleView} title="Changer de vue">
                  <span className="tool-btn__icon">{currentViewMeta.icon}</span>
                  <span className="tool-btn__label">{currentViewMeta.label}</span>
                  <span className="tool-btn__chevron">›</span>
                </button>
              ) : <span className="trip-controls__spacer" />}
            </>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs" ref={tabsRef} role="tablist" aria-label="Sections du voyage">
        {isActive && (
          <button role="tab" aria-selected={tab === 'today'} className={`tab-btn tab-btn--today${tab === 'today' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('today')}>
            <span className="tab-btn__icon">🟢</span>
            <span className="tab-btn__label">Aujourd'hui</span>
            {todayDay && todayDay.activities.filter(a => a.status === 'todo').length > 0 && (
              <span className="tab-badge tab-badge--today" aria-label={`${todayDay.activities.filter(a => a.status === 'todo').length} activités à faire`}>{todayDay.activities.filter(a => a.status === 'todo').length}</span>
            )}
          </button>
        )}
        <button role="tab" aria-selected={tab === 'planning'} className={`tab-btn${tab === 'planning' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('planning')}>
          <span className="tab-btn__icon">📅</span>
          <span className="tab-btn__label">Planning</span>
          {actTotal > 0 && <span className="tab-badge" aria-label={`${actTotal} activités`}>{actTotal}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'reserve'} className={`tab-btn${tab === 'reserve' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('reserve')}>
          <span className="tab-btn__icon">📦</span>
          <span className="tab-btn__label">Réserve</span>
          {trip.reserve.length > 0 && <span className="tab-badge" aria-label={`${trip.reserve.length} idées`}>{trip.reserve.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'depenses'} className={`tab-btn${tab === 'depenses' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('depenses')}>
          <span className="tab-btn__icon">💸</span>
          <span className="tab-btn__label">Dépenses</span>
          {(trip.expenses?.length || 0) > 0 && <span className="tab-badge" aria-label={`${trip.expenses.length} dépenses`}>{trip.expenses.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'map'} className={`tab-btn${tab === 'map' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('map')}>
          <span className="tab-btn__icon">🗺️</span>
          <span className="tab-btn__label">Carte</span>
        </button>
        <button role="tab" aria-selected={tab === 'notes'} className={`tab-btn${tab === 'notes' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('notes')}>
          <span className="tab-btn__icon">📝</span>
          <span className="tab-btn__label">Notes</span>
          {trip.tripNotes?.trim() && <span className="tab-badge tab-badge--dot" aria-label="Notes saisies" />}
        </button>
        <button role="tab" aria-selected={tab === 'valise'} className={`tab-btn${tab === 'valise' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('valise')}>
          <span className="tab-btn__icon">🎒</span>
          <span className="tab-btn__label">Valise</span>
          {(trip.packingList?.length || 0) > 0 && (
            <span className="tab-badge" aria-label={`${trip.packingList.filter(i => i.checked).length} sur ${trip.packingList.length} emballés`}>{trip.packingList.filter(i => i.checked).length}/{trip.packingList.length}</span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div ref={tabContentRef} role="tabpanel" aria-label={tab} className={`tab-content${slideClass ? ` ${slideClass}` : ''}`} onTouchStart={onTabTouchStart} onTouchEnd={onTabTouchEnd}>

        {/* ── AUJOURD'HUI TAB ── */}
        {tab === 'today' && isActive && (
          <TodayMode
            day={todayDay}
            dayIndex={todayDayIndex}
            totalDays={trip.days.length}
            trip={trip}
            onStatusChange={handleStatusChange}
            onReorderActivities={(dayId, newOrder) => setDayActivitiesOrder(tripId, dayId, newOrder)}
            reserve={trip.reserve}
            days={trip.days}
            onAddFromReserve={todayDay ? (actId) => moveFromReserveToDay(tripId, todayDay.id, actId) : null}
            onMoveFromDay={todayDay ? (srcDayId, actId) => moveDayToDay(tripId, srcDayId, todayDay.id, actId) : null}
          />
        )}

        {/* ── PLANNING TAB ── */}
        {tab === 'planning' && (
          <>
            {isPast && trip.days.some(d => d.activities.length > 0) && (
              <button className="recap-banner" onClick={() => setShowRecap(true)}>
                <span className="recap-banner__emoji">🎉</span>
                <span className="recap-banner__text">
                  <strong>Voyage terminé !</strong>
                  <small>Découvre ton bilan : budget, activités, km…</small>
                </span>
                <span className="recap-banner__cta">Voir →</span>
              </button>
            )}
            {viewMode === 'agenda' ? (
              <AgendaView
                days={trip.days}
                onOpenDetail={(day) => setDetailDay(day)}
                compareMode={compareMode}
                onReorderDay={(dayId, dir) => reorderDay(tripId, dayId, dir)}
                weatherByDate={weather?.byDate}
              />
            ) : (
              <TimelineView
                days={trip.days}
                onOpenDetail={(day) => setDetailDay(day)}
                onDrop={handleDropOnDay}
                compareMode={compareMode}
                compareSelectedIds={compareSelectedIds}
                onToggleCompare={toggleCompare}
                onTouchDragStart={handleTouchDragStart}
                weatherByDate={weather?.byDate}
              />
            )}

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
            {localNews.length > 0 && (
              <div className="local-news">
                <div className="local-news__title">📰 Actualité · {trip.destination}</div>
                {localNews.map((item, i) => (
                  <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" className="news-card">
                    <div className="news-card__body">
                      <div className="news-card__headline">{item.title}</div>
                      <div className="news-card__meta">
                        {item.source && <span className="news-card__source">{item.source}</span>}
                        {item.relDate && <span className="news-card__date">{item.relDate}</span>}
                      </div>
                    </div>
                    <span className="news-card__arrow">›</span>
                  </a>
                ))}
              </div>
            )}
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
            trip={trip}
            weatherByDate={weather?.byDate}
          />
        )}

        {/* ── DÉPENSES TAB ── */}
        {tab === 'depenses' && (
          <ExpensesTab
            trip={trip}
            onAddExpense={(exp) => addExpense(tripId, exp)}
            onDeleteExpense={(expId) => deleteExpense(tripId, expId)}
            onDeleteTraveler={(id) => updateTrip(tripId, { tripTravelers: (trip.tripTravelers || []).filter(t => t.id !== id) })}
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
          <Suspense fallback={<div className="map-empty"><div className="map-empty__icon">🗺️</div><p>Chargement de la carte…</p></div>}>
            <MapView days={trip.days} reserve={trip.reserve} roadTripMode={trip.roadTripMode} tripColor={trip.color} accommodationAddress={trip.accommodationAddress} />
          </Suspense>
        )}
      </div>


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
        tripTravelers={trip.tripTravelers || []}
        onAddToAllDays={(a) => addToAllDays(tripId, a)}
        tripLat={weather?.lat}
        tripLon={weather?.lon}
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
          onNotesChange={(dayId, notes) => setDayNotes(tripId, dayId, notes)}
          onSweep={(dayId) => sweepDayToReserve(tripId, dayId)}
          {...sharedDayProps}
        />
      )}

      {showShare && <ShareModal trip={trip} onClose={() => setShowShare(false)} />}

      {showRecap && <TripRecap trip={trip} onClose={() => setShowRecap(false)} />}

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

      <TripSettingsSheet
        trip={trip}
        isOpen={showTripSettings}
        onClose={() => setShowTripSettings(false)}
        onUpdateTrip={updateTrip}
        settings={settings}
        setSetting={setSetting}
        onAddDailyTemplate={addDailyTemplate}
        onRemoveDailyTemplate={removeDailyTemplate}
        enableCollaboration={enableCollaboration}
        userId={userId}
        tripMembers={tripMembers}
        currentUserId={userId}
        onRemoveMember={handleRemoveMember}
      />

      <div className={`undo-toast${undoVisible ? ' undo-toast--visible' : ''}`}>
        <span>{undoMsg}</span>
        <button className="undo-toast__btn" onClick={handleUndo}>↩ Annuler</button>
      </div>
    </div>
  );
}
