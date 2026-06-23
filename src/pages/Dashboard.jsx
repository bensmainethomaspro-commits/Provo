import { useState } from 'react';
import { useTripsContext } from '../context/TripsContext';
import TripCard from '../components/TripCard';
import NewTripModal from '../components/NewTripModal';
import ConfirmDialog from '../components/ConfirmDialog';

export default function Dashboard({ onNavigate, darkMode, onToggleDark, colorTheme, onCycleTheme }) {
  const { currentTrips, pastTrips, trips, createTrip, updateTrip, deleteTrip, addToReserve, addToDay } = useTripsContext();
  const [showNew, setShowNew] = useState(false);
  const [editingTrip, setEditingTrip] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const handleCreate = (data) => {
    const id = createTrip(data);
    setShowNew(false);
    onNavigate('trip', id);
  };

  const handleEdit = (data) => {
    updateTrip(editingTrip.id, data);
    setEditingTrip(null);
  };

  const deletingTrip = [...currentTrips, ...pastTrips].find(t => t.id === deletingId);

  return (
    <div className="dashboard">
      <div className="dashboard__logo">
        <span className="dashboard__logo-icon">🧭</span>
        <span className="dashboard__logo-text">Provo</span>
        <div className="dashboard__logo-actions">
          {onCycleTheme && (
            <button className="btn btn--ghost-white btn--sm" onClick={onCycleTheme} title={`Thème : ${colorTheme?.label || 'Soleil'}`}>
              {colorTheme?.emoji || '🟠'}
            </button>
          )}
          <button className="btn btn--ghost-white btn--sm" onClick={onToggleDark} title={darkMode ? 'Mode clair' : 'Mode sombre'}>
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
      <p className="dashboard__logo-sub">Ton gestionnaire de voyages hors-ligne</p>

      <div className="dashboard__body">
        <div className="dashboard__section">
          <div className="dashboard__section-title">En cours & à venir</div>
          {currentTrips.length === 0
            ? (
              <div className="dashboard__empty">
                <div className="dashboard__empty-icon">🌍</div>
                <p>Aucun voyage planifié.<br />Crée ton premier voyage !</p>
              </div>
            )
            : currentTrips.map(trip => (
              <TripCard key={trip.id} trip={trip}
                onClick={() => onNavigate('trip', trip.id)}
                onEdit={() => setEditingTrip(trip)}
                onDelete={() => setDeletingId(trip.id)}
              />
            ))
          }
        </div>

        {pastTrips.length > 0 && (
          <div className="dashboard__section">
            <div className="dashboard__section-title">Historique</div>
            <div className="timeline">
              {pastTrips.map(trip => (
                <div className="timeline-item" key={trip.id}>
                  <div className="timeline-item__line">
                    <div className="timeline-item__dot" />
                    <div className="timeline-item__bar" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: '2px' }}>
                    <TripCard trip={trip}
                      onClick={() => onNavigate('trip', trip.id)}
                      onEdit={() => setEditingTrip(trip)}
                      onDelete={() => setDeletingId(trip.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="fab">
        <button className="fab__btn" onClick={() => setShowNew(true)}>
          ✈️ Nouveau voyage
        </button>
      </div>

      {showNew && <NewTripModal onClose={() => setShowNew(false)} onCreate={handleCreate} />}
      {editingTrip && <NewTripModal editTrip={editingTrip} onClose={() => setEditingTrip(null)} onCreate={handleEdit} />}

      {deletingTrip && (
        <ConfirmDialog
          icon="🗑️"
          title="Supprimer ce voyage ?"
          message={`"${deletingTrip.name}" et toutes ses activités seront supprimés.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={() => { deleteTrip(deletingId); setDeletingId(null); }}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  );
}
