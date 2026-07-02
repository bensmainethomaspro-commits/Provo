import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || password.length < 6) {
      setError('Email et mot de passe (6 caractères min.) requis.');
      return;
    }
    setLoading(true);
    const fn = mode === 'login'
      ? supabase.auth.signInWithPassword({ email: email.trim(), password })
      : supabase.auth.signUp({ email: email.trim(), password });
    const { error: err } = await fn;
    setLoading(false);
    if (err) {
      setError(
        /invalid/i.test(err.message)
          ? 'Email ou mot de passe incorrect.'
          : err.message,
      );
    } else if (mode === 'signup') {
      setSignupDone(true);
    }
  };

  if (signupDone) {
    return (
      <div className="screen-center">
        <div className="auth-card">
          <h2>📬 Vérifie tes emails</h2>
          <p>Un lien de confirmation a été envoyé à <strong>{email}</strong>.</p>
          <button className="btn btn-primary" onClick={() => { setMode('login'); setSignupDone(false); }}>
            J'ai confirmé → me connecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-center">
      <div className="auth-card">
        <div className="auth-logo">🔎</div>
        <h1>JobWatch</h1>
        <p className="auth-tagline">
          Veille de postes HRBP & L&D — digest chaque matin.
          <br />
          <span className="muted">Même compte que Provo.</span>
        </p>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Se connecter
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Créer un compte
          </button>
        </div>
        <form onSubmit={submit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>
      </div>
    </div>
  );
}
