import { useState, useEffect } from 'react';
import { CATEGORIES, formatDate, getDayLabel, deduceTitle, parseGoogleMapsUrl, fetchPlaceData } from '../utils/helpers';

const blank = { title: '', category: 'resto', durationHours: 0, durationMinutes: 30, address: '', notes: '', price: '', link: '', screenshots: [] };

export default function AddActivitySheet({ isOpen, onClose, days, onAddToReserve, onAddToDay,
  defaultDayId, editActivity, onEditSave }) {
  const isEdit = !!editActivity;
  const [form, setForm] = useState({ ...blank });
  const [closing, setClosing] = useState(false);
  const [dest, setDest] = useState('reserve');
  const [selectedDayId, setSelectedDayId] = useState('');
  const [error, setError] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      setError('');
      setImportUrl('');
      if (isEdit) {
        setForm({
          title: editActivity.title || '',
          category: editActivity.category || 'resto',
          durationHours: editActivity.durationHours || 0,
          durationMinutes: editActivity.durationMinutes || 30,
          address: editActivity.address || '',
          notes: editActivity.notes || '',
          price: editActivity.price || '',
          link: editActivity.link || '',
          screenshots: editActivity.screenshots || [],
        });
      } else {
        setForm({ ...blank });
        setDest(defaultDayId ? 'day' : 'reserve');
        setSelectedDayId(defaultDayId || days?.[0]?.id || '');
      }
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 250);
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleImport = async () => {
    const name = parseGoogleMapsUrl(importUrl.trim());
    if (!name) { setError('URL Google Maps non reconnue. Utilise une URL complète (maps.google.com/…).'); return; }
    setImporting(true);
    setError('');
    try {
      const data = await fetchPlaceData(name);
      if (data) {
        setForm(f => ({ ...f, title: data.title || name, address: data.address || f.address, category: data.category || f.category, link: importUrl.trim() }));
      } else {
        setForm(f => ({ ...f, title: f.title || name, link: importUrl.trim() }));
      }
      setImportUrl('');
    } catch {
      setForm(f => ({ ...f, title: f.title || name, link: importUrl.trim() }));
      setImportUrl('');
    } finally {
      setImporting(false);
    }
  };

  const compressImage = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 700;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handleScreenshots = async (e) => {
    const existing = form.screenshots || [];
    const slots = 3 - existing.length;
    if (slots <= 0) return;
    const files = Array.from(e.target.files).slice(0, slots);
    const results = await Promise.all(files.map(compressImage));
    set('screenshots', [...existing, ...results].slice(0, 3));
    e.target.value = '';
  };

  const removeScreenshot = (i) => {
    set('screenshots', (form.screenshots || []).filter((_, idx) => idx !== i));
  };

  const handleSubmit = () => {
    const rawTitle = form.title.trim();
    const title = rawTitle || deduceTitle(form.category, form.address, form.notes);
    const activity = {
      ...form,
      title,
      durationHours: parseInt(form.durationHours) || 0,
      durationMinutes: parseInt(form.durationMinutes) || 0,
      price: parseFloat(form.price) || 0,
      screenshots: form.screenshots || [],
    };
    if (isEdit) {
      onEditSave(activity);
    } else if (dest === 'reserve') {
      onAddToReserve(activity);
    } else {
      if (!selectedDayId) { setError('Choisis un jour.'); return; }
      onAddToDay(selectedDayId, activity);
    }
    close();
  };

  if (!isOpen && !closing) return null;

  return (
    <div className={`sheet-overlay${closing ? ' closing' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet">
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h2 className="sheet__title">{isEdit ? '✏️ Modifier' : '+ Nouvelle activité'}</h2>
          <button className="sheet__close" onClick={close}>✕</button>
        </div>

        <div className="sheet__body">
          {/* Google Maps import */}
          <div className="form-group import-section">
            <label className="form-label">📍 Importer depuis Google Maps</label>
            <div className="import-row">
              <input
                className="form-input"
                type="url"
                placeholder="Colle une URL Google Maps…"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && importUrl && handleImport()}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleImport}
                disabled={!importUrl.trim() || importing}
              >
                {importing ? '…' : '⬇️'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Titre <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)' }}>— déduit si vide</span></label>
            <input className="form-input" placeholder="Ex: Déjeuner au marché" value={form.title}
              onChange={e => set('title', e.target.value)} autoFocus />
          </div>

          <div className="form-group">
            <label className="form-label">Catégorie</label>
            <div className="category-grid">
              {CATEGORIES.map(cat => (
                <button key={cat.id} type="button"
                  className={`category-btn${form.category === cat.id ? ' category-btn--active' : ''}`}
                  data-cat={cat.id}
                  onClick={() => set('category', cat.id)}>
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Durée estimée</label>
            <div className="duration-row">
              <input className="form-input" type="number" min="0" max="24" value={form.durationHours}
                onChange={e => set('durationHours', Math.max(0, parseInt(e.target.value) || 0))} />
              <span className="duration-label">h</span>
              <input className="form-input" type="number" min="0" max="59" step="15" value={form.durationMinutes}
                onChange={e => set('durationMinutes', Math.max(0, parseInt(e.target.value) || 0))} />
              <span className="duration-label">min</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label className="form-label">Prix (€)</label>
              <input className="form-input" type="number" min="0" step="0.5" placeholder="0"
                value={form.price} onChange={e => set('price', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Adresse / Lieu</label>
              <input className="form-input" placeholder="Lieu" value={form.address}
                onChange={e => set('address', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Lien (URL)</label>
            <input className="form-input" type="url" placeholder="https://..." value={form.link}
              onChange={e => set('link', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" placeholder="Infos, horaires, réservations..." value={form.notes}
              onChange={e => set('notes', e.target.value)} />
          </div>

          {/* Screenshots */}
          <div className="form-group">
            <label className="form-label">
              Photos / captures d'écran
              <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)' }}> — max 3</span>
            </label>
            {(form.screenshots || []).length > 0 && (
              <div className="screenshots-preview">
                {form.screenshots.map((src, i) => (
                  <div key={i} className="screenshot-preview-wrap">
                    <img src={src} className="screenshot-preview-img" alt="" />
                    <button type="button" className="screenshot-remove" onClick={() => removeScreenshot(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {(form.screenshots || []).length < 3 && (
              <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer', display: 'inline-flex' }}>
                📷 Ajouter une photo
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleScreenshots} />
              </label>
            )}
          </div>

          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Ajouter à</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button type="button"
                  className={`btn btn--sm${dest === 'reserve' ? ' btn--primary' : ' btn--secondary'}`}
                  onClick={() => setDest('reserve')}>📦 Réserve</button>
                <button type="button"
                  className={`btn btn--sm${dest === 'day' ? ' btn--primary' : ' btn--secondary'}`}
                  onClick={() => setDest('day')}>📅 Un jour</button>
              </div>
              {dest === 'day' && (
                <select className="form-select" value={selectedDayId} onChange={e => setSelectedDayId(e.target.value)}>
                  {(days || []).map((d, i) => (
                    <option key={d.id} value={d.id}>
                      {getDayLabel(i, days.length)} — {formatDate(d.date)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {error && <p style={{ color: 'var(--red)', fontSize: '13px' }}>{error}</p>}
        </div>

        <div className="sheet__footer">
          <button className="btn btn--secondary btn--full" onClick={close}>Annuler</button>
          <button className="btn btn--primary btn--full" onClick={handleSubmit}>
            {isEdit ? '✅ Enregistrer' : dest === 'reserve' ? '📦 En réserve' : '📅 Assigner'}
          </button>
        </div>
      </div>
    </div>
  );
}
