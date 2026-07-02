import { useState, useEffect } from 'react';
import { TripsProvider, useTripsContext } from './context/TripsContext';
import Dashboard from './pages/Dashboard';
import TripView from './pages/TripView';
import AuthScreen from './components/AuthScreen';
import { decodeTrip, getSkyGradient } from './utils/helpers';
import { useSettings } from './hooks/useSettings';
import OnboardingOverlay from './components/OnboardingOverlay';
import ErrorBoundary from './components/ErrorBoundary';

function AppInner() {
  const { importTrip, loadSharedTrip, signIn, signUp, signOut, resetPassword, userId, authLoading, joinTripByInvite } = useTripsContext();
  const { settings, setSetting } = useSettings();
  const [showAuth, setShowAuth] = useState(false);
  const [route, setRoute] = useState({ page: 'dashboard', tripId: null });
  const [pendingImport, setPendingImport] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [autoNewTrip] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('action') === 'new') {
      window.history.replaceState(null, '', window.location.pathname);
      return true;
    }
    return false;
  });
  const [pendingShareId] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get('share');
    if (s) { window.history.replaceState(null, '', window.location.pathname); return s; }
    return null;
  });
  const [pendingInvite] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const inv = p.get('invite');
    if (inv) { window.history.replaceState(null, '', window.location.pathname); return inv; }
    return null;
  });
  const [inviteError, setInviteError] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('provo_theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    function applyBackground() {
      if (!darkMode) {
        document.body.style.background = getSkyGradient();
        document.body.style.backgroundAttachment = 'fixed';
      } else {
        document.body.style.background = 'linear-gradient(160deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)';
        document.body.style.backgroundAttachment = 'fixed';
      }
    }
    applyBackground();
    const timer = setInterval(applyBackground, 60000);
    return () => clearInterval(timer);
  }, [darkMode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('provo_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#share=')) {
      try {
        const trip = decodeTrip(hash.slice(7));
        setPendingImport(trip);
        window.history.replaceState(null, '', window.location.pathname);
      } catch { /* invalid */ }
    }
  }, []);

  useEffect(() => {
    if (!pendingShareId) return;
    loadSharedTrip(pendingShareId)
      .then(tripId => navigate('trip', tripId))
      .catch(() => alert('Voyage introuvable ou lien expiré.'));
  }, []);

  // Gérer le lien d'invitation collaboration
  useEffect(() => {
    if (!pendingInvite || authLoading) return;
    if (!userId) { setShowAuth(true); return; }
    joinTripByInvite(pendingInvite).then(result => {
      if (result?.error) setInviteError(result.error);
      else if (result?.tripId) navigate('trip', result.tripId);
    });
  }, [pendingInvite, userId, authLoading]);

  const navigate = (page, tripId = null) => setRoute({ page, tripId });

  const handleImport = () => {
    const id = importTrip(pendingImport);
    setPendingImport(null);
    navigate('trip', id);
  };

  if (showAuth) {
    return (
      <AuthScreen
        onSignIn={async (email, pw) => { const r = await signIn(email, pw); if (!r?.error) setShowAuth(false); return r; }}
        onSignUp={signUp}
        onResetPassword={resetPassword}
        onSkip={() => setShowAuth(false)}
      />
    );
  }

  return (
    <div className="app">
      {!settings.onboardingDone && (
        <OnboardingOverlay onDone={() => setSetting('onboardingDone', true)} />
      )}
      {inviteError && (
        <div className="offline-banner" style={{ background: 'var(--red)' }}>
          ❌ {inviteError} <button onClick={() => setInviteError('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✕</button>
        </div>
      )}
      {!isOnline && (
        <div className="offline-banner">📡 Hors ligne — données sauvegardées localement</div>
      )}
      {pendingImport && (
        <div className="import-banner">
          <span>🌍 Voyage partagé : <strong>{pendingImport.name}</strong></span>
          <div className="import-banner__actions">
            <button className="btn btn--white btn--sm" onClick={handleImport}>Importer</button>
            <button className="btn btn--ghost-white btn--sm" onClick={() => setPendingImport(null)}>Ignorer</button>
          </div>
        </div>
      )}
      {route.page === 'dashboard'
        ? <Dashboard onNavigate={navigate} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} autoNewTrip={autoNewTrip} onShowAuth={() => setShowAuth(true)} />
        : <TripView tripId={route.tripId} onBack={() => navigate('dashboard')} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
      }
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TripsProvider>
        <AppInner />
      </TripsProvider>
    </ErrorBoundary>
  );
}
