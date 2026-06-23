import { useState } from 'react';

const PACKING_CATS = [
  { id: 'docs',        emoji: '🪪', label: 'Documents' },
  { id: 'vetements',   emoji: '👕', label: 'Vêtements' },
  { id: 'electronique',emoji: '🔌', label: 'Électronique' },
  { id: 'toilette',    emoji: '🧴', label: 'Toilette' },
  { id: 'sante',       emoji: '💊', label: 'Santé' },
  { id: 'autre',       emoji: '🎒', label: 'Autre' },
];

const PRESETS = {
  docs:        ['Passeport', "Carte d'identité", "Billet d'avion", "Réservation hôtel", 'Assurance voyage', 'Permis de conduire', 'Carte bancaire', 'Cash local'],
  vetements:   ['T-shirts', 'Pantalons', 'Sous-vêtements', 'Chaussettes', 'Veste', 'Chaussures confort', 'Tenue de nuit', 'Maillot de bain', 'Lunettes de soleil', 'Chapeau'],
  electronique:['Téléphone', 'Chargeur téléphone', 'Écouteurs', 'Adaptateur prise', 'Power bank', 'Appareil photo', 'Câble USB'],
  toilette:    ['Brosse à dents', 'Dentifrice', 'Shampoing', 'Déodorant', 'Crème solaire', 'Rasoir', 'Trousse de toilette'],
  sante:       ['Médicaments perso', 'Ordonnances', 'Anti-douleur', 'Pansements', 'Désinfectant', 'Anti-nausée'],
  autre:       ['Parapluie', 'Sac à dos', 'Guide de voyage', 'Cadenas', 'Réveil', 'Livre / liseuse'],
};

export default function PackingList({ items = [], onAdd, onToggle, onDelete }) {
  const [activeCat, setActiveCat] = useState('tous');
  const [newText, setNewText] = useState('');
  const [newCat, setNewCat] = useState('autre');
  const [showPresets, setShowPresets] = useState(false);

  const checkedCount = items.filter(i => i.checked).length;
  const total = items.length;
  const pct = total > 0 ? Math.round(checkedCount / total * 100) : 0;

  const filtered = activeCat === 'tous' ? items : items.filter(i => i.category === activeCat);
  const presetCat = activeCat === 'tous' ? 'autre' : activeCat;
  const availablePresets = (PRESETS[presetCat] || []).filter(
    p => !items.some(i => i.text.toLowerCase() === p.toLowerCase())
  );

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    onAdd(text, newCat);
    setNewText('');
  };

  return (
    <div className="packing-list">
      <div className="packing-list__progress-wrap">
        <div className="packing-list__progress-track">
          <div className="packing-list__progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="packing-list__progress-label">
          {total === 0 ? 'Aucun article' : `${checkedCount} / ${total} préparé${checkedCount > 1 ? 's' : ''} · ${pct}%`}
        </span>
      </div>

      <div className="packing-list__cats">
        <button
          className={`packing-cat-btn${activeCat === 'tous' ? ' packing-cat-btn--active' : ''}`}
          onClick={() => setActiveCat('tous')}
        >
          Tout{total > 0 ? ` (${total})` : ''}
        </button>
        {PACKING_CATS.map(cat => {
          const count = items.filter(i => i.category === cat.id).length;
          return (
            <button
              key={cat.id}
              className={`packing-cat-btn${activeCat === cat.id ? ' packing-cat-btn--active' : ''}`}
              onClick={() => setActiveCat(cat.id)}
            >
              {cat.emoji}{count > 0 ? ` ${count}` : ''}
            </button>
          );
        })}
      </div>

      <div className="packing-list__items">
        {filtered.length === 0 ? (
          <div className="packing-list__empty">
            {activeCat === 'tous'
              ? <span>Ajoutez vos affaires à emporter ✈️</span>
              : <span>Aucun article dans cette catégorie</span>
            }
          </div>
        ) : (
          filtered.map(item => {
            const catMeta = PACKING_CATS.find(c => c.id === item.category);
            return (
              <div key={item.id} className={`packing-item${item.checked ? ' packing-item--done' : ''}`}>
                <button className="packing-item__check" onClick={() => onToggle(item.id)}>
                  {item.checked ? '✅' : '⬜'}
                </button>
                <span className="packing-item__text">{item.text}</span>
                <span className="packing-item__cat-emoji" title={catMeta?.label}>{catMeta?.emoji || '🎒'}</span>
                <button className="packing-item__delete" onClick={() => onDelete(item.id)}>✕</button>
              </div>
            );
          })
        )}
      </div>

      <div className="packing-list__add">
        <select
          className="form-select packing-list__add-cat"
          value={newCat}
          onChange={e => setNewCat(e.target.value)}
        >
          {PACKING_CATS.map(c => (
            <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
          ))}
        </select>
        <input
          className="form-input packing-list__add-input"
          placeholder="Ajouter un article…"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn btn--primary btn--sm" onClick={handleAdd} disabled={!newText.trim()}>+</button>
      </div>

      <div className="packing-list__presets-section">
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => setShowPresets(s => !s)}
        >
          💡 {showPresets ? 'Masquer suggestions' : 'Suggestions'}
        </button>
        {showPresets && (
          <>
            {availablePresets.length > 0 ? (
              <div className="packing-list__presets">
                {availablePresets.map(p => (
                  <button key={p} className="preset-pill" onClick={() => onAdd(p, presetCat)}>
                    + {p}
                  </button>
                ))}
              </div>
            ) : (
              <p className="packing-list__presets-done">Toutes les suggestions ont été ajoutées ✓</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
