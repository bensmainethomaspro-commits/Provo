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
            {/* Les rappels sont une préférence d'appareil : ils vivent avec le
                thème et les vibrations. Aucun écran ni entrée de menu de plus.

                Deux choses ont été enlevées ici, parce qu'elles produisaient
                toutes deux « ça ne marche pas » sans rien dire :

                1. La rangée était masquée quand personne n'était connecté. On
                   ne voyait donc RIEN — ni interrupteur, ni raison.
                2. C'était une case à cocher dans un `<label>`. Sur iOS, la
                   demande de permission doit partir d'un geste utilisateur, et
                   l'événement `change` synthétisé par un label perd parfois
                   cette attribution : on tape, la boîte système n'apparaît
                   jamais. Un vrai `<button>` ne laisse pas ce doute. */}
            {notifs.etat.possible ? (
              <button
                type="button"
                role="switch"
                aria-checked={notifs.actives}
                className={`settings-switch${notifs.actives ? ' settings-switch--on' : ''}`}
                disabled={notifs.enCours}
                onClick={() => (notifs.actives ? notifs.desactiver() : notifs.activer())}
              >
                <span className="settings-switch__label">
                  🔔 Rappels du voyage{notifs.enCours ? ' …' : ''}
                </span>
                <span className="settings-toggle__track" aria-hidden="true">
                  <span className="settings-toggle__thumb" />
                </span>
              </button>
            ) : (
              <div className="settings-note" style={{ marginTop: 10 }}>
                <span className="settings-note__titre">🔔 Rappels du voyage</span>
                <span className="settings-note__texte">
                  {notifs.etat.raison === 'ios_onglet'
                    ? "Indisponibles dans un onglet Safari — c'est une limite d'iOS, pas un réglage. Pour les activer : bouton Partager, puis « Sur l'écran d'accueil ». Rouvre Provo depuis l'icône, et l'interrupteur sera là."
                    : notifs.etat.raison === 'non_configure'
                      ? "Pas encore configurés sur ce déploiement."
                      : "Ce navigateur ne sait pas recevoir de notifications."}
                </span>
              </div>
            )}
            {notifs.message && (
              <p className="settings-section__desc" style={{ marginTop: 6 }}>{notifs.message}</p>
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
