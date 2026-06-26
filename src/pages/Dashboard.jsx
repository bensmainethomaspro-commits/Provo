import { useState } from 'react';
import { useTripsContext } from '../context/TripsContext';
import TripCard from '../components/TripCard';
import TripPreviewSheet from '../components/TripPreviewSheet';
import NewTripModal from '../components/NewTripModal';
import ConfirmDialog from '../components/ConfirmDialog';
import AccountSheet from '../components/AccountSheet';
import { getCategoryMeta, formatDate } from '../utils/helpers';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function Dashboard({ onNavigate, darkMode, onToggleDark, autoNewTrip, onShowAuth }) {
  const { currentTrips, pastTrips, createTrip, updateTrip, deleteTrip, duplicateTrip, userId, signOut, userEmail, userProfile, updateProfile } = useTripsContext();
  const [showNew, setShowNew] = useState(autoNewTrip || false);
  const [editingTrip, setEditingTrip] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [previewTrip, setPreviewTrip] = useState(null);
  const [showAccount, setShowAccount] = useState(false);
  const [search, setSearch] = useState('');
  const { canInstall, install } = useInstallPrompt();

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
  const today = todayStr();
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const activeTrip = currentTrips.find(t => {
    const s = new Date(t.startDate + 'T00:00:00');
    const e = new Date(t.endDate + 'T00:00:00');
    return s <= todayDate && todayDate <= e;
  });
  const activeTodayDay = activeTrip?.days.find(d => d.date === today);
  const activeDayIdx = activeTrip ? Math.round((todayDate - new Date(activeTrip.startDate + 'T00:00:00')) / 86400000) : -1;

  const isEmpty = currentTrips.length === 0 && pastTrips.length === 0;

  const filterTrip = (trip) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      trip.name.toLowerCase().includes(q) ||
      (trip.destination || '').toLowerCase().includes(q) ||
      trip.days.some(d => d.activities.some(a =>
        a.title.toLowerCase().includes(q) ||
        (a.address || '').toLowerCase().includes(q) ||
        (a.notes || '').toLowerCase().includes(q)
      ))
    );
  };

  const filteredCurrent = currentTrips.filter(filterTrip);
  const filteredPast = pastTrips.filter(filterTrip);

  return (
    <div className="dashboard">
      <div className="dashboard__logo">
        <span className="dashboard__logo-icon">🧭</span>
        <span className="dashboard__logo-text">Provo</span>
        <div className="dashboard__logo-actions">
          <button className="btn btn--ghost-white btn--sm" onClick={onToggleDark} title={darkMode ? 'Mode clair' : 'Mode sombre'} aria-label={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          {canInstall && (
            <button className="btn btn--ghost-white btn--sm install-btn" onClick={install} title="Installer l'application">
              📲 Installer
            </button>
          )}
          {userId
            ? (
              <button
                className="btn btn--account-avatar"
                onClick={() => setShowAccount(true)}
                title="Mon compte"
                aria-label="Mon compte"
              >
                {userProfile?.emoji || '😀'}
              </button>
            )
            : <button className="btn btn--ghost-white btn--sm" onClick={onShowAuth} title="Se connecter">🔑 Connexion</button>
          }
        </div>
      </div>
      <p className="dashboard__logo-sub">{userId ? '☁️ Voyages synchronisés' : 'Ton gestionnaire de voyages'}</p>

      {!isEmpty && (
        <div className="dashboard__search">
          <input
            className="dashboard__search-input"
            placeholder="🔍 Rechercher un voyage ou une activité…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="dashboard__search-clear" onClick={() => setSearch('')} aria-label="Effacer la recherche">✕</button>}
        </div>
      )}

      <div className="dashboard__body">

        {/* ── AUJOURD'HUI ── */}
        {activeTrip && activeTodayDay && (
          <div className="today-hero" onClick={() => onNavigate('trip', activeTrip.id)}>
            <div className="today-hero__header">
              <div className="today-hero__meta">
                <span className="today-hero__tag">🟢 En voyage</span>
                <span className="today-hero__day">Jour {activeDayIdx + 1}/{activeTrip.days.length} · {formatDate(activeTodayDay.date)}</span>
              </div>
              <div className="today-hero__name">{activeTrip.emoji || '✈️'} {activeTrip.name}</div>
            </div>
            <div className="today-hero__activities">
              {activeTodayDay.activities.length === 0
                ? <span className="today-hero__empty">Aucune activité planifiée aujourd'hui</span>
                : activeTodayDay.activities.slice(0, 4).map(a => {
                    const meta = getCategoryMeta(a.category);
                    return (
                      <div key={a.id} className={`today-act today-act--${a.status}`}>
                        <span className="today-act__emoji">{meta.emoji}</span>
                        <span className="today-act__title">{a.title}</span>
                        {a.status === 'done' && <span className="today-act__done">✅</span>}
                        {a.status === 'nogo' && <span className="today-act__done">❌</span>}
                      </div>
                    );
                  })
              }
              {activeTodayDay.activities.length > 4 && (
                <div className="today-hero__more">+{activeTodayDay.activities.length - 4} autres →</div>
              )}
            </div>
          </div>
        )}

        {/* ── EN COURS & À VENIR ── */}
        <div className="dashboard__section">
          <div className="dashboard__section-title">En cours & à venir</div>
          {search && filteredCurrent.length === 0 && filteredPast.length === 0 && (
            <div className="dashboard__search-empty">Aucun résultat pour « {search} »</div>
          )}
          {filteredCurrent.length === 0 && !search
            ? isEmpty ? (
              <div className="dashboard__empty-hero">
                <div className="dashboard__empty-art">🌍 ✈️ 🗺️</div>
                <h2 className="dashboard__empty-title">Bienvenue sur Provo !</h2>
                <p className="dashboard__empty-text">Planifie tes voyages, gère le programme jour par jour, retrouve tout hors-ligne.</p>
                <p className="dashboard__empty-offline">📵 Fonctionne 100% sans connexion</p>
              </div>
            ) : (
              <div className="dashboard__empty">
                <div className="dashboard__empty-icon">🗓</div>
                <p>Aucun voyage à venir.<br />
                  <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={() => setShowNew(true)}>+ Nouveau voyage</button>
                </p>
              </div>
            )
            : filteredCurrent.map(trip => (
              <TripCard key={trip.id} trip={trip}
                onClick={() => onNavigate('trip', trip.id)}
                onEdit={() => setEditingTrip(trip)}
                onDelete={() => setDeletingId(trip.id)}
                onDuplicate={() => duplicateTrip(trip.id)}
                onPreview={() => setPreviewTrip(trip)}
              />
            ))
          }
        </div>

        {filteredPast.length > 0 && (
          <div className="dashboard__section">
            <div className="dashboard__section-title">Historique</div>
            <div className="timeline">
              {filteredPast.map(trip => (
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
                      onDuplicate={() => duplicateTrip(trip.id)}
                      onPreview={() => setPreviewTrip(trip)}
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

      {previewTrip && (
        <TripPreviewSheet
          trip={previewTrip}
          onClose={() => setPreviewTrip(null)}
          onOpen={() => { setPreviewTrip(null); onNavigate('trip', previewTrip.id); }}
        />
      )}

      {showAccount && (
        <AccountSheet
          onClose={() => setShowAccount(false)}
          userId={userId}
          userEmail={userEmail}
          userProfile={userProfile}
          onUpdateProfile={updateProfile}
          signOut={signOut}
          darkMode={darkMode}
          onToggleDark={onToggleDark}
          trips={[...currentTrips, ...pastTrips]}
        />
      )}
    </div>
  );
}
