import { useState, useEffect } from 'react';
import { CATEGORIES, formatDate, getDayLabel, deduceTitle, fetchPlaceData, searchPlaces, getCategoryMeta, extractViaEdge, extractPlaceClient } from '../utils/helpers';
import { usePlaceSuggestions } from '../hooks/usePlaceSuggestions';
import { poiAtCoords } from '../utils/enrich';

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
  tripTravelers, onAddToAllDays, tripLat, tripLon, tripDestination }) {
  const isEdit = !!editActivity;
  const [form, setForm] = useState({ ...blank });
  const { suggestions } = usePlaceSuggestions(tripLat, tripLon, isOpen && !isEdit);
  const [closing, setClosing] = useState(false);
  const [dest, setDest] = useState('reserve');
  const [selectedDayId, setSelectedDayId] = useState('');
  const [error, setError] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState([]);
  // Le retour de la recherche s'affiche sous le champ qui l'a déclenchée, en
  // haut de la feuille — `error` reste réservé à la validation, près du bouton.
  const [importMsg, setImportMsg] = useState('');
  // Établissement trouvé à l'adresse choisie : proposé, jamais imposé.
  const [poiHint, setPoiHint] = useState(null);
  const [saving, setSaving] = useState(false);
  const [recurring, setRecurring] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      setError('');
      setImportUrl('');
      setCandidates([]);
      setImportMsg('');
      setPoiHint(null);
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
        ...(result.notes && !f.notes.trim() ? { notes: result.notes } : {}),
        ...(result.price && !f.price ? { price: String(result.price) } : {}),
        ...(dur && isDefaultDuration(f) ? { durationHours: dur.h, durationMinutes: dur.m } : {}),
      };
    });
    setImportUrl('');
    setCandidates([]);
    setImportMsg('');
  };

  // Une adresse n'est pas un commerce : OSM n'a ni horaires ni site dessus.
  // On regarde donc ce qui se trouve à ce point précis, et on le propose.
  const offerPoiAt = async (place) => {
    if (!place || place.openingHours || place.lat == null) return;
    const poi = await poiAtCoords(place.lat, place.lon).catch(() => null);
    if (poi?.title) setPoiHint(poi);
  };

  const usePoiHint = () => {
    if (!poiHint) return;
    setForm(f => ({
      ...f,
      title: poiHint.title,
      category: poiHint.category || f.category,
      openingHours: poiHint.openingHours || f.openingHours,
      ...(poiHint.link && !f.link ? { link: poiHint.link } : {}),
      ...(poiHint.lat != null ? { lat: poiHint.lat, lon: poiHint.lon } : {}),
    }));
    setPoiHint(null);
  };

  const handleImport = async () => {
    const raw = importUrl.trim();
    setImporting(true);
    setError('');
    setImportMsg('');
    setCandidates([]);
    try {
      const isUrl = raw.startsWith('http') || raw.includes('google.com') || raw.includes('goo.gl')
        || raw.includes('maps.app') || raw.includes('share.google') || raw.includes('tiktok.com');

      if (isUrl) {
        const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
        // 1) server-side agent (best — resolves short links + classifies + geocodes)
        // 2) robust client extractor (TikTok oEmbed, Maps proxy chain, geocoding)
        let result = await extractViaEdge(normalized);
        if (!result) result = await extractPlaceClient(normalized);

        if (result && (result.title || result.lat != null)) {
          applyResult({ ...result, link: result.link || raw }, raw);

          // Un lien partagé donne presque toujours le NOM du lieu, rarement son
          // adresse : une recherche du nom seul ne donne rien (« Agapii Mou »
          // n'existe pas pour un géocodeur sans ville). On relance donc la
          // recherche en la situant sur la destination du voyage.
          if (result.lat == null && result.title) {
            const q = tripDestination ? `${result.title}, ${tripDestination}` : result.title;
            const found = await searchPlaces(q, { lat: tripLat, lon: tripLon });
            if (found.length === 1) {
              // Le nom du lien fait foi : il vient de la fiche Google.
              applyResult({ ...found[0], title: result.title, link: result.link || raw }, raw);
            } else if (found.length > 1) {
              const net = (found[0]._score ?? 0) - (found[1]._score ?? 0) >= 5;
              if (net) {
                applyResult({ ...found[0], title: result.title, link: result.link || raw }, raw);
              } else {
                setCandidates(found);
                setImportMsg(`« ${result.title} » importé — précise lequel c'est.`);
              }
            } else {
              // Le lieu existe chez Google mais pas dans les données
              // cartographiques ouvertes sur lesquelles l'app s'appuie. Le dire
              // franchement vaut mieux que laisser croire à une panne.
              setImportMsg(`« ${result.title} » importé ✓ — mais ce lieu n'est pas `
                + `répertorié dans la carte ouverte, l'adresse et les horaires `
                + `restent à compléter à la main.`);
            }
            return;
          }

          if (result.source === 'tiktok' && result.lat == null) {
            setImportMsg('Vidéo importée ✓ — vérifie le titre et ajoute un lieu si besoin.');
          }
          return;
        }
        // Le lien n'a rien donné. On le garde quand même dans la fiche — il
        // reste utile — et on dit quoi faire, plutôt qu'un « non reconnu » sec.
        set('link', normalized);
        setImportMsg("Ce lien n'a pas pu être lu — les liens courts Google sont souvent protégés. "
          + "Ouvre-le, copie le nom ou l'adresse du lieu et colle-les ici : le lien, lui, est déjà enregistré.");
        return;
      }

      // Texte libre : adresse ou nom de lieu. On propose les correspondances au
      // lieu d'imposer la première — « 12 rue de la Paix » existe partout.
      let found = await searchPlaces(raw, { lat: tripLat, lon: tripLon });
      // Rien trouvé et aucune ville dans la saisie : on retente en ajoutant la
      // destination. « 5 rue Victor Hugo » seul ne dit rien à un géocodeur.
      if (!found.length && tripDestination && !raw.includes(',')) {
        found = await searchPlaces(`${raw}, ${tripDestination}`, { lat: tripLat, lon: tripLon });
      }
      if (found.length === 1) { applyResult(found[0], raw); offerPoiAt(found[0]); return; }
      if (found.length > 1) {
        // Les candidats sont classés. Quand le premier détache nettement les
        // autres, faire choisir n'apporte rien : on remplit, l'utilisateur
        // corrige s'il le faut. On ne fait choisir que sur une vraie ambiguïté.
        const net = (found[0]._score ?? 0) - (found[1]._score ?? 0) >= 5;
        if (net) { applyResult(found[0], raw); offerPoiAt(found[0]); return; }
        setCandidates(found);
        return;
      }
      setImportMsg(tripDestination
        ? `Aucun lieu trouvé, ni à ${tripDestination} ni ailleurs. Précise la ville — `
          + 'ex. « 5 rue Victor Hugo, Biarritz ».'
        : 'Aucun lieu trouvé. Ajoute la ville — ex. « 5 rue Victor Hugo, Biarritz ».');
    } catch {
      setImportMsg('Erreur réseau. Vérifie ta connexion et réessaie.');
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

  const handleSubmit = async () => {
    if (saving) return;
    const rawTitle = form.title.trim();
    const title = rawTitle || deduceTitle(form.category, form.address, form.notes);
    const { fixedEnd, ...formRest } = form;
    if (!isEdit && dest !== 'reserve' && !recurring && !selectedDayId) {
      setError('Choisis un jour.'); return;
    }

    // Geocode when coordinates are missing OR when the address was edited (stale
    // coords would keep pointing the map at the old place). Capped so saving
    // never hangs if Nominatim is slow.
    let lat = form.lat, lon = form.lon;
    const addressChanged = isEdit && (form.address || '').trim() !== (editActivity?.address || '').trim();
    if (addressChanged) { lat = null; lon = null; }
    if ((lat == null || lon == null) && form.address && form.address.trim()) {
      setSaving(true);
      const place = await Promise.race([
        fetchPlaceData(form.address.trim()).catch(() => null),
        new Promise(r => setTimeout(() => r(null), 4500)),
      ]);
      setSaving(false);
      if (place?.lat != null) { lat = place.lat; lon = place.lon; }
    }

    const activity = {
      ...formRest,
      title,
      lat, lon,
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
          <button aria-label="Fermer" className="sheet__close" onClick={close}>✕</button>
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

          {/* Adresse, nom de lieu, ou lien à importer */}
          <div className="form-group import-section">
            <label className="form-label">📍 Adresse, nom du lieu, ou lien</label>
            <div className="import-row">
              <input
                className="form-input"
                placeholder="5 rue Victor Hugo, Biarritz — ou colle un lien"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && importUrl && handleImport()}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleImport}
                disabled={!importUrl.trim() || importing}
                aria-label="Chercher ce lieu"
              >
                {importing ? '…' : '⬇️'}
              </button>
            </div>
            {importMsg && <p className="import-msg">{importMsg}</p>}
            {poiHint && (
              <button type="button" className="poi-hint" onClick={usePoiHint}>
                <span className="poi-hint__icon" aria-hidden="true">💡</span>
                <span className="poi-hint__text">
                  <strong>{poiHint.title}</strong>
                  <small>
                    est à cette adresse
                    {poiHint.openingHours ? ' · horaires connus' : ''} — utiliser ?
                  </small>
                </span>
                <span className="poi-hint__cta">Oui</span>
              </button>
            )}
            {/* Plusieurs correspondances : on laisse choisir plutôt que de
                deviner. Le tap remplit adresse, coordonnées et catégorie. */}
            {candidates.length > 0 && (
              <div className="place-results">
                <div className="place-results__title">
                  {candidates.length} lieux trouvés — lequel ?
                </div>
                {candidates.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className="place-result"
                    onClick={() => { applyResult(c, c.title); offerPoiAt(c); }}
                  >
                    <span className="place-result__emoji">{getCategoryMeta(c.category).emoji}</span>
                    <span className="place-result__text">
                      <span className="place-result__title">{c.title}</span>
                      <span className="place-result__addr">{c.displayName || c.address}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
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

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="sheet__footer">
          <button className="btn btn--secondary btn--full" onClick={close}>Annuler</button>
          <button className="btn btn--primary btn--full" onClick={handleSubmit} disabled={saving}>
            {saving ? '📍 Localisation…' : isEdit ? '✅ Enregistrer' : dest === 'reserve' ? '📦 En réserve' : '📅 Assigner'}
          </button>
        </div>
      </div>
    </div>
  );
}
