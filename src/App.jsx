import { useState, useEffect } from 'react';
import { TripsProvider, useTripsContext } from './context/TripsContext';
import Dashboard from './pages/Dashboard';
import TripView from './pages/TripView';
import { decodeTrip, getSkyGradient } from './utils/helpers';

const THEMES = [
  { id: 'default', label: 'Soleil',      emoji: '🟠',
    lightBg: null, // time-based sky
    darkBg:  'linear-gradient(160deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)' },
  { id: 'ocean',   label: 'Océan',       emoji: '🔵',
    lightBg: 'linear-gradient(160deg, #0ea5e9 0%, #0284c7 55%, #0c4a6e 100%)',
    darkBg:  'linear-gradient(160deg, #0b1929 0%, #0a1f3a 50%, #071e30 100%)' },
  { id: 'nature',  label: 'Nature',      emoji: '🟢',
    lightBg: 'linear-gradient(160deg, #16a34a 0%, #15803d 50%, #14532d 100%)',
    darkBg:  'linear-gradient(160deg, #0a1f10 0%, #0d2a14 50%, #081c0a 100%)' },
  { id: 'sunset',  label: 'Crépuscule',  emoji: '🟣',
    lightBg: 'linear-gradient(160deg, #9333ea 0%, #7c3aed 45%, #4c1d95 100%)',
    darkBg:  'linear-gradient(160deg, #1a0b2e 0%, #1e1038 50%, #150a28 100%)' },
  { id: 'caramel', label: 'Caramel',     emoji: '🟤',
    lightBg: 'linear-gradient(160deg, #d97706 0%, #b45309 50%, #78350f 100%)',
    darkBg:  'linear-gradient(160deg, #1c0d00 0%, #2e1600 50%, #1e0e00 100%)' },
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

  // Apply background gradient (theme + dark mode + time-based for default)
  useEffect(() => {
    function applyBackground() {
      const bg = darkMode
        ? colorTheme.darkBg
        : (colorTheme.lightBg || getSkyGradient());
      document.body.style.background = bg;
      document.body.style.backgroundAttachment = 'fixed';
    }
    applyBackground();
    // Refresh time-based gradient every minute (only needed for default light theme)
    const timer = !darkMode && !colorTheme.lightBg ? setInterval(applyBackground, 60000) : null;
    return () => { if (timer) clearInterval(timer); };
  }, [darkMode, colorTheme]);

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
