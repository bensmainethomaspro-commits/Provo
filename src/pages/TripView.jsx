import { useState } from 'react';
import { useTripsContext } from '../context/TripsContext';
import DaySection from '../components/DaySection';
import DayDetailModal from '../components/DayDetailModal';
import ActivityCard from '../components/ActivityCard';
import AddActivitySheet from '../components/AddActivitySheet';
import ShareModal from '../components/ShareModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatDateShort, budgetStats, formatPrice, formatDate, getDayLabel } from '../utils/helpers';

export default function TripView({ tripId, onBack, darkMode, onToggleDark }) {
  const {
    getTripById, setActivityStatus, updateActivity, deleteActivity,
    moveToReserve, moveFromReserveToDay, moveDayToDay, moveToNextDay,
    addToReserve, addToDay, reorderActivity, reorderInReserve,
    setDayStartTime, deleteTrip
  } = useTripsContext();

  const trip = getTripById(tripId);
  const [tab, setTab] = useState('planning');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDefaultDayId, setSheetDefaultDayId] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);
  const [detailDay, setDetailDay] = useState(null);  // day object for detail modal
  const [reserveExpanded, setReserveExpanded] = useState(false);
  const [reserveDragOver, setReserveDragOver] = useState(false);

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

  // ─── Handlers ──────────────────────────────────────────
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

  // ─── Drag & Drop ──────────────────────────────────────
  const handleDropOnDay = (targetDayId, activityId) => {
    if (!activityId) return;
    // Check if coming from reserve
    const isInReserve = trip.reserve.some(a => a.id === activityId);
    if (isInReserve) {
      moveFromReserveToDay(tripId, targetDayId, activityId);
      return;
    }
    // Check if coming from another day
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay && srcDay.id !== targetDayId) {
      moveDayToDay(tripId, srcDay.id, targetDayId, activityId);
    }
  };

  const handleDropOnReserve = (e) => {
    e.preventDefault();
    const activityId = e.dataTransfer.getData('text/plain');
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay) moveToReserve(tripId, srcDay.id, activityId);
    setReserveDragOver(false);
  };

  // ─── Detail modal handlers (mirror day handlers) ──────
  const detailDay_ = detailDay ? trip.days.find(d => d.id === detailDay.id) : null;

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
          <button className="btn btn--ghost-white btn--sm" onClick={() => setShowShare(true)}>🔗</button>
          <button className="btn btn--ghost-white btn--sm" onClick={() => setShowDeleteTrip(true)}>🗑️</button>
        </div>
      </div>

      {/* Trip meta + budget */}
      <div className="trip-meta">
        <span className="trip-meta__item">
          📅 {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)} · {trip.days.length}j
        </span>
        {stats.total > 0 && (
          <>
            <span className="budget-pill budget-pill--total">💰 {formatPrice(stats.total)}</span>
            {stats.spent > 0 && <span className="budget-pill budget-pill--spent">✅ {formatPrice(stats.spent)}</span>}
            {stats.remaining > 0 && <span className="budget-pill budget-pill--remaining">💵 Restant {formatPrice(stats.remaining)}</span>}
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
      </div>

      {/* Tab content */}
      <div className="tab-content">

        {/* ── PLANNING TAB ── */}
        {tab === 'planning' && (
          <>
            {trip.days.map((day, i) => (
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
              />
            ))}

            {/* Reserve mini-panel at bottom of planning for drag-from-reserve */}
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
      </div>

      {/* FAB */}
      <div className="fab">
        <button className="fab__btn" onClick={() => openAddSheet(null)}>
          + Ajouter une activité
        </button>
      </div>

      {/* Modals & sheets */}
      <AddActivitySheet
        isOpen={sheetOpen && !editingActivity}
        onClose={() => { setSheetOpen(false); setSheetDefaultDayId(null); }}
        days={trip.days}
        defaultDayId={sheetDefaultDayId}
        onAddToReserve={(a) => addToReserve(tripId, a)}
        onAddToDay={(dayId, a) => addToDay(tripId, dayId, a)}
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

      {/* Day detail modal */}
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
    </div>
  );
}
