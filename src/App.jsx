import { useState, useEffect } from 'react';
import { TripsProvider, useTripsContext } from './context/TripsContext';
import Dashboard from './pages/Dashboard';
import TripView from './pages/TripView';
import AuthScreen from './components/AuthScreen';
import { decodeTrip, premierLien, ressembleAUneLegende, texteDecode } from './utils/helpers';
import { useSettings } from './hooks/useSettings';
import OnboardingOverlay from './components/OnboardingOverlay';
import ErrorBoundary from './components/ErrorBoundary';

function AppInner() {
  const { importTrip, loadSharedTrip, signIn, signUp, signOut, resetPassword, userId, authLoading, joinTripByInvite, currentTrips, stockagePlein } = useTripsContext();
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
  // Un lien arrivé du menu Partager (Android), d'un raccourci iOS, ou d'un
  // `?ajout=` collé. Les apps ne le rangent pas au même endroit : Instagram et
  // TikTok le noient dans le texte, Safari le met dans `url`.
  const [lienPartage, setLienPartage] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const l = premierLien(p.get('ajout'), p.get('lien'), p.get('texte'), p.get('titre'));
    // iOS n'expose pas les sites installés au menu Partager, et aucune requête
    // faite depuis un onglet n'obtient la page d'un réseau social. Un raccourci
    // iOS, lui, tourne en natif : il va chercher la page depuis le téléphone et
    // nous passe la LÉGENDE entière dans `texte`. Ne pêcher qu'un lien dedans
    // reviendrait à jeter la seule chose utile qu'il nous transmet.
    // Décodé ici, à la frontière : le raccourci rend le texte tel qu'il est
    // écrit dans le bloc de données de la page, échappements compris.
    const t = texteDecode(p.get('texte') || '').trim();
    const valeur = l || (ressembleAUneLegende(t) ? t : null);
    if (valeur) { window.history.replaceState(null, '', window.location.pathname); return valeur; }
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
        // Jour : fond bleu très clair et aéré (fini le dégradé orange plein cadre).
        // Le bleu reste un accent, pas un mur — inspiration apps Apple/App Store.
        document.body.style.background = 'linear-gradient(180deg, #E6F2FB 0%, #EFF5FA 42%, #F2F6FA 100%)';
        document.body.style.backgroundAttachment = 'fixed';
      } else {
        // Nuit bleutée, cohérente avec la marque bleu clair.
        document.body.style.background = 'linear-gradient(165deg, #08111A 0%, #0D1B26 45%, #122634 100%)';
        document.body.style.backgroundAttachment = 'fixed';
      }
    }
    applyBackground();
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

  const voyagesOuverts = (currentTrips || []);

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
      {/* La pire panne possible : l'écriture locale échoue, et tout ce qui n'est
          pas encore parti chez Supabase disparaîtra au rechargement. Elle était
          silencieuse — un message dans une console que personne n'ouvre sur un
          téléphone. Elle se dit maintenant, en rouge, avec quoi faire. */}
      {stockagePlein && (
        <div className="offline-banner" style={{ background: 'var(--red-deep)' }}>
          ⚠️ Mémoire pleine — retire des photos ou des billets, sinon les
          modifications ne seront pas gardées.
        </div>
      )}
      {/* Un lien partagé ne doit pas téléporter : on annonce ce qu'on a reçu et
          on laisse choisir. Avec un seul voyage en cours, le choix se réduit à
          un bouton ; avec plusieurs, on désigne le voyage soi-même. */}
      {lienPartage && route.page === 'dashboard' && (
        <div className="import-banner">
          <span>🔗 Lien reçu{voyagesOuverts.length === 1 ? <> — l'ajouter à <strong>{voyagesOuverts[0].name}</strong> ?</> : ' — ouvre le voyage où le ranger.'}</span>
          <div className="import-banner__actions">
            {voyagesOuverts.length === 1 && (
              <button className="btn btn--white btn--sm" onClick={() => navigate('trip', voyagesOuverts[0].id)}>
                Ajouter
              </button>
            )}
            <button className="btn btn--ghost-white btn--sm" onClick={() => setLienPartage(null)}>Ignorer</button>
          </div>
        </div>
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
        : <TripView tripId={route.tripId} onBack={() => navigate('dashboard')} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)}
            lienAImporter={lienPartage} onLienConsomme={() => setLienPartage(null)} />
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
