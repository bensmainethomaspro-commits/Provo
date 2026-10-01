import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, Camera } from 'lucide-react';
import Icone from './Icone';
import ImagePiece from './ImagePiece';
import { enPiece } from '../utils/pieces';
import { TRIP_EMOJIS, COULEURS_VOYAGE } from '../utils/helpers';

// Local date (not UTC) — toISOString would give yesterday between midnight and ~2am in France.
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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


// « Lisbonne, Portugal » → « Lisbonne » : le nom par défaut d'un voyage.
const nomDepuis = (destination) => (destination || '').split(',')[0].trim();

/**
 * Créer (ou modifier) un voyage.
 *
 * Jusqu'au 1er octobre 2026 : une fenêtre centrée de 34 contrôles, où le nom
 * était obligatoire et la destination facultative, alors que c'est elle qui
 * situe chaque lieu ajouté ensuite. Trois choix décoratifs (couleur, émoji,
 * photo) passaient avant même que le voyage existe, la couleur choisie était
 * ignorée à la création, et le champ « Retour » sortait de 34 px de la
 * fenêtre.
 *
 * Maintenant : une feuille plein écran comme les autres, la destination
 * d'abord, le nom qui s'en déduit, les dates, et le reste replié.
 */
export default function NewTripModal({ onClose, onCreate, editTrip }) {
  const isEdit = !!editTrip;
  const [form, setForm] = useState(editTrip
    ? { name: editTrip.name, destination: editTrip.destination || '', emoji: editTrip.emoji || '✈️', startDate: editTrip.startDate, endDate: editTrip.endDate, initialBudget: editTrip.initialBudget || '', coverPhoto: editTrip.coverPhoto || null, travelers: editTrip.travelers || 1, color: editTrip.color || '#35A7DD' }
    : { name: '', destination: '', emoji: '✈️', startDate: today(), endDate: today(), initialBudget: '', coverPhoto: null, travelers: 1, color: '#35A7DD' }
  );
  const [error, setError] = useState('');
  const [plusOuvert, setPlusOuvert] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleCoverPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressCoverPhoto(file);
    // Rangée à part tout de suite (utils/pieces.js) : le voyage ne garde qu'une référence.
    set('coverPhoto', await enPiece(compressed));
    e.target.value = '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const destination = form.destination.trim();
    // Un ancien voyage peut ne pas avoir de destination : on ne l'exige qu'à la création.
    if (!isEdit && !destination) { setError('Où pars-tu ? La destination sert à situer tes lieux.'); return; }
    const name = form.name.trim() || nomDepuis(destination);
    if (!name) { setError('Donne un nom à ton voyage.'); return; }
    if (!form.startDate || !form.endDate) { setError('Choisis les dates du voyage.'); return; }
    if (form.endDate < form.startDate) { setError('Le retour doit venir après le départ.'); return; }
    onCreate({ ...form, name, destination });
  };

  const resumeOptions = [
    form.initialBudget ? `budget ${form.initialBudget} €` : null,
    (form.travelers || 1) > 1 ? `${form.travelers} voyageurs` : null,
  ].filter(Boolean).join(' · ') || 'budget, voyageurs, couleur, émoji, photo';

  // Un calque plein écran se pose sur le document, pas dans le composant qui
  // l'ouvre (règle E8).
  return createPortal(
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet nouveau-voyage" role="dialog" aria-modal="true" aria-labelledby="nv-titre">
        <div className="sheet__header">
          <h2 className="sheet__title" id="nv-titre">{isEdit ? 'Modifier le voyage' : 'Nouveau voyage'}</h2>
          <button type="button" aria-label="Fermer" className="sheet__close" onClick={onClose}><Icone de={X} /></button>
        </div>
        <form onSubmit={handleSubmit} className="nouveau-voyage__form" noValidate>
          <div className="sheet__body">
            <div className="form-group">
              <label className="form-label" htmlFor="nv-destination">Destination</label>
              <input id="nv-destination" className="form-input" placeholder="Ex : Lisbonne, Portugal"
                value={form.destination} autoFocus={!isEdit} autoComplete="off"
                onChange={e => { set('destination', e.target.value); setError(''); }} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="nv-nom">Nom du voyage <span className="form-label__facultatif">facultatif</span></label>
              <input id="nv-nom" className="form-input" autoComplete="off"
                placeholder={nomDepuis(form.destination) || 'Ex : Road trip en Islande'}
                value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="nouveau-voyage__dates">
              <div className="form-group">
                <label className="form-label" htmlFor="nv-depart">Départ</label>
                <input id="nv-depart" className="form-input" type="date" value={form.startDate}
                  onChange={e => { set('startDate', e.target.value); if (e.target.value > form.endDate) set('endDate', e.target.value); }} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="nv-retour">Retour</label>
                <input id="nv-retour" className="form-input" type="date" value={form.endDate} min={form.startDate}
                  onChange={e => set('endDate', e.target.value)} />
              </div>
            </div>

            <button type="button" className="details-pli nouveau-voyage__plus" aria-expanded={plusOuvert}
              onClick={() => setPlusOuvert(o => !o)}>
              <span><Icone de={ChevronDown} taille={16} className={`details-pli__chevron${plusOuvert ? ' details-pli__chevron--ouvert' : ''}`} /> Plus d'options</span>
              <small>{resumeOptions}</small>
            </button>

            {plusOuvert && (
              <div className="nouveau-voyage__options">
                <div className="nouveau-voyage__ligne">
                  <div className="form-group">
                    <label className="form-label" htmlFor="nv-budget">Budget (€)</label>
                    <input id="nv-budget" className="form-input" type="number" min="0" step="10" inputMode="decimal"
                      placeholder="Ex : 2000" value={form.initialBudget} onChange={e => set('initialBudget', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <span className="form-label" id="nv-voyageurs">Voyageurs</span>
                    <div className="travelers-row" role="group" aria-labelledby="nv-voyageurs">
                      <button type="button" className="travelers-btn" aria-label="Un voyageur de moins"
                        onClick={() => set('travelers', Math.max(1, (form.travelers || 1) - 1))}>−</button>
                      <span className="travelers-count">{form.travelers || 1}</span>
                      <button type="button" className="travelers-btn" aria-label="Un voyageur de plus"
                        onClick={() => set('travelers', (form.travelers || 1) + 1)}>+</button>
                    </div>
                  </div>
                </div>
                {(form.travelers || 1) > 1 && (
                  <p className="travelers-hint">Transport et hébergement seront divisés par {form.travelers} dans le budget.</p>
                )}
                <div className="form-group">
                  <span className="form-label" id="nv-couleur">Couleur</span>
                  <div className="color-swatches" role="radiogroup" aria-labelledby="nv-couleur">
                    {COULEURS_VOYAGE.map(({ value: c, label }) => (
                      <button key={c} type="button" role="radio" aria-checked={form.color === c}
                        aria-label={label}
                        className={`color-swatch${form.color === c ? ' color-swatch--active' : ''}`}
                        onClick={() => set('color', c)}>
                        <span className="color-swatch__pastille" style={{ background: c }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <span className="form-label" id="nv-emoji">Émoji</span>
                  <div className="emoji-grid" role="radiogroup" aria-labelledby="nv-emoji">
                    {TRIP_EMOJIS.map(em => (
                      <button key={em} type="button" role="radio" aria-checked={form.emoji === em}
                        aria-label={`Émoji ${em}`}
                        className={`emoji-option${form.emoji === em ? ' selected' : ''}`}
                        onClick={() => set('emoji', em)}>
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <span className="form-label">Photo de couverture</span>
                  {form.coverPhoto ? (
                    <div className="cover-photo-preview">
                      <ImagePiece valeur={form.coverPhoto} alt="" className="cover-photo-preview__img" />
                      <button type="button" className="cover-photo-preview__remove" aria-label="Retirer la photo"
                        onClick={() => set('coverPhoto', null)}><Icone de={X} taille={16} /></button>
                    </div>
                  ) : (
                    <label className="btn btn--secondary nouveau-voyage__photo">
                      <Icone de={Camera} taille={18} /> Choisir une photo
                      <input type="file" accept="image/*" hidden onChange={handleCoverPhoto} />
                    </label>
                  )}
                </div>
              </div>
            )}
            {error && <p className="form-erreur" role="alert">{error}</p>}
          </div>
          <div className="sheet__footer">
            <button type="submit" className="btn btn--primary btn--full">{isEdit ? 'Enregistrer' : 'Créer le voyage'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
