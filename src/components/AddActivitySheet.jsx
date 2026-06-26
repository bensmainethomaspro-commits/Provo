import { useState, useEffect } from 'react';
import { CATEGORIES, formatDate, getDayLabel, deduceTitle, importFromGoogleMaps, fetchPlaceData, fetchUrlMetadata, parseGoogleMapsUrl, getCategoryMeta } from '../utils/helpers';
import { usePlaceSuggestions } from '../hooks/usePlaceSuggestions';

const blank = { title: '', category: 'resto', durationHours: 0, durationMinutes: 0, address: '', notes: '', price: '', link: '', screenshots: [], photoUrl: '', openingHours: '', lat: null, lon: null, fixedStart: '', fixedEnd: '', mustDo: false, pdfs: [], travelerIds: [] };

const TEMPLATES = [
  { emoji: '✈️', label: 'Vol', category: 'trajet', durationHours: 2, durationMinutes: 30 },
  { emoji: '🚂', label: 'Train', category: 'trajet', durationHours: 3, durationMinutes: 0 },
  { emoji: '🚗', label: 'Route', category: 'trajet', durationHours: 2, durationMinutes: 0 },
  { emoji: '🏨', label: 'Hôtel', category: 'repos', durationHours: 1, durationMinutes: 0 },
  { emoji: '🍽', label: 'Restaurant', category: 'resto', durationHours: 1, durationMinutes: 30 },
  { emoji: '☕', label: 'Café', category: 'resto', durationHours: 0, durationMinutes: 45 },
  { emoji: '🏛', label: 'Visite', category: 'visite', durationHours: 2, durationMinutes: 0 },
  { emoji: '🏖', label: 'Plage', category: 'plage', durationHours: 3, durationMinutes: 0 },
];

const timeToMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

const DEFAULT_DURATIONS = {
  resto:  { h: 1, m: 30 },
  visite: { h: 2, m: 0  },
  balade: { h: 2, m: 0  },
  plage:  { h: 3, m: 0  },
  sport:  { h: 1, m: 30 },
  repos:  { h: 1, m: 0  },
  trajet: { h: 1, m: 0  },
  fun:    { h: 2, m: 30 },
};

function isDefaultDuration(f) {
  const total = (parseInt(f.durationHours) || 0) * 60 + (parseInt(f.durationMinutes) || 0);
  return total === 0;
}

export default function AddActivitySheet({ isOpen, onClose, days, onAddToReserve, onAddToDay,
  defaultDayId, editActivity, onEditSave, reserveActivities, onMoveFromReserve,
  tripTravelers, onAddToAllDays, tripLat, tripLon }) {
  const isEdit = !!editActivity;
  const [form, setForm] = useState({ ...blank });
  const { suggestions } = usePlaceSuggestions(tripLat, tripLon, isOpen && !isEdit);
  const [closing, setClosing] = useState(false);
  const [dest, setDest] = useState('reserve');
  const [selectedDayId, setSelectedDayId] = useState('');
  const [error, setError] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [recurring, setRecurring] = useState(false);

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
          photoUrl: editActivity.photoUrl || '',
          openingHours: editActivity.openingHours || '',
          lat: editActivity.lat || null,
          lon: editActivity.lon || null,
          fixedStart: editActivity.fixedStart || '',
          fixedEnd: '',
          mustDo: editActivity.mustDo || false,
          pdfs: editActivity.pdfs || [],
          travelerIds: editActivity.travelerIds || [],
        });
      } else {
        const allTravelerIds = (tripTravelers || []).map(t => t.id);
        setForm({ ...blank, travelerIds: allTravelerIds });
        setDest(defaultDayId ? 'day' : 'reserve');
        setSelectedDayId(defaultDayId || days?.[0]?.id || '');
        setRecurring(false);
      }
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 250);
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const applyResult = (result, rawInput) => {
    setForm(f => {
      const newCat = result.category || f.category;
      const dur = DEFAULT_DURATIONS[newCat];
      return {
        ...f,
        title: result.title || f.title,
        address: result.address || f.address,
        category: newCat,
        ...(result.link ? { link: result.link } : {}),
        photoUrl: result.photoUrl || f.photoUrl,
        openingHours: result.openingHours || f.openingHours,
        lat: result.lat ?? f.lat,
        lon: result.lon ?? f.lon,
        ...(result.price && !f.price ? { price: String(result.price) } : {}),
        ...(dur && isDefaultDuration(f) ? { durationHours: dur.h, durationMinutes: dur.m } : {}),
      };
    });
    setImportUrl('');
  };

  const handleImport = async () => {
    const raw = importUrl.trim();
    setImporting(true);
    setError('');
    try {
      const isUrl = raw.startsWith('http') || raw.includes('google.com') || raw.includes('goo.gl') || raw.includes('maps.app') || raw.includes('tiktok.com') || raw.includes('vm.tiktok.com') || raw.includes('vt.tiktok.com');

      if (isUrl) {
        // TikTok: fetch oEmbed to pre-fill title and thumbnail
        const isTikTok = /tiktok\.com/.test(raw);
        if (isTikTok) {
          try {
            const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(raw)}`;
            const res = await fetch(oembedUrl);
            if (res.ok) {
              const data = await res.json();
              applyResult({
                title: data.title || data.author_name || '',
                photoUrl: data.thumbnail_url || '',
                link: raw,
                category: 'fun',
              }, raw);
              return;
            }
          } catch {}
          applyResult({ title: 'Activité TikTok', link: raw, category: 'fun' }, raw);
          setError('TikTok importé — ajoute le titre manuellement si besoin.');
          return;
        }
        // Google Maps: dedicated parser
        const isGoogleMaps = /google\.com\/maps|goo\.gl|maps\.app/.test(raw);
        if (isGoogleMaps) {
          const result = await importFromGoogleMaps(raw);
          if (result) { applyResult(result, raw); return; }
          const name = parseGoogleMapsUrl(raw);
          if (name) {
            const placeData = await fetchPlaceData(name);
            if (placeData) { applyResult({ ...placeData, link: raw }, raw); return; }
            const clean = name.replace(/\+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            applyResult({ title: clean, link: raw }, raw);
            setError('Lieu non trouvé dans OpenStreetMap — lien et titre sauvegardés.');
            return;
          }
          const isShortLink = /maps\.app\.goo\.gl|goo\.gl\/maps/.test(raw);
          setError(isShortLink
            ? 'Lien iOS non résolu. Entre directement le nom du lieu, ou copie l\'URL depuis Safari.'
            : 'Lien non reconnu. Essaie de coller directement le nom du lieu.');
          return;
        }
        // Any website URL — try Microlink for metadata
        const meta = await fetchUrlMetadata(raw);
        if (meta?.title) {
          const placeData = await fetchPlaceData(meta.title).catch(() => null);
          applyResult({
            title: meta.title,
            photoUrl: meta.photoUrl,
            link: raw,
            ...(placeData ? { address: placeData.address, lat: placeData.lat, lon: placeData.lon, category: placeData.category } : {}),
          }, raw);
          if (!placeData) setError('Titre importé. Ajoute l\'adresse manuellement si besoin.');
          return;
        }
        setError('Impossible d\'extraire les infos de ce site. Essaie un nom de lieu ou un lien Google Maps.');
      } else {
        // Plain text: search Nominatim directly
        const placeData = await fetchPlaceData(raw);
        if (placeData) { applyResult(placeData, raw); return; }
        setError('Lieu introuvable. Essaie un nom plus précis (ex: "Plage de Biarritz, France").');
      }
    } catch {
      setError('Erreur réseau. Vérifie ta connexion et réessaie.');
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

  const handlePdf = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError('PDF trop volumineux (max 3 Mo).'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      set('pdfs', [...(form.pdfs || []), { name: file.name, data: ev.target.result }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removePdf = (i) => set('pdfs', (form.pdfs || []).filter((_, idx) => idx !== i));

  const toggleTraveler = (id) => {
    const ids = form.travelerIds || [];
    set('travelerIds', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const handleSubmit = () => {
    const rawTitle = form.title.trim();
    const title = rawTitle || deduceTitle(form.category, form.address, form.notes);
    const { fixedEnd, ...formRest } = form;
    const activity = {
      ...formRest,
      title,
      fixedStart: form.fixedStart || null,
      durationHours: parseInt(form.durationHours) || 0,
      durationMinutes: parseInt(form.durationMinutes) || 0,
      price: parseFloat(form.price) || 0,
      screenshots: form.screenshots || [],
      pdfs: form.pdfs || [],
      mustDo: form.mustDo || false,
      travelerIds: form.travelerIds || [],
    };
    if (isEdit) {
      onEditSave(activity);
    } else if (dest === 'reserve') {
      onAddToReserve(activity);
    } else if (recurring && onAddToAllDays) {
      onAddToAllDays(activity);
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
          {/* Meal quick options */}
          {isEdit && editActivity?.isMeal && (
            <div className="meal-quick">
              <div className="form-label">Où mange-t-on ?</div>
              <div className="meal-quick__row">
                {[
                  { label: '🏠 Maison', title: 'Repas maison', price: '5' },
                  { label: '🍽️ Restaurant', title: form.title === 'Repas midi' || form.title === 'Repas soir' || form.title === 'Repas maison' || form.title === 'Pique-nique' ? (editActivity.mealSlot === 'midi' ? 'Repas midi' : 'Repas soir') : form.title, price: '20' },
                  { label: '🧺 Pique-nique', title: 'Pique-nique', price: '10' },
                ].map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`meal-quick__btn${form.title === opt.title ? ' meal-quick__btn--active' : ''}`}
                    onClick={() => { set('title', opt.title); set('price', opt.price); }}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          )}
          {/* Reserve picker (when adding to a specific day) */}
          {!isEdit && defaultDayId && reserveActivities?.length > 0 && (
            <div className="reserve-picker">
              <div className="reserve-picker__title">📦 Depuis la réserve</div>
              {reserveActivities.map(a => {
                const meta = getCategoryMeta(a.category);
                return (
                  <button key={a.id} type="button" className="reserve-picker__item"
                    onClick={() => { onMoveFromReserve?.(a.id); close(); }}>
                    <span className="reserve-picker__emoji">{meta.emoji}</span>
                    <span className="reserve-picker__name">{a.title}</span>
                    <span className="reserve-picker__arrow">→</span>
                  </button>
                );
              })}
              <div className="reserve-picker__divider">— ou créer une nouvelle activité —</div>
            </div>
          )}

          {/* Activity templates */}
          {!isEdit && (
            <div className="templates-row">
              {TEMPLATES.map(t => (
                <button
                  key={t.label}
                  type="button"
                  className="template-pill"
                  onClick={() => setForm(f => ({
                    ...f,
                    category: t.category,
                    durationHours: t.durationHours,
                    durationMinutes: t.durationMinutes,
                  }))}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Google Maps import / place search */}
          <div className="form-group import-section">
            <label className="form-label">📍 Lien Google Maps ou nom du lieu</label>
            <div className="import-row">
              <input
                className="form-input"
                placeholder="maps.app.goo.gl/… ou tapez un nom de lieu"
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

          {/* Nearby place suggestions */}
          {suggestions.length > 0 && !isEdit && (
            <div className="form-group suggestions-row-wrap">
              <label className="form-label">📍 À proximité</label>
              <div className="suggestions-row">
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => {
                      const dur = DEFAULT_DURATIONS[s.category];
                      setForm(f => ({
                        ...f,
                        title: s.title,
                        address: s.address || f.address,
                        lat: s.lat,
                        lon: s.lon,
                        category: s.category,
                        ...(dur && isDefaultDuration(f) ? { durationHours: dur.h, durationMinutes: dur.m } : {}),
                      }));
                    }}
                  >
                    <span>{getCategoryMeta(s.category).emoji}</span>
                    <span>{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Photo preview from import */}
          {form.photoUrl && (
            <div className="form-group">
              <label className="form-label">Photo du lieu</label>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={form.photoUrl} alt="" className="import-photo-preview" />
                <button type="button" className="screenshot-remove"
                  style={{ top: -5, right: -5 }}
                  onClick={() => set('photoUrl', '')}>✕</button>
              </div>
            </div>
          )}

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
                  onClick={() => {
                    const dur = DEFAULT_DURATIONS[cat.id];
                    setForm(f => {
                      const autoFill = dur && isDefaultDuration(f);
                      return { ...f, category: cat.id, ...(autoFill ? { durationHours: dur.h, durationMinutes: dur.m } : {}) };
                    });
                  }}>
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

          <div className="form-group">
            <label className="form-label">Heure prévue <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)' }}>— optionnel</span></label>
            <div className="time-range-row">
              <span>De</span>
              <input
                type="time"
                className="form-input"
                value={form.fixedStart}
                onChange={e => {
                  const val = e.target.value;
                  setForm(f => {
                    const updated = { ...f, fixedStart: val };
                    if (val && f.fixedEnd) {
                      const mins = timeToMin(f.fixedEnd) - timeToMin(val);
                      if (mins > 0) { updated.durationHours = Math.floor(mins / 60); updated.durationMinutes = mins % 60; }
                    }
                    return updated;
                  });
                }}
              />
              <span>à</span>
              <input
                type="time"
                className="form-input"
                value={form.fixedEnd}
                onChange={e => {
                  const val = e.target.value;
                  setForm(f => {
                    const updated = { ...f, fixedEnd: val };
                    if (f.fixedStart && val) {
                      const mins = timeToMin(val) - timeToMin(f.fixedStart);
                      if (mins > 0) { updated.durationHours = Math.floor(mins / 60); updated.durationMinutes = mins % 60; }
                    }
                    return updated;
                  });
                }}
              />
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

          {form.openingHours && (
            <div className="form-group">
              <label className="form-label">Horaires</label>
              <input className="form-input" value={form.openingHours}
                onChange={e => set('openingHours', e.target.value)} />
            </div>
          )}

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
            {/* PDF attachments */}
            {(form.pdfs || []).length > 0 && (
              <div className="pdf-list">
                {form.pdfs.map((p, i) => (
                  <div key={i} className="pdf-chip">
                    <span className="pdf-chip__icon">📄</span>
                    <span className="pdf-chip__name">{p.name}</span>
                    <button type="button" className="pdf-chip__remove" onClick={() => removePdf(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {(form.pdfs || []).length < 3 && (
              <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer', display: 'inline-flex', marginTop: 4 }}>
                📎 Joindre un PDF (billet, bon…)
                <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handlePdf} />
              </label>
            )}
          </div>

          {/* Must-do */}
          <div className="form-group">
            <label className="activity-toggle-row">
              <span className="activity-toggle-label">⭐ Incontournable</span>
              <label className="settings-toggle">
                <input type="checkbox" checked={!!form.mustDo} onChange={e => set('mustDo', e.target.checked)} />
                <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
              </label>
            </label>
          </div>

          {/* Travelers assignment */}
          {tripTravelers?.length > 0 && (
            <div className="form-group">
              <label className="form-label">Qui participe ?</label>
              <div className="traveler-assign-row">
                {tripTravelers.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`traveler-assign-chip${(form.travelerIds || []).includes(t.id) ? ' traveler-assign-chip--on' : ''}`}
                    onClick={() => toggleTraveler(t.id)}
                  >
                    {t.emoji} {t.name}
                  </button>
                ))}
              </div>
              {(form.travelerIds || []).length === 0 && (
                <p className="travelers-hint">Tout le monde participe par défaut</p>
              )}
            </div>
          )}

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
                <>
                  <select className="form-select" value={selectedDayId} onChange={e => setSelectedDayId(e.target.value)}>
                    {(days || []).map((d, i) => (
                      <option key={d.id} value={d.id}>
                        {getDayLabel(i, days.length)} — {formatDate(d.date)}
                      </option>
                    ))}
                  </select>
                  {onAddToAllDays && (
                    <label className="activity-toggle-row" style={{ marginTop: 8 }}>
                      <span className="activity-toggle-label">🔁 Ajouter à tous les jours</span>
                      <label className="settings-toggle">
                        <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
                        <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
                      </label>
                    </label>
                  )}
                </>
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
