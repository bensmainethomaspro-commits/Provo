import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getCategoryMeta, getDayLabel, formatDateShort, formatPrice } from '../utils/helpers';

// Recherche dans tout le voyage : activités des jours, réserve, dépenses, notes
// et valise. Quand le planning est long, on retrouve une idée par son nom au
// lieu de faire défiler les journées.

// Insensible à la casse ET aux accents (« repas » trouve « Repás », « ecole »
// trouve « école ») — sinon la recherche rate une fois sur deux au clavier
// mobile.
const norm = (s) => (s ?? '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Extrait un morceau de texte autour du mot trouvé, pour que le résultat
// montre le passage qui correspond et pas juste le début de la note.
function excerpt(text, needle) {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  const i = norm(raw).indexOf(needle);
  if (i < 0) return raw.slice(0, 70);
  const start = Math.max(0, i - 25);
  const end = Math.min(raw.length, i + needle.length + 45);
  return (start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '');
}

export default function TripSearch({ trip, onClose, onOpenDay, onOpenReserve, onOpenTab }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    // Le clavier doit s'ouvrir tout de suite : on vient chercher quelque chose.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const res = useMemo(() => {
    const needle = norm(q).trim();
    if (needle.length < 2) return null;
    const hit = (...fields) => fields.some(f => norm(f).includes(needle));

    const dayHits = [];
    trip.days.forEach((day, dayIndex) => {
      day.activities.forEach(a => {
        if (hit(a.title, a.address, a.notes, getCategoryMeta(a.category).label)) {
          dayHits.push({ a, day, dayIndex });
        }
      });
    });

    const reserveHits = trip.reserve.filter(a =>
      hit(a.title, a.address, a.notes, getCategoryMeta(a.category).label));

    const expenseHits = (trip.expenses || []).filter(e => hit(e.description));

    const noteHits = [];
    if (hit(trip.tripNotes)) {
      noteHits.push({ key: 'trip', label: '📝 Notes du voyage', tab: 'notes', text: excerpt(trip.tripNotes, needle) });
    }
    trip.days.forEach((day, i) => {
      if (hit(day.notes)) {
        noteHits.push({
          key: day.id, label: `📝 Note · ${getDayLabel(i, trip.days.length)}`,
          day, text: excerpt(day.notes, needle),
        });
      }
    });

    const packHits = (trip.packingList || []).filter(it => hit(it.text));

    const count = dayHits.length + reserveHits.length + expenseHits.length
      + noteHits.length + packHits.length;
    return { dayHits, reserveHits, expenseHits, noteHits, packHits, count, needle };
  }, [q, trip]);

  // Rendu dans <body> : la feuille doit couvrir l'écran, or un ancêtre animé
  // (transform) redéfinirait le référentiel de `position: fixed`.
  return createPortal(
    <div className="trip-search" role="dialog" aria-modal="true" aria-label="Rechercher dans le voyage">
      <div className="trip-search__bar">
        <span className="trip-search__icon" aria-hidden="true">🔍</span>
        <input
          ref={inputRef}
          className="trip-search__input"
          type="search"
          placeholder="Activité, dépense, note…"
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Rechercher dans le voyage"
        />
        <button className="trip-search__close" onClick={onClose} aria-label="Fermer la recherche">Fermer</button>
      </div>

      <div className="trip-search__body">
        {!res && (
          <p className="trip-search__hint">
            Tape au moins 2 lettres. La recherche couvre les activités, la réserve,
            les dépenses, les notes et la valise.
          </p>
        )}

        {res && res.count === 0 && (
          <p className="trip-search__hint">Aucun résultat pour « {q.trim()} ».</p>
        )}

        {res && res.dayHits.length > 0 && (
          <section className="trip-search__group">
            <h3 className="trip-search__group-title">Planning · {res.dayHits.length}</h3>
            {res.dayHits.map(({ a, day, dayIndex }) => (
              <button key={a.id} className="trip-search__row" onClick={() => onOpenDay(day)}>
                <span className="trip-search__row-emoji">{getCategoryMeta(a.category).emoji}</span>
                <span className="trip-search__row-text">
                  <span className="trip-search__row-title">{a.title}</span>
                  <span className="trip-search__row-sub">
                    {getDayLabel(dayIndex, trip.days.length)} · {formatDateShort(day.date)}
                    {a.address ? ` · ${a.address}` : ''}
                  </span>
                </span>
                <span className="trip-search__row-go" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        )}

        {res && res.reserveHits.length > 0 && (
          <section className="trip-search__group">
            <h3 className="trip-search__group-title">Réserve · {res.reserveHits.length}</h3>
            {res.reserveHits.map(a => (
              <button key={a.id} className="trip-search__row" onClick={() => onOpenReserve(q.trim())}>
                <span className="trip-search__row-emoji">{getCategoryMeta(a.category).emoji}</span>
                <span className="trip-search__row-text">
                  <span className="trip-search__row-title">{a.title}</span>
                  <span className="trip-search__row-sub">
                    Idée en réserve{a.address ? ` · ${a.address}` : ''}
                  </span>
                </span>
                <span className="trip-search__row-go" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        )}

        {res && res.expenseHits.length > 0 && (
          <section className="trip-search__group">
            <h3 className="trip-search__group-title">Dépenses · {res.expenseHits.length}</h3>
            {res.expenseHits.map(e => (
              <button key={e.id} className="trip-search__row" onClick={() => onOpenTab('depenses')}>
                <span className="trip-search__row-emoji">💸</span>
                <span className="trip-search__row-text">
                  <span className="trip-search__row-title">{e.description}</span>
                  <span className="trip-search__row-sub">{formatPrice(e.eurAmount ?? e.amount)}</span>
                </span>
                <span className="trip-search__row-go" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        )}

        {res && res.noteHits.length > 0 && (
          <section className="trip-search__group">
            <h3 className="trip-search__group-title">Notes · {res.noteHits.length}</h3>
            {res.noteHits.map(n => (
              <button
                key={n.key}
                className="trip-search__row"
                onClick={() => n.day ? onOpenDay(n.day) : onOpenTab('notes')}
              >
                <span className="trip-search__row-emoji">📝</span>
                <span className="trip-search__row-text">
                  <span className="trip-search__row-title">{n.label.replace('📝 ', '')}</span>
                  <span className="trip-search__row-sub">{n.text}</span>
                </span>
                <span className="trip-search__row-go" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        )}

        {res && res.packHits.length > 0 && (
          <section className="trip-search__group">
            <h3 className="trip-search__group-title">Valise · {res.packHits.length}</h3>
            {res.packHits.map(it => (
              <button key={it.id} className="trip-search__row" onClick={() => onOpenTab('valise')}>
                <span className="trip-search__row-emoji">{it.checked ? '✅' : '🎒'}</span>
                <span className="trip-search__row-text">
                  <span className="trip-search__row-title">{it.text}</span>
                  <span className="trip-search__row-sub">{it.checked ? 'Déjà dans la valise' : 'À emporter'}</span>
                </span>
                <span className="trip-search__row-go" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>,
    document.body
  );
}
