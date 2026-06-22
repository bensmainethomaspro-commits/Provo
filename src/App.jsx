import { useState, useEffect } from 'react';
import { TripsProvider, useTripsContext } from './context/TripsContext';
import Dashboard from './pages/Dashboard';
import TripView from './pages/TripView';
import { decodeTrip, getSkyGradient } from './utils/helpers';

function AppInner() {
  const { importTrip } = useTripsContext();
  const [route, setRoute] = useState({ page: 'dashboard', tripId: null });
  const [pendingImport, setPendingImport] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('provo_theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Apply sky gradient and dark mode
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
    const hash = window.location.hash;
    if (hash.startsWith('#share=')) {
      try {
        const trip = decodeTrip(hash.slice(7));
        setPendingImport(trip);
        window.history.replaceState(null, '', window.location.pathname);
      } catch { /* invalid */ }
    }
  }, []);

  const navigate = (page, tripId = null) => setRoute({ page, tripId });

  const handleImport = () => {
    const id = importTrip(pendingImport);
    setPendingImport(null);
    navigate('trip', id);
  };

  return (
    <div className="app">
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
        ? <Dashboard onNavigate={navigate} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
        : <TripView tripId={route.tripId} onBack={() => navigate('dashboard')} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
      }
    </div>
  );
}

export default function App() {
  return (
    <TripsProvider>
      <AppInner />
    </TripsProvider>
  );
}
