import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const FILTERS = [
  { id: 'new', label: 'Nouvelles' },
  { id: 'saved', label: '★ Enregistrées' },
  { id: 'all', label: 'Toutes' },
];

const SOURCE_LABELS = {
  wttj: 'WTTJ',
  linkedin: 'LinkedIn',
  greenhouse: 'Carrières',
  lever: 'Carrières',
  recruitee: 'Carrières',
};

function scoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 50) return 'score-mid';
  return 'score-low';
}

function timeAgo(iso) {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "à l'instant";
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

export default function JobList({ userId, reloadKey }) {
  const [filter, setFilter] = useState('new');
  const [matches, setMatches] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query = supabase
        .from('jobwatch_matches')
        .select('id, score, status, breakdown, created_at, job:jobwatch_jobs(*)')
        .eq('user_id', userId)
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (filter === 'new') query = query.eq('status', 'new');
      else if (filter === 'saved') query = query.eq('status', 'saved');
      else query = query.neq('status', 'hidden');
      const { data } = await query;
      if (!cancelled) setMatches(data || []);
    })();
    return () => { cancelled = true; };
  }, [userId, filter, reloadKey]);

  const setStatus = async (matchId, status) => {
    setMatches((ms) => ms.map((m) => (m.id === matchId ? { ...m, status } : m)));
    await supabase.from('jobwatch_matches').update({ status }).eq('id', matchId);
  };

  const openJob = (m) => {
    if (m.status === 'new') setStatus(m.id, 'seen');
    window.open(m.job.url, '_blank', 'noopener');
  };

  if (matches === null) return <p className="muted">Chargement des offres…</p>;

  return (
    <div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`chip${filter === f.id ? ' active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {matches.length === 0 && (
        <div className="empty">
          <p>
            {filter === 'new'
              ? 'Aucune nouvelle offre. Lance « ↻ Actualiser » ou attends le prochain passage automatique.'
              : 'Rien ici pour le moment.'}
          </p>
        </div>
      )}

      <ul className="job-list">
        {matches.map((m) => (
          <li key={m.id} className={`job-card${m.status === 'hidden' ? ' is-hidden' : ''}`}>
            <div className={`score-badge ${scoreClass(m.score)}`}>{m.score}</div>
            <div className="job-body" onClick={() => openJob(m)}>
              <div className="job-title">{m.job.title}</div>
              <div className="job-meta">
                {m.job.company_name || 'Entreprise inconnue'}
                {m.job.location ? ` · ${m.job.location}` : ''}
                {m.job.contract_type ? ` · ${m.job.contract_type}` : ''}
              </div>
              <div className="job-sub">
                <span className="source-tag">{SOURCE_LABELS[m.job.source] || m.job.source}</span>
                {' '}{timeAgo(m.job.published_at || m.job.first_seen_at)}
                {m.breakdown?.matched?.length > 0 && (
                  <span className="matched"> · {m.breakdown.matched.slice(0, 4).join(' · ')}</span>
                )}
              </div>
            </div>
            <div className="job-actions">
              <button
                title={m.status === 'saved' ? 'Retirer des enregistrées' : 'Enregistrer'}
                onClick={() => setStatus(m.id, m.status === 'saved' ? 'seen' : 'saved')}
              >
                {m.status === 'saved' ? '★' : '☆'}
              </button>
              <button title="Masquer" onClick={() => setStatus(m.id, 'hidden')}>✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
