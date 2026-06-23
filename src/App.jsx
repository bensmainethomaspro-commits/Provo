import { useState, useEffect } from 'react';
import { TripsProvider, useTripsContext } from './context/TripsContext';
import Dashboard from './pages/Dashboard';
import TripView from './pages/TripView';
import { decodeTrip, getSkyGradient } from './utils/helpers';

const THEMES = [
  { id: 'default', label: 'Soleil',      emoji: '🟠' },
  { id: 'ocean',   label: 'Océan',       emoji: '🔵' },
  { id: 'nature',  label: 'Nature',      emoji: '🟢' },
  { id: 'sunset',  label: 'Crépuscule',  emoji: '🟣' },
  { id: 'caramel', label: 'Caramel',     emoji: '🟤' },
];

function AppInner() {
  const { importTrip } = useTripsContext();
  const [route, setRoute] = useState({ page: 'dashboard', tripId: null });
  const [pendingImport, setPendingImport] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('provo_theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [colorThemeIdx, setColorThemeIdx] = useState(() => {
    const stored = localStorage.getItem('provo_color');
    const idx = THEMES.findIndex(t => t.id === stored);
    return idx >= 0 ? idx : 0;
  });
  const colorTheme = THEMES[colorThemeIdx];
  const cycleTheme = () => setColorThemeIdx(i => (i + 1) % THEMES.length);

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
    document.documentElement.setAttribute('data-color-theme', colorTheme.id);
    localStorage.setItem('provo_color', colorTheme.id);
  }, [colorTheme]);

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
        ? <Dashboard onNavigate={navigate} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} colorTheme={colorTheme} onCycleTheme={cycleTheme} />
        : <TripView tripId={route.tripId} onBack={() => navigate('dashboard')} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} colorTheme={colorTheme} onCycleTheme={cycleTheme} />
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
