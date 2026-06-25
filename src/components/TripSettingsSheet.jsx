import { useState, useCallback } from 'react';

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

const RECURRING_PRESETS = [
  { emoji: '🏨', title: 'Hôtel / Nuit', category: 'repos', durationHours: 8, durationMinutes: 0 },
  { emoji: '✈️', title: 'Avion', category: 'trajet', durationHours: 2, durationMinutes: 0 },
  { emoji: '🍳', title: 'Petit-déjeuner', category: 'resto', durationHours: 0, durationMinutes: 45 },
  { emoji: '🚗', title: 'Trajet du jour', category: 'trajet', durationHours: 1, durationMinutes: 0 },
];

export default function TripSettingsSheet({ trip, isOpen, onClose, onUpdateTrip, settings, setSetting, onAddDailyTemplate, onRemoveDailyTemplate, enableCollaboration, userId }) {
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('😀');
  const [inviteCode, setInviteCode] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const travelers = trip.tripTravelers || [];
  const dailyTemplates = trip.dailyTemplates || [];

  const handleEnableCollaboration = useCallback(async () => {
    if (!enableCollaboration) return;
    setInviteLoading(true);
    const code = await enableCollaboration(trip.id);
    setInviteLoading(false);
    if (code) setInviteCode(code);
  }, [enableCollaboration, trip.id]);

  const inviteLink = inviteCode ? `${window.location.origin}?invite=${inviteCode}` : null;

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback: share sheet */
    }
  };

  const handleShare = () => {
    if (!inviteLink) return;
    if (navigator.share) {
      navigator.share({ title: `Rejoins mon voyage "${trip.name}"`, url: inviteLink });
    } else {
      handleCopy();
    }
  };

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
  const handleTimezone = (v) => onUpdateTrip(trip.id, { timezoneOffset: v });

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

          {/* Timezone */}
          <div className="settings-section">
            <div className="settings-section__title">Fuseau horaire</div>
            <div className="settings-section__desc">Décalage par rapport à l'heure locale (ex. +2 pour Paris en été, +9 pour Tokyo).</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                className="form-select"
                value={trip.timezoneOffset ?? 0}
                onChange={e => handleTimezone(parseInt(e.target.value))}
              >
                {Array.from({ length: 27 }, (_, i) => i - 12).map(h => (
                  <option key={h} value={h}>{h >= 0 ? `UTC+${h}` : `UTC${h}`}</option>
                ))}
              </select>
              {trip.timezoneOffset != null && trip.timezoneOffset !== 0 && (
                <span className="timezone-badge">UTC{trip.timezoneOffset >= 0 ? '+' : ''}{trip.timezoneOffset}</span>
              )}
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

          {/* Recurring templates */}
          {onAddDailyTemplate && (
            <div className="settings-section">
              <div className="settings-section__title">Activités récurrentes</div>
              <div className="settings-section__desc">Ces activités sont ajoutées automatiquement à tous les jours du voyage.</div>
              {dailyTemplates.length > 0 && (
                <div className="travelers-list">
                  {dailyTemplates.map(t => (
                    <div key={t.id} className="traveler-chip">
                      <span className="traveler-chip__emoji">{t.emoji || '📌'}</span>
                      <span className="traveler-chip__name">{t.title}</span>
                      <button className="traveler-chip__remove" onClick={() => onRemoveDailyTemplate(trip.id, t.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="recurring-presets">
                {RECURRING_PRESETS.map(p => (
                  <button
                    key={p.title}
                    className="recurring-preset-btn"
                    disabled={dailyTemplates.some(t => t.title === p.title)}
                    onClick={() => onAddDailyTemplate(trip.id, p)}
                  >
                    {p.emoji} {p.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Accommodation address */}
          <div className="settings-section">
            <div className="settings-section__title">Adresse d'hébergement</div>
            <div className="settings-section__desc">Utilisée pour calculer les temps de trajet depuis/vers le logement.</div>
            <input
              className="form-input"
              placeholder="Ex: 5 rue de Rivoli, Paris"
              value={trip.accommodationAddress || ''}
              onChange={e => onUpdateTrip(trip.id, { accommodationAddress: e.target.value })}
            />
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

          {/* Collaboration */}
          {userId && (
            <div className="settings-section">
              <div className="settings-section__title">Collaboration</div>
              <div className="settings-section__desc">Invite des amis à voir et modifier ce voyage en temps réel.</div>
              {!inviteCode ? (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={handleEnableCollaboration}
                  disabled={inviteLoading}
                  style={{ marginTop: 8 }}
                >
                  {inviteLoading ? '…' : '🔗 Générer un lien d\'invitation'}
                </button>
              ) : (
                <div className="collab-invite">
                  <div className="collab-invite__link">{inviteLink}</div>
                  <div className="collab-invite__actions">
                    <button className="btn btn--primary btn--sm" onClick={handleShare}>
                      📤 Partager
                    </button>
                    <button className="btn btn--secondary btn--sm" onClick={handleCopy}>
                      {copied ? '✅ Copié !' : '📋 Copier'}
                    </button>
                  </div>
                  <p className="collab-invite__note">Ce lien permet à n'importe qui de rejoindre ce voyage. Partage-le uniquement avec des personnes de confiance.</p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
