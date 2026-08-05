import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
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
import TripSearch from '../components/TripSearch';
import ReserveAssign from '../components/ReserveAssign';
import { useWeather } from '../hooks/useWeather';
import { useTripAnchor } from '../hooks/useTripAnchor';
import { useSettings } from '../hooks/useSettings';
import { useLocalNews } from '../hooks/useLocalNews';
import TripSettingsSheet from '../components/TripSettingsSheet';
import { budgetStats, formatPrice, formatDate, CATEGORIES, CATEGORY_COLORS, detectCountryTheme, haversineKm } from '../utils/helpers';
import { lookupPlace, missingFieldsFrom } from '../utils/enrich';
import { analyserVoyage } from '../utils/verifyPlaces';
import { ouvertMaintenant, dejaPlanifiee, manques } from '../utils/reserveView';
import { signauxAjout } from '../utils/propositions';
import PropositionSheet from '../components/PropositionSheet';
import { useLiveLocation, formatDistance } from '../hooks/useLiveLocation';
import { useReorderDrag } from '../hooks/useReorderDrag';
import { enrichirEnProfondeur, aEnrichir, fouillerLesFiches } from '../utils/deepEnrich';

// Leaflet (~150 KB) is only fetched when the Carte tab is actually opened.
const MapView = lazy(() => import('../components/MapView'));
// Le contrôle des lieux ne sert qu'à la demande : inutile de l'embarquer
// dans le paquet principal.
const PlaceCheckSheet = lazy(() => import('../components/PlaceCheckSheet'));
// La pop-up d'enrichissement n'apparaît qu'après une recherche réussie :
// inutile de l'embarquer dans le paquet principal.
const EnrichSheet = lazy(() => import('../components/EnrichSheet'));

function useTouchDnd({ tripId, tripRef, pushUndo, moveFromReserveToDay, moveDayToDay, moveToReserve }) {
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

  // Sur la timeline, les jours défilent horizontalement : la carte voisine ne
  // dépasse souvent que de quelques pixels à l'écran. Viser cette lisière au
  // doigt est impossible — si le point touché ne tombe sur aucune zone, on
  // rattrape le dépôt sur la carte la plus proche, à condition de rester à la
  // hauteur de la timeline. Le geste devient tolérant sans devenir hasardeux.
  const resolveZone = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const direct = el?.closest('[data-drop-zone="true"]');
    if (direct) return direct;
    const wrap = document.querySelector('.timeline-view-wrap');
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    if (y < r.top || y > r.bottom) return null;
    let best = null, bestDist = Infinity;
    wrap.querySelectorAll('[data-drop-zone="true"]').forEach(z => {
      const zr = z.getBoundingClientRect();
      const d = x < zr.left ? zr.left - x : x > zr.right ? x - zr.right : 0;
      if (d < bestDist) { bestDist = d; best = z; }
    });
    return bestDist <= 120 ? best : null;
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
      const newZone = resolveZone(touch.clientX, touch.clientY);
      s.ghost.style.visibility = '';
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
      const zone = resolveZone(touch.clientX, touch.clientY) || s.dropZone;
      s.ghost.style.visibility = '';
      if (zone && s.id) {
        const zoneType = zone.dataset.zoneType;
        const dayId = zone.dataset.dayId;
        const itemId = s.id;
        const trip = tripRef.current;
        if (zoneType === 'day' && dayId) {
          const isInReserve = trip.reserve.some(a => a.id === itemId);
          if (isInReserve) {
            pushUndo(trip, 'Idée placée dans la journée');
            moveFromReserveToDay(tripId, dayId, itemId);
          } else {
            const srcDay = trip.days.find(d => d.activities.some(a => a.id === itemId));
            if (srcDay && srcDay.id !== dayId) {
              pushUndo(trip, 'Activité déplacée');
              moveDayToDay(tripId, srcDay.id, dayId, itemId);
            }
          }
        } else if (zoneType === 'reserve') {
          const srcDay = trip.days.find(d => d.activities.some(a => a.id === itemId));
          if (srcDay) {
            pushUndo(trip, 'Activité renvoyée en réserve');
            moveToReserve(tripId, srcDay.id, itemId);
          }
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
  }, [tripId, pushUndo, moveFromReserveToDay, moveDayToDay, moveToReserve]); // eslint-disable-line react-hooks/exhaustive-deps

  return handleTouchDragStart;
}

export default function TripView({ tripId, onBack, darkMode, onToggleDark }) {
  const {
    getTripById, setActivityStatus, updateActivity, deleteActivity,
    moveToReserve, moveFromReserveToDay, moveDayToDay, moveToNextDay,
    addToReserve, addToDay, reorderActivity, reorderInReserve, moveInReserve,
    setDayStartTime, deleteTrip, duplicateToDay, updateTrip,
    setDayNotes, addPackingItem, togglePackingItem, deletePackingItem,
    setPackingOrder, sweepDayToReserve,
    restoreTrip, setDayActivitiesOrder,
    reorderDay, addToAllDays,
    addExpense, updateExpense, deleteExpense,
    addDailyTemplate, removeDailyTemplate,
    enableCollaboration, userId,
    fetchTripMembers, removeTripMember,
  } = useTripsContext();

  const trip = getTripById(tripId);
  const weather = useWeather(trip);
  // Les recherches de lieu se situent sur la DESTINATION, jamais sur la
  // première activité géolocalisée : un vol au départ ancrerait tout le
  // voyage sur la ville de départ.
  const anchor = useTripAnchor(trip?.destination);

  // Repère les fiches douteuses. Purement géométrique : aucune requête, donc
  // ça tourne en continu, même hors ligne. Un lieu à 800 km de la destination
  // est presque toujours une erreur de géocodage — mais on le signale, on ne
  // le corrige pas : c'est la recherche en ligne, à la demande, qui propose.
  const ficheseIncompletes = useMemo(
    () => (trip ? aEnrichir(trip).length : 0),
    [trip]
  );

  const analysePlaces = useMemo(
    () => (trip ? analyserVoyage(trip, anchor) : { ecartes: [], incompletes: [], total: 0 }),
    [trip, anchor]
  );

  // Déplacer une activité devant une autre, dans la même journée.
  const reordonnerJour = useCallback((dayId, id, cibleId) => {
    const jour = tripRef.current?.days.find(d => d.id === dayId);
    if (!jour || id === cibleId) return;
    // `setDayActivitiesOrder` attend les activités elles-mêmes, pas leurs
    // identifiants : lui passer des chaînes remplaçait la journée par une
    // liste de textes — toutes les activités perdues.
    const arr = [...jour.activities];
    const from = arr.findIndex(a => a.id === id);
    if (from < 0) return;
    const [item] = arr.splice(from, 1);
    const to = cibleId ? arr.findIndex(a => a.id === cibleId) : arr.length;
    arr.splice(to < 0 ? arr.length : to, 0, item);
    setDayActivitiesOrder(tripId, dayId, arr);
  }, [tripId, setDayActivitiesOrder]);

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
  const [showPlaceCheck, setShowPlaceCheck] = useState(false);
  // Propositions issues de la lecture du site des lieux, en attente d'accord.
  const [enrichProps, setEnrichProps] = useState([]);
  const [fouilleEnCours, setFouilleEnCours] = useState(null);
  const [checkBannerDismissed, setCheckBannerDismissed] = useState(false);
  const [showOptimConfirm, setShowOptimConfirm] = useState(false);
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
  // Sur place, la question est « qu'est-ce qui est ouvert, près de moi ».
  const [ouvertSeul, setOuvertSeul] = useState(false);
  // Le regroupement par catégorie masque l'ordre manuel : les deux ne peuvent
  // pas cohabiter. On le rend donc débrayable, et c'est en liste à plat que le
  // glisser-déposer prend son sens.
  const [grouper, setGrouper] = useState(true);
  const reorder = useReorderDrag(
    useCallback((id, cibleId) => moveInReserve(tripId, id, cibleId), [moveInReserve, tripId])
  );
  const geoReserve = useLiveLocation();
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoMsg, setUndoMsg] = useState('');
  const [undoDone, setUndoDone] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [tripMenuOpen, setTripMenuOpen] = useState(false);
  // Ce que l'app a remarqué en posant une activité : dit après coup, jamais
  // avant — elle ne bloque pas le geste.
  const [proposition, setProposition] = useState(null);
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

  // ─── Annuler la dernière action ───────────────────────────────────────────
  // Toute action qui supprime ou réorganise prend d'abord un instantané complet
  // du voyage. `restoreTrip` le repose tel quel : une seule mécanique couvre
  // suppressions, déplacements, balayages et réorganisations.
  // Stable (useCallback) : le hook de glisser-déposer la garde en dépendance et
  // ne doit pas réinstaller ses écouteurs à chaque rendu.
  const pushUndo = useCallback((snapshot, msg = 'Action annulée') => {
    undoRef.current = snapshot;
    setUndoMsg(msg);
    setUndoDone(false);
    setUndoVisible(true);
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => { setUndoVisible(false); undoRef.current = null; }, 6000);
  }, []);

  // Enrobe n'importe quelle action pour la rendre annulable.
  // `tripRef` plutôt que `trip` : utilisable avant le retour anticipé et jamais
  // périmé dans un gestionnaire d'événement.
  // L'instantané pris pour l'annulation est exactement « l'état d'avant » : on
  // le passe en dernier argument plutôt que de laisser chaque action relire la
  // ref. Les callbacks qui n'en ont pas besoin l'ignorent.
  const withUndo = useCallback((msg, fn) => (...args) => {
    const snapshot = tripRef.current;
    if (snapshot) pushUndo(snapshot, msg);
    return fn(...args, snapshot);
  }, [pushUndo]);

  const handleUndo = () => {
    if (undoRef.current) restoreTrip(tripId, undoRef.current);
    undoRef.current = null;
    // On confirme brièvement au lieu de faire disparaître la barre : sans retour,
    // on ne sait pas si l'annulation a bien eu lieu.
    setUndoDone(true);
    setUndoMsg('Action annulée');
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoVisible(false), 1800);
  };

  const dismissUndo = () => {
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
    tripId, tripRef, pushUndo,
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

  // Compte à rebours avant le départ, et brief de la veille pour la journée
  // de demain (activités, heure de départ, pluie éventuelle).
  const { daysUntil, tomorrow } = (() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const start = new Date(trip.startDate + 'T00:00:00');
    const diff = Math.round((start - now) / 86400000);
    const nextDay = new Date(now); nextDay.setDate(nextDay.getDate() + 1);
    const nextStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth()+1).padStart(2,'0')}-${String(nextDay.getDate()).padStart(2,'0')}`;
    const day = isPast ? null : trip.days.find(d => d.date === nextStr) || null;
    return { daysUntil: isPast ? -1 : diff, tomorrow: day };
  })();

  // ─── Itinéraire optimisé ──────────────────────────────────────────────────
  // On ne réorganise JAMAIS tout seul : on calcule un ordre plus court (plus
  // proche voisin, en gardant les activités à heure fixe à leur place) et on
  // le propose. L'utilisateur accepte ou ignore.
  const routeGain = (() => {
    if (!detailDay) return null;
    const day = trip.days.find(d => d.id === detailDay.id);
    if (!day) return null;
    const movable = day.activities.filter(a => a.status !== 'nogo' && a.lat && a.lon && !a.fixedStart);
    if (movable.length < 3) return null;

    const dist = (a, b) => haversineKm(a.lat, a.lon, b.lat, b.lon);
    const total = (list) => list.reduce((s, a, i) => i === 0 ? 0 : s + dist(list[i - 1], a), 0);

    // Plus proche voisin depuis le premier lieu (on garde le point de départ).
    const remaining = movable.slice(1);
    const ordered = [movable[0]];
    while (remaining.length) {
      const last = ordered[ordered.length - 1];
      let best = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (dist(last, remaining[i]) < dist(last, remaining[best])) best = i;
      }
      ordered.push(remaining.splice(best, 1)[0]);
    }

    const before = total(movable);
    const after = total(ordered);
    if (before - after < 0.5) return null; // gain négligeable : on ne propose rien

    // On réinjecte l'ordre optimisé aux emplacements des activités déplaçables,
    // les autres (heure fixe, annulées, sans coordonnées) ne bougent pas.
    const movableIds = new Set(movable.map(a => a.id));
    let k = 0;
    const newOrder = day.activities.map(a => movableIds.has(a.id) ? ordered[k++] : a);
    return { dayId: day.id, saved: before - after, newOrder };
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
  const handleStatusChange = (dayId, activityId, status) => {
    // Marquer « fait » se re-bascule d'un tap ; annuler une activité, non.
    if (status === 'nogo') pushUndo(trip, 'Activité annulée');
    setActivityStatus(tripId, { type: 'day', dayId }, activityId, status);
  };

  const handleDeleteFromDay = (dayId, activityId) => {
    pushUndo(trip, 'Activité supprimée');
    deleteActivity(tripId, { type: 'day', dayId }, activityId);
  };

  const handleDeleteFromReserve = (activityId) => {
    pushUndo(trip, 'Activité supprimée');
    deleteActivity(tripId, { type: 'reserve' }, activityId);
  };

  // Actions annulables : chaque déplacement ou balayage est réversible d'un tap.
  const undoableMoveToReserve = withUndo('Activité renvoyée en réserve',
    (dayId, actId) => moveToReserve(tripId, dayId, actId));
  const undoableMoveToNextDay = withUndo('Activité reportée au lendemain',
    (dayId, actId) => moveToNextDay(tripId, dayId, actId));
  const undoableMoveDayToDay = withUndo('Activité déplacée',
    (srcDayId, tgtDayId, actId) => moveDayToDay(tripId, srcDayId, tgtDayId, actId));
  const undoableAssignFromReserve = withUndo('Idée placée dans la journée',
    (dayId, actId, avant) => {
      // Les signaux se lisent sur l'état d'AVANT : après le déplacement, l'idée
      // a quitté la réserve et la journée n'est plus la même. On les affiche
      // une fois l'idée posée — l'app signale, elle n'empêche pas.
      const idee = (avant?.reserve || []).find(a => a.id === actId);
      const jour = (avant?.days || []).find(d => d.id === dayId);
      moveFromReserveToDay(tripId, dayId, actId);
      if (!idee || !jour) return;
      const signaux = signauxAjout(idee, jour);
      if (!signaux.length) return;
      const idx = avant.days.findIndex(d => d.id === dayId);
      setProposition({ titre: idee.title, jour: `Jour ${idx + 1}`, signaux });
    });
  const undoableSweep = withUndo('Journée renvoyée en réserve',
    (dayId) => sweepDayToReserve(tripId, dayId));
  const undoableReorderDay = withUndo('Jour déplacé',
    (dayId, dir) => reorderDay(tripId, dayId, dir));
  const undoableDeleteExpense = withUndo('Dépense supprimée',
    (expId) => deleteExpense(tripId, expId));
  const undoableDeleteTraveler = withUndo('Voyageur supprimé',
    (id) => updateTrip(tripId, { tripTravelers: (trip.tripTravelers || []).filter(t => t.id !== id) }));

  const handleEditSave = (updates) => {
    if (!editingActivity) return;
    updateActivity(tripId, editingActivity.location, editingActivity.activity.id, updates);
    setEditingActivity(null);
  };

  // L'agent ne travaillait qu'à l'ajout. Or une information se périme : un
  // restaurant change ses horaires, un musée ses tarifs. On repasse donc sur
  // l'existant — à la demande, et jamais sans montrer ce qu'on a trouvé.
  const fouiller = async () => {
    const liste = aEnrichir(tripRef.current);
    if (!liste.length) return;
    const ctrl = new AbortController();
    setFouilleEnCours({ fait: 0, total: liste.length, titre: null, ctrl });
    const { propositions, marques } = await fouillerLesFiches(liste, {
      arret: ctrl.signal,
      onProgres: (p) => setFouilleEnCours(e => (e ? { ...e, ...p } : e)),
    });
    marques.forEach(m => updateActivity(tripId, m.emplacement, m.id, m.patch));
    setFouilleEnCours(null);
    if (propositions.length) setEnrichProps(propositions);
  };

  const openAddSheet = (dayId = null) => {
    setSheetDefaultDayId(dayId);
    setSheetOpen(true);
  };

  // Une épingle qu'on ne peut que regarder oblige à refermer la carte et à
  // retrouver l'activité dans la bonne liste pour corriger une adresse. La
  // bulle ouvre directement la fiche, où qu'elle soit rangée.
  const openActivityFromMap = (actId) => {
    for (const d of trip.days) {
      const activity = d.activities.find(a => a.id === actId);
      if (activity) {
        setEditingActivity({ activity, location: { type: 'day', dayId: d.id } });
        return;
      }
    }
    const inReserve = (trip.reserve || []).find(a => a.id === actId);
    if (inReserve) setEditingActivity({ activity: inReserve, location: { type: 'reserve' } });
  };

  const handleDuplicate = (activityId, targetDayId) =>
    duplicateToDay(tripId, activityId, targetDayId);

  // Complète en arrière-plan les informations qu'on n'a pas saisies (adresse,
  // horaires, prix, coordonnées). L'activité est déjà enregistrée : on
  // n'attend pas le réseau, et un échec ne casse rien.
  const autoEnrich = async (activity, activityId, location) => {
    if (!activityId || activity.isMeal) return;
    const complete = activity.address && activity.openingHours && activity.lat;
    let aJour = activity;
    if (!complete) {
      const found = await lookupPlace(activity.title, trip.destination,
        { lat: anchor?.lat, lon: anchor?.lon });
      const patch = missingFieldsFrom(activity, found);
      if (patch) {
        updateActivity(tripId, location, activityId, patch);
        aJour = { ...activity, ...patch };
      }
    }

    // Les bases ouvertes s'arrêtent là. Le site du lieu, lui, donne les
    // horaires réels, une gamme de prix et de quoi décrire l'endroit — c'est
    // ce qui évite d'avoir à chercher sur place. La recherche part en fond ;
    // rien n'est écrit sans accord.
    const trouve = await enrichirEnProfondeur({ ...aJour, id: activityId });
    if (!trouve) return;
    // Cherché sans rien trouver : on le retient quand même, sinon la fiche
    // repasserait dans le circuit à la prochaine ouverture.
    if (!trouve.patch) { updateActivity(tripId, location, activityId, trouve.marque); return; }
    setEnrichProps(list => (
      list.some(p => p.id === activityId) ? list : [...list, {
        id: activityId,
        emplacement: location,
        titre: aJour.title,
        ou: location.type === 'reserve'
          ? 'Réserve'
          : `Jour ${trip.days.findIndex(d => d.id === location.dayId) + 1}`,
        ...trouve,
      }]
    ));
  };

  // ─── Drag & Drop ─────────────────────────────────────
  const handleDropOnDay = (targetDayId, activityId) => {
    if (!activityId) return;
    const isInReserve = trip.reserve.some(a => a.id === activityId);
    if (isInReserve) { undoableAssignFromReserve(targetDayId, activityId); return; }
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay && srcDay.id !== targetDayId) undoableMoveDayToDay(srcDay.id, targetDayId, activityId);
  };

  const handleDropOnReserve = (e) => {
    e.preventDefault();
    const activityId = e.dataTransfer.getData('text/plain');
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay) undoableMoveToReserve(srcDay.id, activityId);
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
        </div>
        <div className="header__action">
          <button className="header__add-btn" onClick={() => openAddSheet(null)} title="Ajouter une activité" aria-label="Ajouter une activité">＋</button>
          <div className="trip-header-menu-wrap" ref={tripMenuRef}>
            <button className="btn btn--ghost-white btn--sm" onClick={() => setTripMenuOpen(o => !o)} title="Options" aria-label="Options du voyage" aria-expanded={tripMenuOpen} aria-haspopup="menu">⋯</button>
            {tripMenuOpen && (
              <div className="trip-header-menu">
                <button className="trip-header-menu__item" onClick={() => { setShowSearch(true); setTripMenuOpen(false); }}>
                  🔍 Rechercher dans le voyage
                </button>
                <div className="trip-header-menu__divider" />
                <button className="trip-header-menu__item" onClick={() => { onToggleDark(); setTripMenuOpen(false); }}>
                  {darkMode ? '☀️ Mode clair' : '🌙 Mode sombre'}
                </button>
                <button className="trip-header-menu__item" onClick={() => { forceRefreshApp(); }}>
                  🔄 Recharger l'app
                </button>
                <div className="trip-header-menu__divider" />
                <button className="trip-header-menu__item" onClick={() => { navigateTab('notes'); setTripMenuOpen(false); }}>
                  📝 Notes du voyage{trip.tripNotes?.trim() ? ' •' : ''}
                </button>
                <button className="trip-header-menu__item" onClick={() => { navigateTab('valise'); setTripMenuOpen(false); }}>
                  🎒 Valise{(trip.packingList?.length || 0) > 0
                    ? ` · ${trip.packingList.filter(i => i.checked).length}/${trip.packingList.length}`
                    : ''}
                </button>
                <div className="trip-header-menu__divider" />
                {tab === 'planning' && (
                  <button className="trip-header-menu__item" onClick={() => { setCompareMode(true); setTripMenuOpen(false); }}>
                    ⚖️ Comparer des activités
                  </button>
                )}
                <button className="trip-header-menu__item" onClick={() => { setTripMenuOpen(false); fouiller(); }}>
                  ✨ Compléter les fiches
                  {ficheseIncompletes > 0 && (
                    <span className="trip-header-menu__count">{ficheseIncompletes}</span>
                  )}
                </button>
                <button className="trip-header-menu__item" onClick={() => { setShowPlaceCheck(true); setTripMenuOpen(false); }}>
                  📍 Vérifier les lieux
                  {analysePlaces.nouveaux > 0 && (
                    <span className="trip-header-menu__count">{analysePlaces.nouveaux}</span>
                  )}
                </button>
                <button className="trip-header-menu__item" onClick={() => { setShowShare(true); setTripMenuOpen(false); }}>
                  🔗 Partager
                </button>
                <button className="trip-header-menu__item" onClick={() => { setShowRecap(true); setTripMenuOpen(false); }}>
                  📊 Bilan du voyage
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
        <button role="tab" aria-selected={tab === 'depenses'} className={`tab-btn${tab === 'depenses' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('depenses')}>
          <span className="tab-btn__icon">💸</span>
          <span className="tab-btn__label">Dépenses</span>
          {(trip.expenses?.length || 0) > 0 && <span className="tab-badge" aria-label={`${trip.expenses.length} dépenses`}>{trip.expenses.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'reserve'} className={`tab-btn${tab === 'reserve' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('reserve')}>
          <span className="tab-btn__icon">📦</span>
          <span className="tab-btn__label">Réserve</span>
          {trip.reserve.length > 0 && <span className="tab-badge" aria-label={`${trip.reserve.length} idées`}>{trip.reserve.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'map'} className={`tab-btn${tab === 'map' ? ' tab-btn--active' : ''}`} onClick={() => navigateTab('map')}>
          <span className="tab-btn__icon">🗺️</span>
          <span className="tab-btn__label">Carte</span>
        </button>
        {/* Notes et Valise sont rarement utilisés → sortis de la barre du bas et
            accessibles depuis le menu ⋯. Ils restent des onglets à part entière :
            l'onglet actif reste visible ici quand on y navigue depuis le menu. */}
        {tab === 'notes' && (
          <button role="tab" aria-selected className="tab-btn tab-btn--active" onClick={() => navigateTab('notes')}>
            <span className="tab-btn__icon">📝</span>
            <span className="tab-btn__label">Notes</span>
          </button>
        )}
        {tab === 'valise' && (
          <button role="tab" aria-selected className="tab-btn tab-btn--active" onClick={() => navigateTab('valise')}>
            <span className="tab-btn__icon">🎒</span>
            <span className="tab-btn__label">Valise</span>
            {(trip.packingList?.length || 0) > 0 && (
              <span className="tab-badge" aria-label={`${trip.packingList.filter(i => i.checked).length} sur ${trip.packingList.length} emballés`}>{trip.packingList.filter(i => i.checked).length}/{trip.packingList.length}</span>
            )}
          </button>
        )}
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
            onAddFromReserve={todayDay ? (actId) => undoableAssignFromReserve(todayDay.id, actId) : null}
            onMoveFromDay={todayDay ? (srcDayId, actId) => undoableMoveDayToDay(srcDayId, todayDay.id, actId) : null}
          />
        )}

        {/* ── PLANNING TAB ── */}
        {tab === 'planning' && (
          <>
            {/* Un lieu mal situé ne se voit pas dans une liste : on le dit.
                Discret, refermable, et sans rien changer tant qu'on n'a pas
                demandé — l'app propose, elle ne réorganise jamais d'office. */}
            {analysePlaces.ecartesNeufs > 0 && !checkBannerDismissed && (
              <div className="place-alert">
                <span className="place-alert__icon" aria-hidden="true">📍</span>
                <div className="place-alert__text">
                  <strong>
                    {analysePlaces.ecartesNeufs === 1
                      ? '1 lieu semble mal situé'
                      : `${analysePlaces.ecartesNeufs} lieux semblent mal situés`}
                  </strong>
                  <span>Loin de {trip.destination || 'la destination'} — sans doute une erreur d'import.</span>
                </div>
                <button className="place-alert__cta" onClick={() => setShowPlaceCheck(true)}>
                  Vérifier
                </button>
                <button
                  className="place-alert__close"
                  onClick={() => setCheckBannerDismissed(true)}
                  aria-label="Masquer cet avertissement"
                >✕</button>
              </div>
            )}

            {/* Avant le départ : compte à rebours */}
            {daysUntil > 0 && (
              <div className="countdown-banner">
                <span className="countdown-banner__num">J−{daysUntil}</span>
                <span className="countdown-banner__text">
                  {daysUntil === 1 ? 'Départ demain !' : `Plus que ${daysUntil} jours avant le départ`}
                </span>
              </div>
            )}
            {/* La veille : brief de la journée de demain */}
            {tomorrow && (() => {
              const todo = tomorrow.activities.filter(a => a.status !== 'nogo');
              const w = weather?.byDate?.[tomorrow.date];
              const rainy = w && ((w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82) || (w.code >= 95 && w.code <= 99));
              return (
                <div className="tomorrow-banner">
                  <div className="tomorrow-banner__title">🌙 Demain</div>
                  <div className="tomorrow-banner__body">
                    {todo.length === 0
                      ? 'Rien de planifié — journée libre.'
                      : `${todo.length} activité${todo.length > 1 ? 's' : ''} · départ à ${tomorrow.startTime || '09:00'}`}
                    {w && ` · ${w.icon} ${w.max}°/${w.min}°`}
                    {rainy && ' · pense au parapluie ☔'}
                  </div>
                </div>
              );
            })()}
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
                onReorderDay={undoableReorderDay}
                weatherByDate={weather?.byDate}
                onReordonner={reordonnerJour}
              />
            ) : (
              <TimelineView
                days={trip.days}
                onOpenDetail={(day) => setDetailDay(day)}
                onDrop={handleDropOnDay}
                onMoveToDay={undoableMoveDayToDay}
                onMoveToReserve={undoableMoveToReserve}
                compareMode={compareMode}
                compareSelectedIds={compareSelectedIds}
                onToggleCompare={toggleCompare}
                onTouchDragStart={handleTouchDragStart}
                weatherByDate={weather?.byDate}
                onReordonner={reordonnerJour}
              />
            )}

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
                    {geoReserve.position && <option value="proche">Le plus proche</option>}
                  </select>
                </div>
                <div className="reserve-filter">
                  <button
                    className={`reserve-filter__pill${reserveFilter === 'all' ? ' reserve-filter__pill--active' : ''}`}
                    onClick={() => setReserveFilter('all')}
                  >Tout ({trip.reserve.length})</button>
                  {/* Un lieu dont on ignore les horaires n'est jamais masqué :
                      le filtre écarte ce qui est fermé, pas ce qu'on ne sait pas. */}
                  <button
                    className={`reserve-filter__pill reserve-filter__pill--ouvert${ouvertSeul ? ' reserve-filter__pill--active' : ''}`}
                    onClick={() => setOuvertSeul(v => !v)}
                    aria-pressed={ouvertSeul}
                  >🟢 Ouvert</button>
                  <button
                    className={`reserve-filter__pill${grouper ? ' reserve-filter__pill--active' : ''}`}
                    onClick={() => setGrouper(v => !v)}
                    aria-pressed={grouper}
                    title={grouper ? 'Afficher en liste, réordonnable' : 'Grouper par catégorie'}
                  >{grouper ? '⊞ Groupé' : '☰ Liste'}</button>
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
                  const pos = geoReserve.position;
                  const dist = (a) => (pos && a.lat != null && a.lon != null)
                    ? haversineKm(pos.lat, pos.lon, a.lat, a.lon) : null;

                  const retenues = trip.reserve
                    .filter(a => {
                      if (reserveFilter !== 'all' && a.category !== reserveFilter) return false;
                      if (ouvertSeul && ouvertMaintenant(a.openingHours) === false) return false;
                      if (q) return a.title.toLowerCase().includes(q) || (a.address || '').toLowerCase().includes(q) || (a.notes || '').toLowerCase().includes(q);
                      return true;
                    })
                    .sort((a, b) => {
                      if (reserveSort === 'alpha') return a.title.localeCompare(b.title, 'fr');
                      if (reserveSort === 'duration') return ((a.durationHours||0)*60+(a.durationMinutes||0)) - ((b.durationHours||0)*60+(b.durationMinutes||0));
                      if (reserveSort === 'price') return (parseFloat(a.price)||0) - (parseFloat(b.price)||0);
                      if (reserveSort === 'proche') {
                        // Sans coordonnées, on ne peut pas classer : ces idées
                        // vont en fin de liste plutôt que de fausser l'ordre.
                        const da = dist(a), db = dist(b);
                        if (da == null) return db == null ? 0 : 1;
                        if (db == null) return -1;
                        return da - db;
                      }
                      return 0;
                    });

                  // Regroupement par catégorie : c'est le premier tri de l'œil.
                  // Il ne s'applique que quand on regarde TOUT — filtrer sur une
                  // seule catégorie rendrait les en-têtes absurdes.
                  const groupes = (grouper && reserveFilter === 'all')
                    ? CATEGORIES
                        .map(cat => ({ cat, items: retenues.filter(a => a.category === cat.id) }))
                        .filter(g => g.items.length)
                    : [{ cat: null, items: retenues }];
                  const sansCat = retenues.filter(a => !CATEGORIES.some(c => c.id === a.category));
                  if (grouper && reserveFilter === 'all' && sansCat.length) groupes.push({ cat: null, items: sansCat });
                  // Réordonner n'a de sens que sur une liste à plat, dans son
                  // ordre propre : groupée ou triée, la position manuelle ne se
                  // voit plus, donc la déplacer ne veut rien dire.
                  const reordonnable = !grouper && reserveSort === 'default' && reserveFilter === 'all' && !q;

                  if (!retenues.length) {
                    return (
                      <p className="reserve-vide">
                        {ouvertSeul
                          ? "Rien d'ouvert en ce moment parmi tes idées."
                          : 'Aucune idée ne correspond.'}
                      </p>
                    );
                  }

                  return groupes.map(g => (
                    <div key={g.cat?.id || 'autres'} className="reserve-groupe">
                      {g.cat && (
                        <div className="reserve-groupe__titre">
                          <span className="reserve-groupe__dot" style={{ background: CATEGORY_COLORS[g.cat.id] }} />
                          {g.cat.emoji} {g.cat.label}
                          <span className="reserve-groupe__n">{g.items.length}</span>
                        </div>
                      )}
                      {g.items.map((activity, i, arr) => (
                  <div
                    key={activity.id}
                    data-reorder-id={reordonnable ? activity.id : undefined}
                    className={`reserve-card${dejaPlanifiee(activity, trip.days) ? ' reserve-card--planifiee' : ''}`
                      + (reorder.dragId === activity.id ? ' reserve-card--drag' : '')
                      + (reorder.surId === activity.id && reorder.dragId !== activity.id ? ' reserve-card--cible' : '')}
                  >
                    {reordonnable && (
                      <button
                        className="reserve-card__grip"
                        onPointerDown={(e) => reorder.demarrer(activity.id, e)}
                        aria-label={`Déplacer ${activity.title}`}
                      >⠿</button>
                    )}
                    {/* Ce qu'il faut savoir avant de piocher, en une ligne
                        discrète : ouvert ou non, à quelle distance, et ce qui
                        manquera sur place. */}
                    {(() => {
                      const ouv = ouvertMaintenant(activity.openingHours);
                      const km = dist(activity);
                      const m = manques(activity);
                      const planifiee = dejaPlanifiee(activity, trip.days);
                      if (ouv === null && km == null && !m.length && !planifiee) return null;
                      return (
                        <div className="reserve-etat">
                          {ouv === true && <span className="reserve-etat__ouvert">Ouvert</span>}
                          {ouv === false && <span className="reserve-etat__ferme">Fermé</span>}
                          {km != null && <span className="reserve-etat__km">{formatDistance(km)}</span>}
                          {planifiee && <span className="reserve-etat__plan">déjà au programme</span>}
                          {m.length > 0 && (
                            <span className="reserve-etat__manque" title={`Manque : ${m.join(', ')}`}>
                              {m.length} info{m.length > 1 ? 's' : ''} à compléter
                            </span>
                          )}
                        </div>
                      );
                    })()}
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
                    <ReserveAssign
                      days={trip.days}
                      onAssign={(dayId) => undoableAssignFromReserve(dayId, activity.id)}
                    />
                  </div>
                      ))}
                    </div>
                  ));
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
            onUpdateExpense={(expId, patch) => updateExpense(tripId, expId, patch)}
            currentUserId={userId}
            onDeleteExpense={undoableDeleteExpense}
            onDeleteTraveler={undoableDeleteTraveler}
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
            <MapView days={trip.days} reserve={trip.reserve} roadTripMode={trip.roadTripMode} tripColor={trip.color} accommodationAddress={trip.accommodationAddress} accommodationLat={trip.accommodationLat} accommodationLon={trip.accommodationLon} onOpenActivity={openActivityFromMap}
              onPiocher={todayDay ? (actId) => undoableAssignFromReserve(todayDay.id, actId) : null} />
          </Suspense>
        )}
      </div>


      {/* Modals & sheets */}
      <AddActivitySheet
        isOpen={sheetOpen && !editingActivity}
        onClose={() => { setSheetOpen(false); setSheetDefaultDayId(null); }}
        days={trip.days}
        defaultDayId={sheetDefaultDayId}
        onAddToReserve={(a) => { const id = addToReserve(tripId, a); autoEnrich(a, id, { type: 'reserve' }); }}
        onAddToDay={(dayId, a) => { const id = addToDay(tripId, dayId, a); autoEnrich(a, id, { type: 'day', dayId }); }}
        reserveActivities={trip.reserve}
        onMoveFromReserve={(actId) => { if (sheetDefaultDayId) undoableAssignFromReserve(sheetDefaultDayId, actId); }}
        tripTravelers={trip.tripTravelers || []}
        onAddToAllDays={(a) => addToAllDays(tripId, a)}
        tripLat={anchor?.lat}
        tripLon={anchor?.lon}
        tripDestination={trip.destination}
      />

      {fouilleEnCours && (
        <div className="fouille-toast">
          <span className="fouille-toast__bar">
            <span style={{ width: `${fouilleEnCours.total ? (fouilleEnCours.fait / fouilleEnCours.total) * 100 : 0}%` }} />
          </span>
          <span className="fouille-toast__txt">
            {fouilleEnCours.titre ? `Recherche · ${fouilleEnCours.titre}` : 'Recherche…'}
            {' '}({fouilleEnCours.fait}/{fouilleEnCours.total})
          </span>
          <button className="fouille-toast__stop" onClick={() => { fouilleEnCours.ctrl.abort(); setFouilleEnCours(null); }}>
            Arrêter
          </button>
        </div>
      )}

      {enrichProps.length > 0 && (
        <Suspense fallback={null}>
          <EnrichSheet
            propositions={enrichProps}
            onAppliquer={(location, actId, patch) => updateActivity(tripId, location, actId, patch)}
            onIgnorer={(actId) => setEnrichProps(l => l.filter(p => p.id !== actId))}
            onClose={() => setEnrichProps([])}
          />
        </Suspense>
      )}

      {proposition && (
        <PropositionSheet
          titre={proposition.titre}
          jour={proposition.jour}
          signaux={proposition.signaux}
          onGarder={() => setProposition(null)}
          onAnnuler={() => { setProposition(null); handleUndo(); }}
        />
      )}

      {showPlaceCheck && (
        <Suspense fallback={null}>
          <PlaceCheckSheet
            analyse={analysePlaces}
            destination={trip.destination}
            ancre={anchor}
            onAppliquer={(location, actId, patch) => updateActivity(tripId, location, actId, patch)}
            onOuvrirFiche={openActivityFromMap}
            onClose={() => setShowPlaceCheck(false)}
          />
        </Suspense>
      )}

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
          onMoveToReserve={undoableMoveToReserve}
          onMoveToNextDay={undoableMoveToNextDay}
          onReorder={(dayId, actId, dir) => reorderActivity(tripId, dayId, actId, dir)}
          onStartTimeChange={(dayId, time) => setDayStartTime(tripId, dayId, time)}
          onEdit={(activity, location) => { setDetailDay(null); setEditingActivity({ activity, location }); }}
          onAddActivity={(dayId) => { setDetailDay(null); openAddSheet(dayId); }}
          onNotesChange={(dayId, notes) => setDayNotes(tripId, dayId, notes)}
          onSweep={undoableSweep}
          routeGain={routeGain}
          onOptimizeRoute={() => setShowOptimConfirm(true)}
          {...sharedDayProps}
        />
      )}

      {showOptimConfirm && routeGain && (
        <ConfirmDialog
          icon="🗺"
          title="Réorganiser cette journée ?"
          message={`En changeant l'ordre des activités, tu économises environ ${
            routeGain.saved < 1 ? `${Math.round(routeGain.saved * 1000)} m` : `${routeGain.saved.toFixed(1)} km`
          } de trajet. Les activités à heure fixe ne bougent pas.`}
          confirmLabel="Réorganiser"
          cancelLabel="Laisser comme ça"
          onConfirm={() => {
            pushUndo(trip, 'Journée réorganisée');
            setDayActivitiesOrder(tripId, routeGain.dayId, routeGain.newOrder);
            setShowOptimConfirm(false);
          }}
          onCancel={() => setShowOptimConfirm(false)}
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

      {showSearch && (
        <TripSearch
          trip={trip}
          onClose={() => setShowSearch(false)}
          onOpenDay={(day) => { setShowSearch(false); navigateTab('planning'); setDetailDay(day); }}
          onOpenReserve={(query) => { setShowSearch(false); setReserveSearch(query); setReserveFilter('all'); navigateTab('reserve'); }}
          onOpenTab={(t) => { setShowSearch(false); navigateTab(t); }}
        />
      )}

      {/* Le pop-up de proposition porte déjà « Annuler l'ajout » : laisser le
          bandeau derrière afficherait deux fois la même sortie. */}
      <div className={`undo-toast${undoVisible && !proposition ? ' undo-toast--visible' : ''}${undoDone ? ' undo-toast--done' : ''}`} role="status">
        <span className="undo-toast__msg">{undoDone ? '↩ ' : ''}{undoMsg}</span>
        {!undoDone && (
          <>
            <button className="undo-toast__btn" onClick={handleUndo}>↩ Annuler</button>
            <button className="undo-toast__close" onClick={dismissUndo} aria-label="Masquer">✕</button>
          </>
        )}
      </div>
    </div>
  );
}
