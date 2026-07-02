import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { atsTestUrl, SOURCE_TYPE_LABELS } from '../lib/defaults';

// Les listes (mots-clés, villes…) s'éditent en textarea, une valeur par ligne.
const toText = (arr) => (arr || []).join('\n');
const toArray = (text) =>
  text.split('\n').map((s) => s.trim()).filter(Boolean);

const LIST_FIELDS = [
  { key: 'title_keywords', label: 'Intitulés de poste recherchés', hint: 'Un fort poids si présent dans le titre de l\'offre.' },
  { key: 'search_queries', label: 'Requêtes de recherche (WTTJ + LinkedIn)', hint: 'Chaque ligne = une recherche lancée sur les plateformes.' },
  { key: 'locations', label: 'Localisations acceptées', hint: 'Paris, Île-de-France, Remote…' },
  { key: 'contract_types', label: 'Types de contrat', hint: 'CDI, Alternance, Apprentissage…' },
  { key: 'bonus_keywords', label: 'Mots-clés bonus (descriptif)', hint: '+5 pts par mot-clé trouvé, max 15.' },
];

export default function SettingsTab({ userId, showNotice }) {
  const [settings, setSettings] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: '', source_type: 'greenhouse', slug: '', careers_url: '' });

  const loadAll = async () => {
    const [{ data: s }, { data: cs }] = await Promise.all([
      supabase.from('jobwatch_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('jobwatch_companies').select('*').eq('user_id', userId).order('name'),
    ]);
    setSettings(s);
    setCompanies(cs || []);
  };

  useEffect(() => { loadAll(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSettings = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('jobwatch_settings')
      .update({ ...settings, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    setSaving(false);
    showNotice(error ? `Erreur : ${error.message}` : 'Réglages enregistrés ✓', error ? 'error' : 'ok');
  };

  const addCompany = async () => {
    if (!newCompany.name.trim()) return;
    const row = {
      user_id: userId,
      name: newCompany.name.trim(),
      source_type: newCompany.source_type,
      slug: newCompany.slug.trim() || null,
      careers_url: newCompany.careers_url.trim() || null,
    };
    const { error } = await supabase.from('jobwatch_companies').insert(row);
    if (error) showNotice(`Erreur : ${error.message}`, 'error');
    else {
      setNewCompany({ name: '', source_type: 'greenhouse', slug: '', careers_url: '' });
      loadAll();
    }
  };

  const updateCompany = async (id, patch) => {
    await supabase.from('jobwatch_companies').update(patch).eq('id', id);
    loadAll();
  };

  const removeCompany = async (id) => {
    await supabase.from('jobwatch_companies').delete().eq('id', id);
    loadAll();
  };

  // Vérifie depuis le navigateur que l'API ATS répond pour ce slug.
  const testCompany = async (c) => {
    const url = atsTestUrl(c);
    if (!url) {
      showNotice('Type « lien manuel » ou WTTJ : rien à tester ici.', 'info');
      return;
    }
    try {
      const res = await fetch(url);
      showNotice(
        res.ok
          ? `${c.name} : API accessible ✓`
          : `${c.name} : HTTP ${res.status} — slug ou type d'ATS à corriger.`,
        res.ok ? 'ok' : 'warn',
      );
    } catch {
      showNotice(`${c.name} : test impossible depuis le navigateur (CORS). Le statut sera visible après la prochaine collecte.`, 'info');
    }
  };

  const digest = async (preview) => {
    setDigestBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobwatch-digest', {
        body: { preview },
      });
      if (error) throw error;
      if (preview) {
        if (data?.html) {
          const w = window.open('', '_blank');
          w.document.write(data.html);
          w.document.close();
        } else {
          showNotice('Aucune offre à prévisualiser pour le moment.', 'info');
        }
      } else {
        const r = data?.results?.find((x) => x.user === userId) || data?.results?.[0];
        showNotice(
          r?.sent ? `Digest envoyé (${r.count} offre(s)) ✓` : `Digest non envoyé : ${r?.reason || '?'}`,
          r?.sent ? 'ok' : 'warn',
        );
      }
    } catch (e) {
      showNotice(`Erreur digest : ${e.message || e}`, 'error');
    } finally {
      setDigestBusy(false);
    }
  };

  if (!settings) return <p className="muted">Chargement…</p>;

  return (
    <div className="settings">
      <section className="panel">
        <h2>Mon profil de recherche</h2>
        {LIST_FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <textarea
              rows={3}
              value={toText(settings[f.key])}
              onChange={(e) => setSettings({ ...settings, [f.key]: toArray(e.target.value) })}
            />
            <small>{f.hint}</small>
          </label>
        ))}
        <div className="field-row">
          <label className="field">
            <span>Score minimum pour le digest</span>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.min_score}
              onChange={(e) => setSettings({ ...settings, min_score: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="field">
            <span>Email du digest</span>
            <input
              type="email"
              value={settings.email || ''}
              onChange={(e) => setSettings({ ...settings, email: e.target.value })}
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.digest_enabled}
            onChange={(e) => setSettings({ ...settings, digest_enabled: e.target.checked })}
          />
          Recevoir le digest chaque matin
        </label>
        <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
          {saving ? '…' : 'Enregistrer les réglages'}
        </button>
      </section>

      <section className="panel">
        <h2>Entreprises cibles</h2>
        <p className="muted">
          Greenhouse, Lever et Recruitee exposent leurs offres en JSON public : collecte fiable.
          « Lien manuel » = ATS propriétaire, l'entreprise apparaît en bas du digest à vérifier à la main.
        </p>
        <ul className="company-list">
          {companies.map((c) => (
            <li key={c.id} className={c.active ? '' : 'inactive'}>
              <div className="company-main">
                <strong>{c.name}</strong>
                <span className="muted"> — {SOURCE_TYPE_LABELS[c.source_type]}{c.slug ? ` (${c.slug})` : ''}</span>
                {c.last_fetch_status && (
                  <div className={`fetch-status${c.last_fetch_status.startsWith('ok') ? '' : ' err'}`}>
                    {c.last_fetch_status}
                  </div>
                )}
              </div>
              <div className="company-actions">
                {atsTestUrl(c) && <button onClick={() => testCompany(c)}>Tester</button>}
                <button onClick={() => updateCompany(c.id, { active: !c.active })}>
                  {c.active ? 'Désactiver' : 'Activer'}
                </button>
                <button className="danger" onClick={() => removeCompany(c.id)}>Suppr.</button>
              </div>
            </li>
          ))}
        </ul>

        <div className="add-company">
          <h3>Ajouter une entreprise</h3>
          <div className="field-row">
            <input
              placeholder="Nom"
              value={newCompany.name}
              onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
            />
            <select
              value={newCompany.source_type}
              onChange={(e) => setNewCompany({ ...newCompany, source_type: e.target.value })}
            >
              {Object.entries(SOURCE_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <input
              placeholder="Slug ATS (ex: doctolib)"
              value={newCompany.slug}
              onChange={(e) => setNewCompany({ ...newCompany, slug: e.target.value })}
            />
            <input
              placeholder="URL page carrières"
              value={newCompany.careers_url}
              onChange={(e) => setNewCompany({ ...newCompany, careers_url: e.target.value })}
            />
          </div>
          <button className="btn" onClick={addCompany}>+ Ajouter</button>
        </div>
      </section>

      <section className="panel">
        <h2>Digest</h2>
        <p className="muted">
          Le digest part automatiquement chaque matin (cron Supabase). Tu peux aussi :
        </p>
        <div className="field-row">
          <button className="btn" onClick={() => digest(true)} disabled={digestBusy}>
            👁 Prévisualiser
          </button>
          <button className="btn btn-primary" onClick={() => digest(false)} disabled={digestBusy}>
            ✉️ M'envoyer le digest maintenant
          </button>
        </div>
        <p className="muted small">
          ⚠️ Honnêteté sur LinkedIn : la collecte passe par l'accès « invité », que LinkedIn
          bloque activement. Elle peut fonctionner par intermittence ou s'arrêter — WTTJ et
          les pages carrières sont les sources fiables de cette veille.
        </p>
      </section>
    </div>
  );
}
