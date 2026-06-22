import { useState } from 'react';
import { useTripsContext } from '../context/TripsContext';
import DaySection from '../components/DaySection';
import ActivityCard from '../components/ActivityCard';
import AddActivitySheet from '../components/AddActivitySheet';
import ShareModal from '../components/ShareModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatDateShort, getDayLabel, formatDate } from '../utils/helpers';

export default function TripView({ tripId, onBack }) {
  const {
    getTripById, setActivityStatus, deleteActivity,
    moveToReserve, moveFromReserveToDay, moveToNextDay,
    addToReserve, addToDay, deleteTrip
  } = useTripsContext();

  const trip = getTripById(tripId);
  const [tab, setTab] = useState('planning');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDeleteTrip, setShowDeleteTrip] = useState(false);

  if (!trip) {
    return (
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
  }

  const handleStatusChange = (dayId, activityId, status) => {
    setActivityStatus(tripId, { type: 'day', dayId }, activityId, status);
  };

  const handleDeleteFromDay = (dayId, activityId) => {
    deleteActivity(tripId, { type: 'day', dayId }, activityId);
  };

  const handleDeleteFromReserve = (activityId) => {
    deleteActivity(tripId, { type: 'reserve' }, activityId);
  };

  const handleReserveStatusChange = (activityId, status) => {
    setActivityStatus(tripId, { type: 'reserve' }, activityId, status);
  };

  return (
    <div className="trip-view">
      <div className="header">
        <button className="header__back" onClick={onBack}>←</button>
        <div className="header__title">
          <h1>{trip.name}</h1>
          {trip.destination && <p>📍 {trip.destination}</p>}
        </div>
        <div className="header__action">
          <button className="btn btn--ghost-white btn--sm" onClick={() => setShowShare(true)} title="Partager">
            🔗
          </button>
          <button className="btn btn--ghost-white btn--sm" onClick={() => setShowDeleteTrip(true)} title="Supprimer">
            🗑️
          </button>
        </div>
      </div>

      <div style={{ padding: '0 16px 12px', color: 'rgba(255,255,255,0.85)', fontSize: '13px' }}>
        📅 {formatDateShort(trip.startDate)} → {formatDateShort(trip.endDate)}
        {' · '}{trip.days.length} jour{trip.days.length > 1 ? 's' : ''}
      </div>

      <div className="tabs">
        <button className={`tab-btn${tab === 'planning' ? ' tab-btn--active' : ''}`} onClick={() => setTab('planning')}>
          📅 Planning
          {trip.days.reduce((s, d) => s + d.activities.length, 0) > 0 && (
            <span className="tab-badge">{trip.days.reduce((s, d) => s + d.activities.length, 0)}</span>
          )}
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
                tripId={tripId}
                onStatusChange={handleStatusChange}
                onDelete={handleDeleteFromDay}
                onMoveToReserve={moveToReserve.bind(null, tripId)}
                onMoveToNextDay={moveToNextDay.bind(null, tripId)}
              />
            ))}
          </>
        )}

        {tab === 'reserve' && (
          <>
            {trip.reserve.length === 0 ? (
              <div className="reserve-section__empty">
                <div className="reserve-section__empty-icon">💡</div>
                <p style={{ color: 'var(--text-muted)', fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                  Boîte à idées vide
                </p>
                <p style={{ color: 'var(--text-light)', fontSize: '13px' }}>
                  Ajoute des envies ici sans les assigner à un jour.<br />Tu pourras les glisser dans ton planning plus tard.
                </p>
              </div>
            ) : (
              <>
                <p className="reserve-section__count">
                  {trip.reserve.length} activité{trip.reserve.length > 1 ? 's' : ''} en attente
                </p>
                {trip.reserve.map(activity => (
                  <div key={activity.id} className="reserve-card">
                    <ActivityCard
                      activity={activity}
                      context="reserve"
                      onStatusChange={(s) => handleReserveStatusChange(activity.id, s)}
                      onDelete={() => handleDeleteFromReserve(activity.id)}
                    />
                    <div className="reserve-card__assign">
                      <span className="reserve-card__assign-label">Assigner à :</span>
                      {trip.days.map((d, i) => (
                        <button key={d.id} className="day-pill"
                          onClick={() => moveFromReserveToDay(tripId, d.id, activity.id)}>
                          J{i + 1} · {formatDate(d.date).split(' ').slice(0, 2).join(' ')}
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

      <AddActivitySheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        days={trip.days}
        onAddToReserve={(a) => addToReserve(tripId, a)}
        onAddToDay={(dayId, a) => addToDay(tripId, dayId, a)}
      />

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
