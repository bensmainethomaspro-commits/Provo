import { useState } from 'react';
import { useTripsContext } from '../context/TripsContext';
import TripCard from '../components/TripCard';
import NewTripModal from '../components/NewTripModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatDateShort } from '../utils/helpers';

export default function Dashboard({ onNavigate }) {
  const { currentTrips, pastTrips, createTrip, deleteTrip } = useTripsContext();
  const [showNew, setShowNew] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const handleCreate = (data) => {
    const id = createTrip(data);
    setShowNew(false);
    onNavigate('trip', id);
  };

  const deletingTrip = [...currentTrips, ...pastTrips].find(t => t.id === deletingId);

  return (
    <div className="dashboard">
      <div className="dashboard__logo">
        <span className="dashboard__logo-icon">🧭</span>
        <span className="dashboard__logo-text">Provo</span>
      </div>
      <p className="dashboard__logo-sub">Ton gestionnaire de voyages hors-ligne</p>

      <div className="dashboard__body">
        <div className="dashboard__section">
          <div className="dashboard__section-title">Voyages en cours & à venir</div>
          {currentTrips.length === 0
            ? (
              <div className="dashboard__empty">
                <div className="dashboard__empty-icon">🌍</div>
                <p>Aucun voyage planifié.<br />Crée ton premier voyage !</p>
              </div>
            )
            : currentTrips.map(trip => (
              <TripCard key={trip.id} trip={trip} onClick={() => onNavigate('trip', trip.id)} />
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
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: '4px' }}>
                    <TripCard trip={trip} onClick={() => onNavigate('trip', trip.id)} />
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

      {deletingTrip && (
        <ConfirmDialog
          icon="🗑️"
          title="Supprimer ce voyage ?"
          message={`"${deletingTrip.name}" et toutes ses activités seront supprimés définitivement.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={() => { deleteTrip(deletingId); setDeletingId(null); }}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  );
}
