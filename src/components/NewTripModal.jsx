import { useState } from 'react';
import { TRIP_EMOJIS } from '../utils/helpers';

const today = () => new Date().toISOString().split('T')[0];

function compressCoverPhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const TRIP_COLORS = ['#FF6B35','#3b82f6','#8b5cf6','#22c55e','#ef4444','#06b6d4','#f59e0b','#ec4899'];

export default function NewTripModal({ onClose, onCreate, editTrip }) {
  const isEdit = !!editTrip;
  const [form, setForm] = useState(editTrip
    ? { name: editTrip.name, destination: editTrip.destination, emoji: editTrip.emoji || '✈️', startDate: editTrip.startDate, endDate: editTrip.endDate, initialBudget: editTrip.initialBudget || '', coverPhoto: editTrip.coverPhoto || null, travelers: editTrip.travelers || 1, color: editTrip.color || '#FF6B35' }
    : { name: '', destination: '', emoji: '✈️', startDate: today(), endDate: today(), initialBudget: '', coverPhoto: null, travelers: 1, color: '#FF6B35' }
  );
  const [error, setError] = useState('');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleCoverPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressCoverPhoto(file);
    set('coverPhoto', compressed);
    e.target.value = '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Nomme ton voyage !'); return; }
    if (!form.startDate || !form.endDate) { setError('Dates requises'); return; }
    if (form.endDate < form.startDate) { setError('La date de fin doit être après le début'); return; }
    onCreate(form);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <h2 className="modal__title">{isEdit ? '✏️ Modifier le voyage' : '✈️ Nouveau voyage'}</h2>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            <div className="form-group">
              <label className="form-label">Nom du voyage *</label>
              <input className="form-input" placeholder="Ex: Road trip Islande" value={form.name}
                onChange={e => set('name', e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Destination</label>
              <input className="form-input" placeholder="Ex: Reykjavik, Islande" value={form.destination}
                onChange={e => set('destination', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Photo de couverture <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)' }}>— optionnel</span></label>
              {form.coverPhoto ? (
                <div className="cover-photo-preview">
                  <img src={form.coverPhoto} alt="" className="cover-photo-preview__img" />
                  <button type="button" className="cover-photo-preview__remove" onClick={() => set('coverPhoto', null)}>✕</button>
                </div>
              ) : (
                <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6 }}>
                  📷 Choisir une photo
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverPhoto} />
                </label>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group">
                <label className="form-label">Budget initial (€) <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)', fontSize: 11 }}>optionnel</span></label>
                <input className="form-input" type="number" min="0" step="10" placeholder="Ex: 2000"
                  value={form.initialBudget} onChange={e => set('initialBudget', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Voyageurs</label>
                <div className="travelers-row">
                  <button type="button" className="travelers-btn" onClick={() => set('travelers', Math.max(1, (form.travelers||1) - 1))}>−</button>
                  <span className="travelers-count">{form.travelers || 1}</span>
                  <button type="button" className="travelers-btn" onClick={() => set('travelers', (form.travelers||1) + 1)}>+</button>
                </div>
              </div>
            </div>
            {(form.travelers || 1) > 1 && (
              <p className="travelers-hint">Transport & hébergement seront divisés par {form.travelers} dans le budget.</p>
            )}
            <div className="form-group">
              <label className="form-label">Couleur du voyage</label>
              <div className="color-swatches">
                {TRIP_COLORS.map(c => (
                  <button key={c} type="button"
                    className={`color-swatch${form.color === c ? ' color-swatch--active' : ''}`}
                    style={{ background: c }}
                    onClick={() => set('color', c)}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group">
                <label className="form-label">Départ</label>
                <input className="form-input" type="date" value={form.startDate}
                  onChange={e => { set('startDate', e.target.value); if (e.target.value > form.endDate) set('endDate', e.target.value); }} />
              </div>
              <div className="form-group">
                <label className="form-label">Retour</label>
                <input className="form-input" type="date" value={form.endDate} min={form.startDate}
                  onChange={e => set('endDate', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Emoji du voyage</label>
              <div className="emoji-grid emoji-grid--scroll">
                {TRIP_EMOJIS.map(em => (
                  <button key={em} type="button"
                    className={`emoji-option${form.emoji === em ? ' selected' : ''}`}
                    onClick={() => set('emoji', em)}>
                    {em}
                  </button>
                ))}
              </div>
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: '13px', marginTop: '4px' }}>{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn btn--secondary btn--full" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary btn--full">{isEdit ? '✅ Enregistrer' : '🚀 Créer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
