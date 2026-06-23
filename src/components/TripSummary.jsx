import { CATEGORIES, budgetStats, formatPrice, totalMinutes, formatDuration } from '../utils/helpers';

export default function TripSummary({ trip }) {
  const allDayActs = trip.days.flatMap(d => d.activities);
  if (allDayActs.length === 0 && trip.reserve.length === 0) return null;

  const done = allDayActs.filter(a => a.status === 'done').length;
  const total = allDayActs.length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  const stats = budgetStats([...allDayActs, ...trip.reserve]);
  const initBudget = parseFloat(trip.initialBudget) || 0;
  const spentPct = (initBudget > 0 && stats.spent > 0) ? Math.min(stats.spent / initBudget * 100, 100) : 0;
  const showBudget = initBudget > 0 || stats.total > 0;

  const catData = CATEGORIES.map(cat => {
    const count = allDayActs.filter(a => a.category === cat.id).length;
    return { ...cat, count };
  }).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
  const maxCat = catData[0]?.count || 1;

  const dayLoads = trip.days.map((d, i) => ({
    label: `J${i + 1}`,
    count: d.activities.filter(a => a.status !== 'nogo').length,
    mins: totalMinutes(d.activities.filter(a => a.status !== 'nogo')),
  }));
  const maxDay = Math.max(...dayLoads.map(d => d.count), 1);
  const showDayChart = dayLoads.some(d => d.count > 0);

  return (
    <div className="trip-summary">
      <h3 className="trip-summary__title">📊 Résumé</h3>

      {/* Progress */}
      {total > 0 && (
        <div className="trip-summary__card">
          <div className="trip-summary__card-label">Activités planifiées</div>
          <div className="trip-summary__progress-row">
            <div className="trip-summary__track">
              <div className="trip-summary__fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="trip-summary__stat">{done}/{total} · {pct}%</span>
          </div>
        </div>
      )}

      {/* Budget */}
      {showBudget && (
        <div className="trip-summary__card">
          <div className="trip-summary__card-label">Budget</div>
          {initBudget > 0 ? (
            <div className="trip-summary__progress-row">
              <div className="trip-summary__track">
                <div
                  className="trip-summary__fill"
                  style={{
                    width: `${spentPct}%`,
                    background: stats.spent > initBudget ? 'var(--red)' : 'var(--green)',
                  }}
                />
              </div>
              <span className="trip-summary__stat">{formatPrice(stats.spent)} / {formatPrice(initBudget)}</span>
            </div>
          ) : (
            <span className="trip-summary__stat">{formatPrice(stats.total)} planifié</span>
          )}
        </div>
      )}

      {/* By category */}
      {catData.length > 0 && (
        <div className="trip-summary__card">
          <div className="trip-summary__card-label">Par catégorie</div>
          <div className="trip-summary__cats">
            {catData.map(cat => (
              <div key={cat.id} className="trip-summary__cat-row">
                <span className="trip-summary__cat-label">{cat.emoji} {cat.label}</span>
                <div className="trip-summary__cat-track">
                  <div className="trip-summary__cat-bar" style={{ width: `${cat.count / maxCat * 100}%` }} />
                </div>
                <span className="trip-summary__cat-count">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Day load chart */}
      {showDayChart && trip.days.length > 1 && (
        <div className="trip-summary__card">
          <div className="trip-summary__card-label">Charge par jour</div>
          <div className="trip-summary__day-chart">
            {dayLoads.map((d, i) => (
              <div key={i} className="trip-summary__day-col">
                <div className="trip-summary__day-bar-wrap">
                  {d.mins > 0 && (
                    <span className="trip-summary__day-time">{formatDuration(d.mins)}</span>
                  )}
                  <div
                    className="trip-summary__day-bar"
                    style={{ height: `${d.count / maxDay * 100}%` }}
                    title={`${d.count} activité${d.count > 1 ? 's' : ''}`}
                  />
                </div>
                <span className="trip-summary__day-label">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reserve */}
      {trip.reserve.length > 0 && (
        <div className="trip-summary__card trip-summary__card--reserve">
          <span className="trip-summary__card-label">📦 En réserve</span>
          <span className="trip-summary__stat">{trip.reserve.length} idée{trip.reserve.length > 1 ? 's' : ''} non assignée{trip.reserve.length > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
