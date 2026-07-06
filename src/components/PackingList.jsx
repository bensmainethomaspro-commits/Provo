import { useState, useRef, useEffect, useMemo } from 'react';
import { suggestSmartPacking } from '../utils/packingSuggest';

const PACKING_CATS = [
  { id: 'docs',         emoji: '🪪', label: 'Documents',   color: '#3b82f6' },
  { id: 'vetements',    emoji: '👕', label: 'Vêtements',   color: '#8b5cf6' },
  { id: 'electronique', emoji: '🔌', label: 'Électronique', color: '#f59e0b' },
  { id: 'toilette',     emoji: '🧴', label: 'Toilette',    color: '#06b6d4' },
  { id: 'sante',        emoji: '💊', label: 'Santé',       color: '#ef4444' },
  { id: 'autre',        emoji: '🎒', label: 'Autre',       color: '#22c55e' },
];

const PRESETS = {
  docs:        ['Passeport', "Carte d'identité", "Billet d'avion", "Réservation hôtel", 'Assurance voyage', 'Permis de conduire', 'Carte bancaire', 'Cash local'],
  vetements:   ['T-shirts', 'Pantalons', 'Sous-vêtements', 'Chaussettes', 'Veste', 'Chaussures confort', 'Tenue de nuit', 'Maillot de bain', 'Lunettes de soleil', 'Chapeau'],
  electronique:['Téléphone', 'Chargeur téléphone', 'Écouteurs', 'Adaptateur prise', 'Power bank', 'Appareil photo', 'Câble USB'],
  toilette:    ['Brosse à dents', 'Dentifrice', 'Shampoing', 'Déodorant', 'Crème solaire', 'Rasoir', 'Trousse de toilette'],
  sante:       ['Médicaments perso', 'Ordonnances', 'Anti-douleur', 'Pansements', 'Désinfectant', 'Anti-nausée'],
  autre:       ['Parapluie', 'Sac à dos', 'Guide de voyage', 'Cadenas', 'Réveil', 'Livre / liseuse'],
};

function ItemRow({ item, onToggle, onDelete, onDragStart, onDragOver, onDrop, onDragEnd, isDragging, isDragOver }) {
  const catMeta = PACKING_CATS.find(c => c.id === item.category);
  return (
    <div
      className={[
        'packing-item',
        item.checked ? 'packing-item--done' : '',
        isDragging ? 'packing-item--dragging' : '',
        isDragOver ? 'packing-item--drag-over' : '',
      ].filter(Boolean).join(' ')}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{ '--cat-color': catMeta?.color || '#999' }}
    >
      <button
        className="packing-item__check"
        onClick={() => onToggle(item.id)}
        aria-label={item.checked ? 'Décocher' : 'Cocher'}
      >
        <span className={`packing-item__check-icon${item.checked ? ' packing-item__check-icon--done' : ''}`}>
          {item.checked ? '✓' : ''}
        </span>
      </button>
      <span className={`packing-item__cat-dot`} style={{ background: catMeta?.color }} title={catMeta?.label} />
      <span className="packing-item__text">{item.text}</span>
      <span className="packing-item__cat-emoji">{catMeta?.emoji || '🎒'}</span>
      <button className="packing-item__delete" onClick={() => onDelete(item.id)} aria-label="Supprimer">✕</button>
    </div>
  );
}

function HamburgerIcon() {
  return (
    <div className="hamburger-icon">
      <span className="hamburger-icon__line hamburger-icon__line--1" />
      <span className="hamburger-icon__line hamburger-icon__line--2" />
      <span className="hamburger-icon__line hamburger-icon__line--3" />
    </div>
  );
}

export default function PackingList({ items = [], onAdd, onToggle, onDelete, onReorder, trip, weatherByDate }) {
  const [activeCat, setActiveCat] = useState('tous');
  const [smartOpen, setSmartOpen] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [collapsedCats, setCollapsedCats] = useState(new Set());
  const [newText, setNewText] = useState('');
  const [newCat, setNewCat] = useState('autre');
  const [showPresets, setShowPresets] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const filterRef = useRef(null);

  const checkedCount = items.filter(i => i.checked).length;
  const total = items.length;
  const pct = total > 0 ? Math.round(checkedCount / total * 100) : 0;

  const filtered = activeCat === 'tous' ? items : items.filter(i => i.category === activeCat);

  // Suggestions contextuelles (météo + activités), sans doublon avec la liste.
  const smartSuggestions = useMemo(() => {
    const all = suggestSmartPacking(trip, weatherByDate);
    return all.filter(s => !items.some(i => i.text.toLowerCase() === s.text.toLowerCase()));
  }, [trip, weatherByDate, items]);
  const presetCat = activeCat === 'tous' ? 'autre' : activeCat;
  const availablePresets = (PRESETS[presetCat] || []).filter(
    p => !items.some(i => i.text.toLowerCase() === p.toLowerCase())
  );

  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [filterOpen]);

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    onAdd(text, newCat);
    setNewText('');
  };

  const toggleCatCollapse = (catId) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  const handleDragStart = (e, itemId) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragId(itemId);
  };
  const handleDragOver = (e, itemId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(itemId);
  };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const newList = [...items];
    const fromIdx = newList.findIndex(i => i.id === dragId);
    const toIdx = newList.findIndex(i => i.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = newList.splice(fromIdx, 1);
    newList.splice(toIdx, 0, moved);
    onReorder?.(newList);
    setDragId(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => { setDragId(null); setDragOverId(null); };

  const itemProps = (item) => ({
    item, onToggle, onDelete,
    isDragging: dragId === item.id,
    isDragOver: dragOverId === item.id && dragId !== item.id,
    onDragStart: (e) => handleDragStart(e, item.id),
    onDragOver: (e) => handleDragOver(e, item.id),
    onDrop: (e) => handleDrop(e, item.id),
    onDragEnd: handleDragEnd,
  });

  const renderItems = (list) => list.map(item => (
    <ItemRow key={item.id} {...itemProps(item)} />
  ));

  const renderGrouped = () => {
    const visibleCats = PACKING_CATS.filter(cat => filtered.some(i => i.category === cat.id));
    const uncategorized = filtered.filter(i => !PACKING_CATS.find(c => c.id === i.category));
    return (
      <>
        {visibleCats.map(cat => {
          const catItems = filtered.filter(i => i.category === cat.id);
          const collapsed = collapsedCats.has(cat.id);
          const catDone = catItems.filter(i => i.checked).length;
          return (
            <div key={cat.id} className="packing-group">
              <button className="packing-group__header" onClick={() => toggleCatCollapse(cat.id)}
                style={{ '--cat-color': cat.color }}>
                <span className="packing-group__dot" style={{ background: cat.color }} />
                <span className="packing-group__emoji">{cat.emoji}</span>
                <span className="packing-group__label">{cat.label}</span>
                <span className="packing-group__count">{catDone}/{catItems.length}</span>
                <span className="packing-group__chevron">{collapsed ? '›' : '⌄'}</span>
              </button>
              {!collapsed && renderItems(catItems)}
            </div>
          );
        })}
        {uncategorized.length > 0 && renderItems(uncategorized)}
      </>
    );
  };

  const activeCatMeta = PACKING_CATS.find(c => c.id === activeCat);

  return (
    <div className="packing-list">
      {/* Progress ring + stats */}
      <div className="packing-list__hero">
        <div className="packing-ring-wrap">
          <svg className="packing-ring" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="32" className="packing-ring__track" />
            <circle cx="40" cy="40" r="32" className="packing-ring__fill"
              style={{
                strokeDasharray: `${2 * Math.PI * 32}`,
                strokeDashoffset: `${2 * Math.PI * 32 * (1 - pct / 100)}`,
              }}
            />
          </svg>
          <div className="packing-ring__pct">{pct}%</div>
        </div>
        <div className="packing-list__hero-stats">
          <div className="packing-list__hero-title">
            {total === 0 ? 'Valise vide' : pct === 100 ? '🎉 Tout prêt !' : pct > 50 ? 'Bonne progression !' : 'En cours...'}
          </div>
          <div className="packing-list__hero-sub">
            {total === 0 ? 'Commençons à préparer' : `${checkedCount} / ${total} article${total > 1 ? 's' : ''} préparé${checkedCount > 1 ? 's' : ''}`}
          </div>
          {total > 0 && (
            <div className="packing-list__cat-pills">
              {PACKING_CATS.filter(c => items.some(i => i.category === c.id)).map(c => {
                const done = items.filter(i => i.category === c.id && i.checked).length;
                const tot = items.filter(i => i.category === c.id).length;
                return (
                  <span key={c.id} className="packing-cat-pill" style={{ background: c.color + '22', color: c.color }}>
                    {c.emoji} {done}/{tot}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Valise intelligente : suggestions météo + activités */}
      {smartSuggestions.length > 0 && (
        <div className="smart-packing">
          <button className="smart-packing__header" onClick={() => setSmartOpen(o => !o)}>
            <span className="smart-packing__title">✨ Suggéré pour ce voyage</span>
            <span className="smart-packing__count">{smartSuggestions.length}</span>
            <span className="smart-packing__chevron">{smartOpen ? '⌄' : '›'}</span>
          </button>
          {smartOpen && (
            <>
              <div className="smart-packing__pills">
                {smartSuggestions.map(s => (
                  <button
                    key={s.text}
                    className="smart-pill"
                    onClick={() => onAdd(s.text, s.category)}
                    title={s.reason}
                  >
                    <span className="smart-pill__plus">+</span>
                    <span className="smart-pill__text">{s.text}</span>
                    <span className="smart-pill__reason">{s.reason}</span>
                  </button>
                ))}
              </div>
              <button
                className="btn btn--secondary btn--sm smart-packing__all"
                onClick={() => smartSuggestions.forEach(s => onAdd(s.text, s.category))}
              >
                Tout ajouter ({smartSuggestions.length})
              </button>
            </>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="packing-list__toolbar">
        <div className="packing-filter-wrap" ref={filterRef}>
          <button
            className={`packing-filter-btn${filterOpen ? ' packing-filter-btn--open' : ''}`}
            onClick={() => setFilterOpen(o => !o)}
            aria-label="Filtrer par catégorie"
            title="Filtrer par catégorie"
          >
            <HamburgerIcon />
            {activeCat !== 'tous' && (
              <span className="packing-filter-btn__label">
                {activeCatMeta?.emoji} {activeCatMeta?.label}
              </span>
            )}
          </button>
          {filterOpen && (
            <div className="packing-filter-menu">
              <button
                className={`packing-filter-menu__item${activeCat === 'tous' ? ' packing-filter-menu__item--active' : ''}`}
                onClick={() => { setActiveCat('tous'); setFilterOpen(false); }}
              >
                🎒 Tout {total > 0 && <span className="packing-filter-menu__count">{total}</span>}
              </button>
              {PACKING_CATS.map(cat => {
                const count = items.filter(i => i.category === cat.id).length;
                const done = items.filter(i => i.category === cat.id && i.checked).length;
                return (
                  <button
                    key={cat.id}
                    className={`packing-filter-menu__item${activeCat === cat.id ? ' packing-filter-menu__item--active' : ''}`}
                    style={{ '--cat-color': cat.color }}
                    onClick={() => { setActiveCat(cat.id); setFilterOpen(false); }}
                  >
                    <span className="packing-filter-menu__dot" style={{ background: cat.color }} />
                    {cat.emoji} {cat.label}
                    {count > 0 && <span className="packing-filter-menu__count">{done}/{count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          className={`btn btn--sm ${grouped ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setGrouped(g => !g)}
          title={grouped ? 'Vue plate' : 'Grouper par catégorie'}
        >
          {grouped ? '☰' : '⊞'}
        </button>
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
          grouped ? renderGrouped() : renderItems(filtered)
        )}
      </div>

      <div className="packing-list__add">
        <select
          className="form-select packing-list__add-cat"
          value={newCat}
          onChange={e => setNewCat(e.target.value)}
          style={{ borderLeft: `3px solid ${PACKING_CATS.find(c => c.id === newCat)?.color || '#999'}` }}
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
          💡 {showPresets ? 'Masquer' : 'Suggestions'}
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
