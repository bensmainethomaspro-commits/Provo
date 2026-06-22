import { useState, useEffect } from 'react';
import { CATEGORIES, formatDate, getDayLabel } from '../utils/helpers';

const blank = { title: '', category: 'restaurant', durationHours: 0, durationMinutes: 30, address: '', notes: '' };

export default function AddActivitySheet({ isOpen, onClose, days, onAddToReserve, onAddToDay, defaultDayId }) {
  const [form, setForm] = useState({ ...blank });
  const [closing, setClosing] = useState(false);
  const [dest, setDest] = useState('reserve');
  const [selectedDayId, setSelectedDayId] = useState(defaultDayId || days?.[0]?.id || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setForm({ ...blank });
      setDest(defaultDayId ? 'day' : 'reserve');
      setSelectedDayId(defaultDayId || days?.[0]?.id || '');
      setError('');
      setClosing(false);
    }
  }, [isOpen, defaultDayId, days]);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 250);
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = () => {
    if (!form.title.trim()) { setError('Le titre est requis.'); return; }
    const activity = { ...form, title: form.title.trim() };
    if (dest === 'reserve') {
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
          <h2 className="sheet__title">Nouvelle activité</h2>
          <button className="sheet__close" onClick={close}>✕</button>
        </div>

        <div className="sheet__body">
          <div className="form-group">
            <label className="form-label">Titre *</label>
            <input className="form-input" placeholder="Ex: Déjeuner au marché" value={form.title}
              onChange={e => set('title', e.target.value)} autoFocus />
          </div>

          <div className="form-group">
            <label className="form-label">Catégorie</label>
            <div className="category-grid">
              {CATEGORIES.map(cat => (
                <button key={cat.id} type="button"
                  className={`category-btn${form.category === cat.id ? ' category-btn--active' : ''}`}
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

          <div className="form-group">
            <label className="form-label">Adresse / Lieu</label>
            <input className="form-input" placeholder="Adresse optionnelle" value={form.address}
              onChange={e => set('address', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" placeholder="Infos, horaires, réservations..." value={form.notes}
              onChange={e => set('notes', e.target.value)} />
          </div>

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
                {days.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    {getDayLabel(i, days.length)} — {formatDate(d.date)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: '13px' }}>{error}</p>}
        </div>

        <div className="sheet__footer">
          <button className="btn btn--secondary btn--full" onClick={close}>Annuler</button>
          <button className="btn btn--primary btn--full" onClick={handleSubmit}>
            {dest === 'reserve' ? '📦 Ajouter à la réserve' : '📅 Assigner au jour'}
          </button>
        </div>
      </div>
    </div>
  );
}
