import { useState } from 'react';
import RefreshButton from './RefreshButton';

export default function AuthScreen({ onSignIn, onSignUp, onResetPassword, onSkip }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'reset') {
      if (!email.trim()) { setError('Entre ton adresse email.'); return; }
      setLoading(true);
      const result = await onResetPassword(email.trim());
      setLoading(false);
      if (result?.error) {
        setError('Impossible d\'envoyer l\'email. Vérifie l\'adresse saisie.');
      } else {
        setResetSent(true);
      }
      return;
    }

    if (!email.trim() || !password.trim()) { setError('Remplis tous les champs.'); return; }
    if (mode === 'signup' && !name.trim()) { setError('Ton prénom ?'); return; }
    if (password.length < 6) { setError('Mot de passe trop court (min. 6 caractères).'); return; }

    setLoading(true);
    const result = mode === 'login'
      ? await onSignIn(email.trim(), password)
      : await onSignUp(email.trim(), password, name.trim());
    setLoading(false);

    if (result?.error) {
      const msg = typeof result.error === 'string' ? result.error : 'Une erreur est survenue. Réessaie.';
      if (msg.includes('Invalid login') || msg.includes('invalid_credentials')) setError('Email ou mot de passe incorrect.');
      else if (msg.includes('already registered') || msg.includes('already_registered')) setError('Cet email est déjà utilisé. Connecte-toi !');
      else if (msg.includes('Database error')) setError('Erreur serveur. Réessaie dans quelques secondes.');
      else setError(msg);
    } else if (mode === 'signup') {
      setDone(true);
    }
  };

  if (done) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-confirm-icon">📬</div>
          <h2 className="auth-title">Vérifie tes emails</h2>
          <p className="auth-subtitle">Un lien de confirmation t'a été envoyé à <strong>{email}</strong>. Clique dessus pour activer ton compte.</p>
          <button className="btn btn--secondary auth-btn" onClick={() => { setMode('login'); setDone(false); }}>
            J'ai confirmé → Se connecter
          </button>
        </div>
      </div>
    );
  }

  if (resetSent) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-confirm-icon">📩</div>
          <h2 className="auth-title">Email envoyé !</h2>
          <p className="auth-subtitle">Un lien de réinitialisation a été envoyé à <strong>{email}</strong>. Vérifie ta boîte mail (et tes spams).</p>
          <button className="btn btn--secondary auth-btn" onClick={() => { setMode('login'); setResetSent(false); }}>
            ← Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', right: 12, zIndex: 5 }}>
        <RefreshButton />
      </div>
      <div className="auth-card">
        <div className="auth-logo">🧭</div>
        <h1 className="auth-app-name">Provo</h1>
        <p className="auth-tagline">Planifiez. Partagez. Voyagez.</p>

        {mode !== 'reset' && (
          <div className="auth-tabs">
            <button className={`auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>
              Se connecter
            </button>
            <button className={`auth-tab${mode === 'signup' ? ' active' : ''}`} onClick={() => { setMode('signup'); setError(''); }}>
              Créer un compte
            </button>
          </div>
        )}

        {mode === 'reset' && (
          <div className="auth-reset-header">
            <button className="auth-back-btn" onClick={() => { setMode('login'); setError(''); }}>← Retour</button>
            <p className="auth-reset-desc">Entre ton adresse email pour recevoir un lien de réinitialisation de mot de passe.</p>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <input
              className="form-input auth-input"
              placeholder="Ton prénom"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="given-name"
            />
          )}
          <input
            className="form-input auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
          {mode !== 'reset' && (
            <input
              className="form-input auth-input"
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          )}
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn--primary auth-btn" disabled={loading}>
            {loading ? '…' : mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : 'Envoyer le lien'}
          </button>
        </form>

        {mode === 'login' && (
          <button className="auth-forgot" onClick={() => { setMode('reset'); setError(''); }}>
            Mot de passe oublié ?
          </button>
        )}

        {mode !== 'reset' && (
          <>
            <button className="auth-skip" onClick={onSkip}>
              Continuer sans compte →
            </button>
            <p className="auth-skip-note">Sans compte, tes voyages restent sur cet appareil uniquement.</p>
          </>
        )}
      </div>
    </div>
  );
}
