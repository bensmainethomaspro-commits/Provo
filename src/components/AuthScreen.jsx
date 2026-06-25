import { useState } from 'react';

export default function AuthScreen({ onSignIn, onSignUp, onSkip }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) { setError('Remplis tous les champs.'); return; }
    if (mode === 'signup' && !name.trim()) { setError('Ton prénom ?'); return; }
    if (password.length < 6) { setError('Mot de passe trop court (min. 6 caractères).'); return; }

    setLoading(true);
    const result = mode === 'login'
      ? await onSignIn(email.trim(), password)
      : await onSignUp(email.trim(), password, name.trim());
    setLoading(false);

    if (result?.error) {
      const msg = result.error;
      if (msg.includes('Invalid login')) setError('Email ou mot de passe incorrect.');
      else if (msg.includes('already registered')) setError('Cet email est déjà utilisé. Connecte-toi !');
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
          <button className="btn btn--secondary auth-btn" onClick={() => setMode('login') || setDone(false)}>
            J'ai confirmé → Se connecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">🧭</div>
        <h1 className="auth-app-name">Provo</h1>
        <p className="auth-tagline">Planifiez. Partagez. Voyagez.</p>

        <div className="auth-tabs">
          <button className={`auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>
            Se connecter
          </button>
          <button className={`auth-tab${mode === 'signup' ? ' active' : ''}`} onClick={() => { setMode('signup'); setError(''); }}>
            Créer un compte
          </button>
        </div>

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
          <input
            className="form-input auth-input"
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn--primary auth-btn" disabled={loading}>
            {loading ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>

        <button className="auth-skip" onClick={onSkip}>
          Continuer sans compte →
        </button>
        <p className="auth-skip-note">Sans compte, tes voyages restent sur cet appareil uniquement.</p>
      </div>
    </div>
  );
}
