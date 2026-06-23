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
import MapView from '../components/MapView';
import { useWeather } from '../hooks/useWeather';
import { formatDateShort, budgetStats, formatPrice, formatDate } from '../utils/helpers';

export default function TripView({ tripId, onBack, darkMode, onToggleDark, colorTheme, onCycleTheme }) {
  const {
    getTripById, setActivityStatus, updateActivity, deleteActivity,
    moveToReserve, moveFromReserveToDay, moveDayToDay, moveToNextDay,
    addToReserve, addToDay, reorderActivity, reorderInReserve,
    setDayStartTime, deleteTrip, duplicateToDay, updateTrip
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
  const [viewMode, setViewMode] = useState('list');
  const tabContentRef = useRef(null);

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

  const allActivities = [...trip.days.flatMap(d => d.activities), ...trip.reserve];
  const stats = budgetStats(allActivities);
  const actTotal = trip.days.reduce((s, d) => s + d.activities.length, 0);

  const initBudget = parseFloat(trip.initialBudget) || 0;
  const budgetRemaining = initBudget > 0 ? initBudget - stats.spent : stats.remaining;
  const showBudget = initBudget > 0 || stats.total > 0;

  // ─── Compare helpers ──────────────────────────────────
  const toggleCompare = (id) => {
    setCompareSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const compareActivities = allActivities.filter(a => compareSelectedIds.has(a.id));

  // ─── Handlers ────────────────────────────────────────
  const handleStatusChange = (dayId, activityId, status) =>
    setActivityStatus(tripId, { type: 'day', dayId }, activityId, status);

  const handleDeleteFromDay = (dayId, activityId) =>
    deleteActivity(tripId, { type: 'day', dayId }, activityId);

  const handleDeleteFromReserve = (activityId) =>
    deleteActivity(tripId, { type: 'reserve' }, activityId);

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
          {onCycleTheme && (
            <button className="btn btn--ghost-white btn--sm" onClick={onCycleTheme} title={`Thème : ${colorTheme?.label || 'Soleil'}`}>
              {colorTheme?.emoji || '🟠'}
            </button>
          )}
          <button className="btn btn--ghost-white btn--sm" onClick={onToggleDark} title={darkMode ? 'Mode clair' : 'Mode sombre'}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button className="btn btn--ghost-white btn--sm" onClick={() => setShowShare(true)}>🔗</button>
          <button className="btn btn--ghost-white btn--sm" onClick={() => setShowDeleteTrip(true)}>🗑️</button>
        </div>
      </div>

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
        <button className={`tab-btn${tab === 'notes' ? ' tab-btn--active' : ''}`} onClick={() => setTab('notes')}>
          📝 Notes
          {trip.tripNotes?.trim() && <span className="tab-badge tab-badge--dot" />}
        </button>
        <button className={`tab-btn${tab === 'map' ? ' tab-btn--active' : ''}`} onClick={() => setTab('map')}>
          🗺 Carte
        </button>
      </div>

      {/* Compare + view toolbar */}
      <div className="compare-bar">
        {compareMode && compareSelectedIds.size >= 2 && (
          <button className="btn btn--primary btn--sm" onClick={() => setShowCompare(true)}>
            ⚖️ Voir ({compareSelectedIds.size})
          </button>
        )}
        {compareMode && compareSelectedIds.size > 0 && (
          <span className="compare-bar__hint">{compareSelectedIds.size} sélectionné{compareSelectedIds.size > 1 ? 's' : ''}</span>
        )}
        <button
          className={`btn btn--sm ${compareMode ? 'btn--danger' : 'btn--secondary'}`}
          onClick={() => { setCompareMode(p => !p); setCompareSelectedIds(new Set()); setShowCompare(false); }}
        >
          {compareMode ? '✕ Annuler' : '⚖️ Comparer'}
        </button>
        {tab === 'planning' && !compareMode && (
          <button
            className="btn btn--sm btn--secondary"
            onClick={() => setViewMode(v => v === 'list' ? 'timeline' : 'list')}
            title={viewMode === 'list' ? 'Vue timeline' : 'Vue liste'}
          >
            {viewMode === 'list' ? '🗓' : '☰'}
          </button>
        )}
      </div>

      {/* Tab content */}
      <div ref={tabContentRef} className="tab-content">

        {/* ── PLANNING TAB ── */}
        {tab === 'planning' && (
          <>
            {viewMode === 'timeline' ? (
              <TimelineView
                days={trip.days}
                onOpenDetail={(day) => setDetailDay(day)}
                onDrop={handleDropOnDay}
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
                  onMoveToReserve={(dayId, actId) => moveToReserve(tripId, dayId, actId)}
                  onMoveToNextDay={(dayId, actId) => moveToNextDay(tripId, dayId, actId)}
                  onReorder={(dayId, actId, dir) => reorderActivity(tripId, dayId, actId, dir)}
                  onStartTimeChange={(dayId, time) => setDayStartTime(tripId, dayId, time)}
                  onEdit={(activity, location) => setEditingActivity({ activity, location })}
                  onAddActivity={openAddSheet}
                  onOpenDetail={(day) => setDetailDay(day)}
                  onDrop={handleDropOnDay}
                  weather={weather?.byDate[day.date]}
                  {...sharedDayProps}
                />
              ))
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
                <p className="reserve-section__count">
                  {trip.reserve.length} idée{trip.reserve.length > 1 ? 's' : ''} en attente
                </p>
                <div
                  style={{ borderRadius: 'var(--radius-md)', border: reserveDragOver ? '2px dashed var(--orange)' : '2px dashed transparent', transition: 'border-color 0.15s', marginBottom: 10, minHeight: 8 }}
                  onDragOver={(e) => { e.preventDefault(); setReserveDragOver(true); }}
                  onDragLeave={() => setReserveDragOver(false)}
                  onDrop={handleDropOnReserve}
                />
                {trip.reserve.map((activity, i) => (
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
                      isLast={i === trip.reserve.length - 1}
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
                ))}
              </>
            )}
          </>
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

      {/* FAB — hidden on notes and map tabs */}
      {tab !== 'notes' && tab !== 'map' && (
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
        <CompareModal activities={compareActivities} onClose={() => setShowCompare(false)} />
      )}
    </div>
  );
}
