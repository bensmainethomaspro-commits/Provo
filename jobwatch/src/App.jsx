import { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { DEFAULT_COMPANIES } from './lib/defaults';
import AuthScreen from './components/AuthScreen';
import JobList from './components/JobList';
import SettingsTab from './components/SettingsTab';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = chargement
  const [tab, setTab] = useState('offres');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Premier lancement : crée le profil de recherche et les entreprises
  // cibles par défaut pour cet utilisateur.
  useEffect(() => {
    if (!session?.user) return;
    (async () => {
      const { data: existing } = await supabase
        .from('jobwatch_settings')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!existing) {
        await supabase.from('jobwatch_settings').insert({
          user_id: session.user.id,
          email: session.user.email,
        });
        await supabase.from('jobwatch_companies').insert(
          DEFAULT_COMPANIES.map((c) => ({ ...c, user_id: session.user.id })),
        );
      }
    })();
  }, [session]);

  const showNotice = useCallback((text, kind = 'info') => {
    setNotice({ text, kind });
    setTimeout(() => setNotice(null), 6000);
  }, []);

  const refreshJobs = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobwatch-fetch', { body: {} });
      if (error) throw error;
      const failed = (data?.reports || []).filter((r) => !r.ok);
      showNotice(
        `${data?.new_jobs ?? 0} nouvelle(s) offre(s), ${data?.new_matches ?? 0} correspondance(s)` +
          (failed.length ? ` — ${failed.length} source(s) en erreur (voir Réglages)` : ''),
        failed.length ? 'warn' : 'ok',
      );
      setReloadKey((k) => k + 1);
    } catch (e) {
      showNotice(`Échec de l'actualisation : ${e.message || e}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }, [showNotice]);

  if (session === undefined) {
    return <div className="screen-center">Chargement…</div>;
  }
  if (!session) {
    return <AuthScreen />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <span className="logo">🔎</span>
          <div>
            <h1>JobWatch</h1>
            <p>Veille HRBP · L&D · Paris</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={refreshJobs} disabled={refreshing}>
            {refreshing ? 'Collecte…' : '↻ Actualiser'}
          </button>
          <button
            className="btn btn-ghost"
            title="Se déconnecter"
            onClick={() => supabase.auth.signOut()}
          >
            ⎋
          </button>
        </div>
      </header>

      {notice && <div className={`notice notice-${notice.kind}`}>{notice.text}</div>}

      <nav className="tabs">
        <button className={tab === 'offres' ? 'active' : ''} onClick={() => setTab('offres')}>
          Offres
        </button>
        <button className={tab === 'reglages' ? 'active' : ''} onClick={() => setTab('reglages')}>
          Réglages
        </button>
      </nav>

      <main className="content">
        {tab === 'offres' && <JobList userId={session.user.id} reloadKey={reloadKey} />}
        {tab === 'reglages' && <SettingsTab userId={session.user.id} showNotice={showNotice} />}
      </main>
    </div>
  );
}
