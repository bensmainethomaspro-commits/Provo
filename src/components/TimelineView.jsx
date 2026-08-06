import { useState, useRef, useEffect } from 'react';
import { useReorderDrag } from '../hooks/useReorderDrag';
import { formatDuration, getDayLabel, formatDateShort, formatPrice, getCategoryMeta, getTimeSlots, lienItineraire, getLogicAlerts } from '../utils/helpers';

// Déplacer une activité : UNE poignée ⠿ (réordonner dans le jour et changer de
// jour) et, dans la fiche dépliée, des pastilles « Déplacer vers » pour ceux qui
// préfèrent taper — c'est aussi le seul chemin vers la Réserve.
//
// Il y en avait quatre : deux poignées ⠿ identiques côte à côte (l'ancienne à
// 1,08:1 de contraste, invisible), un appui long n'importe où, et les pastilles.
// Chaque geste avait été ajouté à côté du précédent au lieu de le remplacer.

function TlActivity({
  activity, slot, dayId, days, onMoveToDay, onMoveToReserve,
  compareMode, compareSelected, onToggleCompare, enVoiture,
}) {
  const [open, setOpen] = useState(false);
  const meta = getCategoryMeta(activity.category);
  const dur = (activity.durationHours || 0) * 60 + (activity.durationMinutes || 0);
  // Replié, on ne montre que l'essentiel (heure + titre). Le détail (durée, prix,
  // adresse) se déroule au tap — moins d'informations affichées d'un coup.
  const hasDetails = dur > 0 || activity.price > 0 || !!activity.address;
  const canMove = !!onMoveToDay && days?.length > 1;
  const canOpen = hasDetails || canMove;
  const itineraire = lienItineraire(activity, { enVoiture });

  return (
    <div
      className={`tl-activity tl-activity--${activity.status}${compareMode && compareSelected ? ' tl-activity--compare-selected' : ''}${open ? ' tl-activity--open' : ''}`}
      data-category={activity.category}
      draggable={!compareMode}
      onDragStart={(e) => {
        if (compareMode) { e.preventDefault(); return; }
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', activity.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        if (compareMode) { e.stopPropagation(); onToggleCompare?.(); return; }
        // Ne pas laisser le tap remonter jusqu'à la carte du jour (qui ouvre la modale)
        e.stopPropagation();
        if (canOpen) setOpen(o => !o);
      }}
    >
      <div className="tl-activity__top">
        {compareMode && (
          <div className={`tl-activity__compare-check${compareSelected ? ' tl-activity__compare-check--on' : ''}`}>
            {compareSelected ? '☑' : '☐'}
          </div>
        )}
        {slot && <span className="tl-activity__time">{slot.start}</span>}
        <span className="tl-activity__emoji">{meta.emoji}</span>
        <span className="tl-activity__title">{activity.title}</span>
        {canOpen && !compareMode && (
          <span className="tl-activity__chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
        )}
      </div>
      {open && hasDetails && (
        <div className="tl-activity__meta">
          {dur > 0 && <span className="tl-activity__dur">⏱ {formatDuration(dur)}</span>}
          {activity.price > 0 && <span className="tl-activity__price">💶 {formatPrice(parseFloat(activity.price))}</span>}
          {activity.address && (itineraire
            ? (
              <a
                className="tl-activity__addr tl-activity__addr--nav"
                href={itineraire}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                aria-label={`Itinéraire vers ${activity.title}`}
              >📍 {activity.address}</a>
            )
            : <span className="tl-activity__addr">📍 {activity.address}</span>
          )}
        </div>
      )}
      {/* Repli sans glisser : un jour se choisit en un tap, ce qui reste le plus
          sûr sur un téléphone où la timeline défile horizontalement. */}
      {open && canMove && (
        <div className="tl-activity__move" onClick={e => e.stopPropagation()}>
          <span className="tl-activity__move-label">Déplacer vers</span>
          <div className="tl-activity__move-pills">
            {days.map((d, i) => d.id === dayId ? null : (
              <button
                key={d.id}
                className="day-pill"
                onClick={() => { setOpen(false); onMoveToDay(dayId, d.id, activity.id); }}
              >J{i + 1}</button>
            ))}
            {onMoveToReserve && (
              <button
                className="day-pill day-pill--reserve"
                onClick={() => { setOpen(false); onMoveToReserve(dayId, activity.id); }}
              >📦 Réserve</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TlDayCard({ day, dayIndex, totalDays, days, onMoveToDay, onMoveToReserve, onOpenDetail, onDrop, compareMode, compareSelectedIds, onToggleCompare, enVoiture, weather, passe, aujourdhui, refJour, onReordonner, reorder }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const active = day.activities.filter(a => a.status !== 'nogo');
  const slots = getTimeSlots(day.activities, day.startTime || '09:00');
  // Une journée qui déborde ou dont deux horaires se chevauchent ne se voyait
  // qu'en ouvrant le détail du jour — il fallait donc soupçonner le problème
  // pour le trouver. Le signal vit maintenant dans la rangée qui porte déjà la
  // météo et les notes : un glyphe de plus, pas un bandeau.
  const soucis = getLogicAlerts(day.activities, slots)
    .filter(a => a.type === 'overload' || a.type === 'conflict');

  const handleDragOver = (e) => {
    if (compareMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const activityId = e.dataTransfer.getData('text/plain');
    if (activityId) onDrop?.(day.id, activityId);
  };

  return (
    <div
      ref={refJour}
      className={`tl-day${isDragOver ? ' tl-day--drop' : ''}${passe ? ' tl-day--passe' : ''}${aujourdhui ? ' tl-day--auj' : ''}`
        + (reorder?.dragId && reorder.sur?.jour === day.id ? ' tl-day--cible' : '')}
      data-drop-zone="true"
      data-zone-type="day"
      data-day-id={day.id}
      onClick={() => !compareMode && onOpenDetail(day)}
      onDragOver={handleDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      <div className="tl-day__header">
        <div className="tl-day__head-main">
          <div className="tl-day__label">{getDayLabel(dayIndex, totalDays)}</div>
          <div className="tl-day__date">{formatDateShort(day.date)}</div>
          <div className="tl-day__stats">
            {/* Le coût par jour a été retiré : il occupait la ligne la plus
                lue de la carte sans jamais servir à décider — le budget se
                suit sur sa pastille et dans l'onglet Dépenses. */}
            {weather && <span>{weather.icon} {weather.max}°/{weather.min}°</span>}
            {soucis.length > 0 && (
              <span
                className="tl-day__souci"
                title={soucis.map(a => a.message).join('\n')}
                aria-label={soucis.map(a => a.message).join(' ')}
              >{soucis[0].icon}</span>
            )}
            {day.notes && <span className="tl-day__note-flag" title="Notes du jour">📝</span>}
            {active.length === 0 && <span className="tl-day__empty-hint">Vide</span>}
          </div>
        </div>
        {!compareMode && <span className="tl-day__open" aria-hidden="true">›</span>}
      </div>
      <div className="tl-day__body">
        {day.activities.length === 0 ? (
          <div className="tl-day__no-act">Aucune activité</div>
        ) : (
          day.activities.map(a => (
            <div
              key={a.id}
              data-reorder-id={onReordonner ? a.id : undefined}
              data-jour-id={day.id}
              className={`tl-act-wrap${reorder.dragId === a.id ? ' tl-act-wrap--drag' : ''}`
                + (reorder.sur?.id === a.id && reorder.dragId !== a.id ? ' tl-act-wrap--cible' : '')}
            >
              {onReordonner && (
                <button
                  className="tl-act-grip"
                  onPointerDown={(e) => reorder.demarrer(a.id, e)}
                  data-jour-source={day.id}
                  aria-label={`Déplacer ${a.title}`}
                >⠿</button>
              )}
            <TlActivity
              activity={a}
              slot={slots[a.id]}
              dayId={day.id}
              days={days}
              onMoveToDay={onMoveToDay}
              onMoveToReserve={onMoveToReserve}
              compareMode={compareMode}
              compareSelected={compareSelectedIds?.has(a.id)}
              onToggleCompare={() => onToggleCompare?.(a.id)}
              enVoiture={enVoiture}
            />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TimelineView({ days, onOpenDetail, onDrop, onMoveToDay, onMoveToReserve, compareMode, compareSelectedIds, onToggleCompare, enVoiture, weatherByDate, onReordonner, onDeplacerEntreJours }) {
  const wrapRef = useRef(null);
  // Un seul glissement pour toute la frise : borné à une journée, il ne pouvait
  // pas traverser, et déplacer une activité au lendemain passait par un menu.
  const reorder = useReorderDrag((id, cible) => {
    const source = days.find(d => (d.activities || []).some(a => a.id === id));
    if (!source) return;
    const jourCible = cible.jour || source.id;
    if (jourCible === source.id) onReordonner?.(source.id, id, cible.id);
    else onDeplacerEntreJours?.(source.id, jourCible, id, cible.id);
  });
  const aujRef = useRef(null);
  const cale = useRef(false);

  const jourJ = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const idxAuj = days.findIndex(d => d.date === jourJ);

  // En voyage, le jour utile est aujourd'hui — pas le premier jour, qui est
  // souvent déjà passé. Les jours écoulés restent à gauche, consultables.
  useEffect(() => {
    if (cale.current || idxAuj < 0) return;
    const el = aujRef.current, wrap = wrapRef.current;
    if (!el || !wrap) return;
    cale.current = true;
    // Sans animation : un défilement au chargement donne l'impression d'un bug.
    wrap.scrollLeft = el.offsetLeft - wrap.offsetLeft;
  }, [idxAuj, days.length]);

  return (
    <div className="timeline-view-wrap" ref={wrapRef}>
      {days.map((day, i) => (
        <TlDayCard
          key={day.id}
          day={day}
          dayIndex={i}
          totalDays={days.length}
          days={days}
          onMoveToDay={onMoveToDay}
          onMoveToReserve={onMoveToReserve}
          onOpenDetail={onOpenDetail}
          onDrop={onDrop}
          compareMode={compareMode}
          compareSelectedIds={compareSelectedIds}
          onToggleCompare={onToggleCompare}
          enVoiture={enVoiture}
          weather={weatherByDate?.[day.date]}
          passe={idxAuj >= 0 && i < idxAuj}
          aujourdhui={i === idxAuj}
          refJour={i === idxAuj ? aujRef : undefined}
          onReordonner={onReordonner}
          reorder={reorder}
        />
      ))}
    </div>
  );
}
