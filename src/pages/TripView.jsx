import { useState } from 'react';
import { useTripsContext } from '../context/TripsContext';
import DaySection from '../components/DaySection';
import ActivityCard from '../components/ActivityCard';
import AddActivitySheet from '../components/AddActivitySheet';
import ShareModal from '../components/ShareModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatDateShort, totalBudget, formatPrice, getDayLabel, formatDate } from '../utils/helpers';

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
  const [editingActivity, setEditingActivity] = useState(null); // { activity, location }
  const [showShare, setShowShare] = useState(false);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);

  if (!trip) return (
    <div className="trip-view">
      <div className="header">
        <button className="header__back" onClick={onBack}>←</button>
        <div className="header__title"><h1>Voyage introuvable</h1></div>
      </div>
      <div className="tab-content" style={{ textAlign: 'center', paddingTop: '40px', color: 'var(--text-muted)' }}>
        Ce voyage n'existe plus.
        <br /><button className="btn btn--primary" style={{ marginTop: '16px' }} onClick={onBack}>Retour</button>
      </div>
    </div>
  );

  const isPast = (() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return new Date(trip.endDate + 'T00:00:00') < today;
  })();

  const allActivities = [...trip.days.flatMap(d => d.activities), ...trip.reserve];
  const globalBudget = totalBudget(allActivities);
  const actTotal = trip.days.reduce((s, d) => s + d.activities.length, 0);

  const handleStatusChange = (dayId, activityId, status) => {
    setActivityStatus(tripId, { type: 'day', dayId }, activityId, status);
  };

  const handleDeleteFromDay = (dayId, activityId) => {
    deleteActivity(tripId, { type: 'day', dayId }, activityId);
  };

  const handleDeleteFromReserve = (activityId) => {
    deleteActivity(tripId, { type: 'reserve' }, activityId);
  };

  const handleEditSave = (updates) => {
    if (!editingActivity) return;
    updateActivity(tripId, editingActivity.location, editingActivity.activity.id, updates);
    setEditingActivity(null);
  };

  // DnD: when an activity is dropped onto a day section
  const handleDropOnDay = (targetDayId, activityId) => {
    if (!activityId) return;
    const isInReserve = trip.reserve.some(a => a.id === activityId);
    if (isInReserve) {
      moveFromReserveToDay(tripId, targetDayId, activityId);
      return;
    }
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay && srcDay.id !== targetDayId) {
      moveDayToDay(tripId, srcDay.id, targetDayId, activityId);
    }
  };

  // DnD: drop on reserve
  const [reserveDragOver, setReserveDragOver] = useState(false);

  const handleDropOnReserve = (e) => {
    e.preventDefault();
    const activityId = e.dataTransfer.getData('text/plain');
    const srcDay = trip.days.find(d => d.activities.some(a => a.id === activityId));
    if (srcDay) moveToReserve(tripId, srcDay.id, activityId);
    setReserveDragOver(false);
  };

  return (
    <div className="trip-view">
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

      <div className="trip-meta">
        <span className="trip-meta__item">
          📅 {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)} · {trip.days.length}j
        </span>
        {globalBudget > 0 && (
          <span className="trip-budget">💶 Budget : {formatPrice(globalBudget)}</span>
        )}
      </div>

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

      <div className="tab-content">
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
                onDrop={handleDropOnDay}
              />
            ))}
          </>
        )}

        {tab === 'reserve' && (
          <>
            {trip.reserve.length === 0 ? (
              <div
                className={`reserve-section__empty day-section__body${reserveDragOver ? ' day-section__body--drop-target' : ''}`}
                style={{ minHeight: 120 }}
                data-drop-zone="true"
                data-zone-type="reserve"
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
                  className={reserveDragOver ? 'day-section__body--drop-target' : ''}
                  style={{ borderRadius: 'var(--radius-md)', border: reserveDragOver ? '2px dashed var(--orange)' : '2px dashed transparent', transition: 'border-color 0.15s', marginBottom: 10, minHeight: 4 }}
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
                          J{di + 1} {formatDate(d.date).split(' ')[0]}
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

      <div className="fab">
        <button className="fab__btn" onClick={() => setSheetOpen(true)}>
          + Ajouter une activité
        </button>
      </div>

      {/* Add new activity */}
      <AddActivitySheet
        isOpen={sheetOpen && !editingActivity}
        onClose={() => setSheetOpen(false)}
        days={trip.days}
        onAddToReserve={(a) => addToReserve(tripId, a)}
        onAddToDay={(dayId, a) => addToDay(tripId, dayId, a)}
      />

      {/* Edit existing activity */}
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
