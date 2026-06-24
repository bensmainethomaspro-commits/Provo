import { useState } from 'react';

const TRIP_COLORS = [
  { value: '#FF6B35', label: 'Orange' },
  { value: '#3b82f6', label: 'Bleu' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#22c55e', label: 'Vert' },
  { value: '#ef4444', label: 'Rouge' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#f59e0b', label: 'Ambre' },
  { value: '#ec4899', label: 'Rose' },
];

const TRAVELER_EMOJIS = ['😀','😎','🤩','🧑','👩','👨','🧔','👦','👧','🐶','🐱','🦊','🐻','🐼'];

export default function TripSettingsSheet({ trip, isOpen, onClose, onUpdateTrip, settings, setSetting }) {
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('😀');
  const travelers = trip.tripTravelers || [];

  if (!isOpen) return null;

  const handleAddTraveler = () => {
    if (!newName.trim()) return;
    const updated = [...travelers, { id: Date.now().toString(36), name: newName.trim(), emoji: newEmoji }];
    onUpdateTrip(trip.id, { tripTravelers: updated });
    setNewName('');
  };

  const handleRemoveTraveler = (id) => {
    onUpdateTrip(trip.id, { tripTravelers: travelers.filter(t => t.id !== id) });
  };

  const handleColor = (color) => onUpdateTrip(trip.id, { color });
  const handleRoadTrip = (v) => onUpdateTrip(trip.id, { roadTripMode: v });

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet--settings">
        <div className="sheet__header">
          <h2 className="sheet__title">⚙️ Paramètres du voyage</h2>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <div className="sheet__body">

          {/* Color */}
          <div className="settings-section">
            <div className="settings-section__title">Couleur du voyage</div>
            <div className="color-swatches">
              {TRIP_COLORS.map(c => (
                <button
                  key={c.value}
                  className={`color-swatch${(trip.color || '#FF6B35') === c.value ? ' color-swatch--active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => handleColor(c.value)}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* Road trip mode */}
          <div className="settings-section">
            <div className="settings-section__title">Mode Road Trip</div>
            <div className="settings-section__desc">Affiche un tracé de l'itinéraire sur la carte en reliant toutes les activités dans l'ordre.</div>
            <label className="settings-toggle">
              <input type="checkbox" checked={!!trip.roadTripMode} onChange={e => handleRoadTrip(e.target.checked)} />
              <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
              <span className="settings-toggle__label">{trip.roadTripMode ? 'Activé' : 'Désactivé'}</span>
            </label>
          </div>

          {/* Haptics */}
          <div className="settings-section">
            <div className="settings-section__title">Vibrations (haptics)</div>
            <div className="settings-section__desc">Retour haptique lors des actions importantes.</div>
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.haptics !== false} onChange={e => setSetting('haptics', e.target.checked)} />
              <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
              <span className="settings-toggle__label">{settings.haptics !== false ? 'Activées' : 'Désactivées'}</span>
            </label>
          </div>

          {/* Travelers */}
          <div className="settings-section">
            <div className="settings-section__title">Voyageurs</div>
            <div className="settings-section__desc">Ajoute les personnes du voyage pour assigner les activités et voir le budget par personne.</div>
            {travelers.length > 0 && (
              <div className="travelers-list">
                {travelers.map(t => (
                  <div key={t.id} className="traveler-chip">
                    <span className="traveler-chip__emoji">{t.emoji}</span>
                    <span className="traveler-chip__name">{t.name}</span>
                    <button className="traveler-chip__remove" onClick={() => handleRemoveTraveler(t.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="traveler-add-row">
              <div className="traveler-emoji-pick">
                {TRAVELER_EMOJIS.slice(0, 7).map(e => (
                  <button key={e} className={`traveler-emoji-opt${newEmoji === e ? ' traveler-emoji-opt--active' : ''}`} onClick={() => setNewEmoji(e)}>{e}</button>
                ))}
              </div>
              <div className="traveler-input-row">
                <input
                  className="form-input"
                  placeholder="Prénom du voyageur"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTraveler()}
                />
                <button className="btn btn--primary btn--sm" onClick={handleAddTraveler} disabled={!newName.trim()}>
                  + Ajouter
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
