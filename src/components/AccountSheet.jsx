import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { useNotifications } from '../hooks/useNotifications';

const PROFILE_EMOJIS = [
  '😀','😎','🤩','🧑','👩','👨','🧔','👦','👧',
  '🐶','🐱','🦊','🐻','🐼','🦁','🐯','🐺','🦅',
  '🌟','⚡','🔥','🌊','🌸','🎯','🚀','🌈','🎸',
];

export default function AccountSheet({ onClose, userId, userEmail, userProfile, onUpdateProfile, signOut, darkMode, onToggleDark, trips }) {
  const { settings, setSetting } = useSettings();
  const { canInstall, install } = useInstallPrompt();
  const notifs = useNotifications(userId);
  const [name, setName] = useState(userProfile?.name || '');
  const [emoji, setEmoji] = useState(userProfile?.emoji || '😀');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    setName(userProfile?.name || '');
    setEmoji(userProfile?.emoji || '😀');
  }, [userProfile?.name, userProfile?.emoji]);

  const handleSave = async () => {
    setSaving(true);
    await onUpdateProfile({ name: name.trim(), emoji });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = () => {
    const json = JSON.stringify(trips, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'provo_mes_voyages.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    onClose();
    await signOut();
  };

  return (
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet--account">
        <div className="sheet__header">
          <h2 className="sheet__title">👤 Mon compte</h2>
          <button aria-label="Fermer" className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <div className="sheet__body">

          {/* Avatar */}
          <div className="account-avatar-section">
            <button
              className="account-avatar"
              onClick={() => setShowEmojiPicker(v => !v)}
              title="Changer l'emoji"
              aria-label="Modifier l'emoji de profil"
            >
              {emoji}
              <span className="account-avatar__edit" aria-hidden="true">✏️</span>
            </button>
            <div className="account-name-preview">{name || userEmail?.split('@')[0] || 'Mon profil'}</div>
            {userEmail && <div className="account-email">{userEmail}</div>}
          </div>

          {showEmojiPicker && (
            <div className="account-emoji-pick">
              {PROFILE_EMOJIS.map(e => (
                <button
                  key={e}
                  className={`traveler-emoji-opt${emoji === e ? ' traveler-emoji-opt--active' : ''}`}
                  onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}
                >{e}</button>
              ))}
            </div>
          )}

          {/* Display name */}
          <div className="settings-section">
            <div className="settings-section__title">Nom d'affichage</div>
            <div className="settings-section__desc">Visible par les autres membres sur les voyages partagés.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="form-input"
                placeholder="Ex: Alice"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
              <button
                className="btn btn--primary btn--sm"
                style={{ flexShrink: 0 }}
                onClick={handleSave}
                disabled={saving || !name.trim()}
              >{saved ? '✅ Sauvegardé' : saving ? '…' : 'Sauvegarder'}</button>
            </div>
          </div>

          {/* Preferences */}
          <div className="settings-section">
            <div className="settings-section__title">Préférences</div>
            <label className="settings-toggle">
              <input type="checkbox" checked={darkMode} onChange={onToggleDark} />
              <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
              <span className="settings-toggle__label">{darkMode ? '🌙 Mode sombre' : '☀️ Mode clair'}</span>
            </label>
            <label className="settings-toggle" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={settings.haptics !== false} onChange={e => setSetting('haptics', e.target.checked)} />
              <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
              <span className="settings-toggle__label">Vibrations (haptics)</span>
            </label>
            {/* Troisième interrupteur de la même rangée : les rappels sont une
                préférence d'appareil, ils vivent avec le thème et les
                vibrations. Aucun écran ni entrée de menu de plus. */}
            {userId && (
              <>
                <label className="settings-toggle" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={notifs.actives}
                    disabled={!notifs.etat.possible || notifs.enCours}
                    onChange={e => (e.target.checked ? notifs.activer() : notifs.desactiver())}
                  />
                  <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
                  <span className="settings-toggle__label">
                    Rappels du voyage{notifs.enCours ? ' …' : ''}
                  </span>
                </label>
                {/* Une limite annoncée vaut mieux qu'un interrupteur mort. */}
                {!notifs.etat.possible && (
                  <p className="settings-section__desc" style={{ marginTop: 6 }}>
                    {notifs.etat.raison === 'ios_onglet'
                      ? "Sur iPhone, les rappels demandent que Provo soit sur l'écran d'accueil : Partager → « Sur l'écran d'accueil »."
                      : notifs.etat.raison === 'non_configure'
                        ? "Les rappels ne sont pas configurés sur ce déploiement."
                        : "Ce navigateur ne sait pas recevoir de notifications."}
                  </p>
                )}
                {notifs.message && (
                  <p className="settings-section__desc" style={{ marginTop: 6 }}>{notifs.message}</p>
                )}
              </>
            )}
          </div>

          {/* App */}
          <div className="settings-section">
            <div className="settings-section__title">Application</div>
            {canInstall && (
              <button className="btn btn--secondary btn--sm" style={{ marginBottom: 8, display: 'block', width: '100%' }} onClick={install}>
                📲 Installer l'application
              </button>
            )}
            <button className="btn btn--secondary btn--sm" style={{ display: 'block', width: '100%' }} onClick={handleExport} disabled={!trips?.length}>
              💾 Exporter mes voyages ({trips?.length || 0})
            </button>
          </div>

          {/* Logout */}
          <div className="settings-section">
            <button className="btn btn--danger btn--full" onClick={handleSignOut}>
              ↩ Se déconnecter
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
