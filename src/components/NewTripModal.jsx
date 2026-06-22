import { useState } from 'react';

const today = () => new Date().toISOString().split('T')[0];

export default function NewTripModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: '', destination: '', startDate: today(), endDate: today() });
  const [error, setError] = useState('');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

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
          <h2 className="modal__title">✈️ Nouveau voyage</h2>
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
            {error && <p style={{ color: 'var(--red)', fontSize: '13px', marginTop: '4px' }}>{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn btn--secondary btn--full" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary btn--full">Créer le voyage</button>
          </div>
        </form>
      </div>
    </div>
  );
}
