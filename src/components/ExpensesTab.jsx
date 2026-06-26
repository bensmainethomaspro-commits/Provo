import { useState, useRef } from 'react';
import { formatPrice, CATEGORIES, formatDateShort } from '../utils/helpers';
import { useCurrencyRates, SUPPORTED_CURRENCIES } from '../hooks/useCurrencyRates';
import TravelerBalanceSheet from './TravelerBalanceSheet';
import SpinWheel from './SpinWheel';

function SwipeableExpenseItem({ exp, onDelete, children }) {
  const [offset, setOffset] = useState(0);
  const swRef = useRef({ startX: null, startY: null, dragging: false });
  const THRESHOLD = 72;
  const MAX = 88;

  const onTouchStart = (e) => {
    swRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, dragging: false };
  };
  const onTouchMove = (e) => {
    const s = swRef.current;
    if (s.startX === null) return;
    const dx = e.touches[0].clientX - s.startX;
    const dy = Math.abs(e.touches[0].clientY - s.startY);
    if (!s.dragging) {
      if (dx < -8 && Math.abs(dx) > dy) s.dragging = true;
      else if (dy > 8 || dx > 0) { s.startX = null; return; }
      else return;
    }
    e.stopPropagation();
    setOffset(Math.max(-MAX, Math.min(0, dx)));
  };
  const onTouchEnd = () => {
    swRef.current.startX = null;
    if (offset < -THRESHOLD) { onDelete(); setOffset(0); }
    else setOffset(0);
  };

  return (
    <div className="expense-item-swipe" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="expense-item-swipe__delete" onClick={onDelete}>🗑️ Supprimer</div>
      <div
        style={{ transform: `translateX(${offset}px)`, transition: swRef.current.dragging ? 'none' : 'transform 0.2s ease', position: 'relative' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

function calcDebts(expenses, travelers) {
  if (!travelers.length) return [];
  const bal = {};
  travelers.forEach(t => { bal[t.id] = 0; });

  expenses.forEach(exp => {
    const n = exp.participantIds.length;
    if (!n) return;
    const eurAmount = exp.eurAmount ?? exp.amount;
    const share = eurAmount / n;
    bal[exp.payerId] = (bal[exp.payerId] || 0) + eurAmount;
    exp.participantIds.forEach(id => { bal[id] = (bal[id] || 0) - share; });
  });

  const creditors = Object.entries(bal).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  const debtors = Object.entries(bal).filter(([, v]) => v < -0.005).sort((a, b) => a[1] - b[1]);

  const transfers = [];
  let ci = 0, di = 0;
  const cr = creditors.map(([id, v]) => ({ id, v }));
  const dr = debtors.map(([id, v]) => ({ id, v }));

  while (ci < cr.length && di < dr.length) {
    const amount = Math.min(cr[ci].v, -dr[di].v);
    if (amount > 0.005) {
      transfers.push({ from: dr[di].id, to: cr[ci].id, amount: Math.round(amount * 100) / 100 });
    }
    cr[ci].v -= amount;
    dr[di].v += amount;
    if (cr[ci].v < 0.005) ci++;
    if (dr[di].v > -0.005) di++;
  }
  return transfers;
}

function calcBalances(expenses, travelers) {
  const bal = {};
  travelers.forEach(t => { bal[t.id] = 0; });
  expenses.forEach(exp => {
    const n = exp.participantIds.length;
    if (!n) return;
    const eurAmount = exp.eurAmount ?? exp.amount;
    const share = eurAmount / n;
    bal[exp.payerId] = (bal[exp.payerId] || 0) + eurAmount;
    exp.participantIds.forEach(id => { bal[id] = (bal[id] || 0) - share; });
  });
  return bal;
}

const EXPENSE_CATEGORIES = [
  { id: 'transport', emoji: '🚗', label: 'Transport' },
  { id: 'hebergement', emoji: '🏨', label: 'Hébergement' },
  { id: 'repas', emoji: '🍽️', label: 'Repas' },
  { id: 'activite', emoji: '🎯', label: 'Activité' },
  { id: 'shopping', emoji: '🛍️', label: 'Shopping' },
  { id: 'autre', emoji: '💳', label: 'Autre' },
];

const BLANK = { description: '', amount: '', payerId: '', participantIds: [], activityId: '', currency: 'EUR', expenseCategory: 'autre' };

const CAT_COLORS = ['#FF6B35', '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#06b6d4'];

function DonutChart({ byCategory, total }) {
  if (!byCategory.length || total === 0) return null;
  const R = 44, CX = 64, CY = 64, SW = 22;
  const CIRC = 2 * Math.PI * R;
  const GAP = 3;

  let arcPos = 0;
  const segs = byCategory.map((c, i) => {
    const frac = c.total / total;
    const len = Math.max(1, frac * CIRC - GAP);
    const start = arcPos;
    arcPos += frac * CIRC;
    return { ...c, len, start, color: CAT_COLORS[i % CAT_COLORS.length] };
  });

  const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n);

  return (
    <div className="donut-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <g transform={`rotate(-90 ${CX} ${CY})`}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border)" strokeWidth={SW} />
          {segs.map((s, i) => (
            <circle
              key={i}
              cx={CX} cy={CY} r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={SW}
              strokeDasharray={`${s.len} ${CIRC}`}
              strokeDashoffset={-s.start}
            />
          ))}
        </g>
        <text x={CX} y={CY - 5} textAnchor="middle" fontSize="14" fontWeight="800"
          fill="var(--text)" style={{ fontFamily: '-apple-system,sans-serif' }}>
          {fmt(total)}€
        </text>
        <text x={CX} y={CY + 12} textAnchor="middle" fontSize="10"
          fill="var(--text-muted)" style={{ fontFamily: '-apple-system,sans-serif' }}>
          total
        </text>
      </svg>
      <div className="donut-legend">
        {segs.map((s, i) => (
          <div key={i} className="donut-legend-item">
            <span className="donut-legend-dot" style={{ background: s.color }} />
            <span className="donut-legend-label">{s.emoji} {s.label}</span>
            <span className="donut-legend-pct">{Math.round((s.total / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ExpensesTab({ trip, onAddExpense, onDeleteExpense, onDeleteTraveler }) {
  const travelers = trip.tripTravelers || [];
  const expenses = trip.expenses || [];
  const allActivities = trip.days.flatMap(d => d.activities);
  const activitiesByDay = trip.days.map((d, i) => ({ day: d, dayIdx: i })).filter(({ day }) => day.activities.length > 0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('list'); // 'list' | 'categories' | 'travelers'
  const [selectedTraveler, setSelectedTraveler] = useState(null);
  const [showSpinWheel, setShowSpinWheel] = useState(false);
  const [showDebtDetail, setShowDebtDetail] = useState(false);
  const { convertToEur } = useCurrencyRates();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const getName = (id) => travelers.find(t => t.id === id)?.name || id;
  const getEmoji = (id) => travelers.find(t => t.id === id)?.emoji || '👤';

  const toggleParticipant = (id) => {
    const ids = form.participantIds;
    set('participantIds', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const openForm = () => {
    setForm({ ...BLANK, payerId: travelers[0]?.id || '', participantIds: travelers.map(t => t.id), currency: 'EUR' });
    setError('');
    setShowForm(true);
  };

  const handleAdd = () => {
    if (!form.description.trim()) { setError('Décris la dépense.'); return; }
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError('Montant invalide.'); return; }
    if (!form.payerId) { setError('Qui a payé ?'); return; }
    if (!form.participantIds.length) { setError('Qui participe ?'); return; }
    const eurAmount = form.currency === 'EUR' ? amount : convertToEur(amount, form.currency);
    onAddExpense({
      ...form,
      amount,
      eurAmount: Math.round(eurAmount * 100) / 100,
      description: form.description.trim(),
    });
    setShowForm(false);
  };

  const handleSettleDebt = (d) => {
    onAddExpense({
      description: 'Remboursement',
      amount: d.amount,
      eurAmount: d.amount,
      payerId: d.from,
      participantIds: [d.to],
      currency: 'EUR',
      expenseCategory: 'autre',
      isSettlement: true,
    });
  };

  const totalSpent = expenses.reduce((s, e) => s + (e.eurAmount ?? e.amount), 0);
  const tripBudget = parseFloat(trip.initialBudget) || 0;
  const budgetOver = tripBudget > 0 && totalSpent > tripBudget;
  const debts = calcDebts(expenses, travelers);
  const balances = calcBalances(expenses, travelers);

  // Category breakdown
  const byCategory = EXPENSE_CATEGORIES.map(cat => {
    const total = expenses
      .filter(e => e.expenseCategory === cat.id)
      .reduce((s, e) => s + (e.eurAmount ?? e.amount), 0);
    return { ...cat, total };
  }).filter(c => c.total > 0);

  // Per-traveler totals
  const travelerTotals = travelers.map(t => {
    const paid = expenses
      .filter(e => e.payerId === t.id)
      .reduce((s, e) => s + (e.eurAmount ?? e.amount), 0);
    const share = expenses.reduce((s, e) => {
      if (!e.participantIds.includes(t.id)) return s;
      return s + (e.eurAmount ?? e.amount) / (e.participantIds.length || 1);
    }, 0);
    return { ...t, paid, share, balance: paid - share };
  });

  if (!travelers.length) {
    return (
      <div className="expenses-empty">
        <div className="expenses-empty__icon">💸</div>
        <p className="expenses-empty__text">Ajoute des voyageurs dans <strong>⚙️ Paramètres du voyage</strong> pour gérer les dépenses partagées.</p>
      </div>
    );
  }

  return (
    <div className="expenses-tab">
      {selectedTraveler && (
        <TravelerBalanceSheet
          traveler={selectedTraveler}
          travelers={travelers}
          expenses={expenses}
          debts={debts}
          onClose={() => setSelectedTraveler(null)}
          onDelete={(id) => { onDeleteTraveler?.(id); setSelectedTraveler(null); }}
        />
      )}
      {showSpinWheel && (
        <SpinWheel
          travelers={travelers}
          onClose={() => setShowSpinWheel(false)}
        />
      )}
      {/* Budget alert */}
      {budgetOver && (
        <div className="budget-alert">
          🚨 Budget dépassé ! ({formatPrice(totalSpent)} / {formatPrice(tripBudget)})
        </div>
      )}

      {/* Summary */}
      {expenses.length > 0 && (
        <div className="expenses-summary">
          <div className="expenses-summary__total">
            <span className="expenses-summary__label">Total dépensé</span>
            <span className="expenses-summary__amount">{formatPrice(totalSpent)}</span>
          </div>
          {tripBudget > 0 && (
            <div className="expenses-summary__budget">
              <div className="expenses-budget-bar">
                <div className="expenses-budget-fill" style={{
                  width: `${Math.min(100, (totalSpent / tripBudget) * 100)}%`,
                  background: budgetOver ? 'var(--red)' : 'var(--green)'
                }} />
              </div>
              <span className="expenses-summary__per">{formatPrice(tripBudget - totalSpent > 0 ? tripBudget - totalSpent : totalSpent - tripBudget)} {budgetOver ? 'de dépassement' : 'restants'}</span>
            </div>
          )}
          <div className="expenses-summary__per">
            soit {formatPrice(totalSpent / travelers.length)} par personne
          </div>
        </div>
      )}

      {/* Section tabs */}
      {expenses.length > 0 && (
        <div className="expenses-sections">
          <button className={`expenses-section-btn${activeSection === 'list' ? ' active' : ''}`} onClick={() => setActiveSection('list')}>
            📋 Liste
          </button>
          <button className={`expenses-section-btn${activeSection === 'categories' ? ' active' : ''}`} onClick={() => setActiveSection('categories')}>
            📊 Catégories
          </button>
          {travelers.length > 0 && (
            <button className={`expenses-section-btn${activeSection === 'travelers' ? ' active' : ''}`} onClick={() => setActiveSection('travelers')}>
              👥 Par personne
            </button>
          )}
        </div>
      )}

      {/* Debt settlement */}
      {debts.length > 0 && (
        <div className="debts-card">
          <div className="debts-card__header">
            <div className="debts-card__title">💳 Remboursements</div>
            <button className="debts-card__detail-btn" onClick={() => setShowDebtDetail(o => !o)}>
              {showDebtDetail ? '▲ Masquer' : '▼ Détail'}
            </button>
          </div>
          {debts.map((d, i) => (
            <div key={i} className="debt-row">
              <span className="debt-emoji">{getEmoji(d.from)}</span>
              <span className="debt-from">{getName(d.from)}</span>
              <span className="debt-arrow">→</span>
              <span className="debt-amount">{formatPrice(d.amount)}</span>
              <span className="debt-arrow">→</span>
              <span className="debt-emoji">{getEmoji(d.to)}</span>
              <span className="debt-to">{getName(d.to)}</span>
              <button className="debt-settle-btn" onClick={() => handleSettleDebt(d)} title="Marquer comme remboursé">✅</button>
            </div>
          ))}
          {showDebtDetail && (
            <div className="debt-detail">
              <div className="debt-detail__title">📊 Soldes individuels</div>
              {travelers.map(t => {
                const b = Math.round((balances[t.id] || 0) * 100) / 100;
                return (
                  <div key={t.id} className="debt-detail__row">
                    <span className="debt-detail__person">{t.emoji} {t.name}</span>
                    <span className={`debt-detail__bal${b >= 0 ? ' debt-detail__bal--pos' : ' debt-detail__bal--neg'}`}>
                      {b >= 0 ? '+' : ''}{formatPrice(b)}
                    </span>
                  </div>
                );
              })}
              <div className="debt-detail__note">Positif = à recevoir · Négatif = à rembourser</div>
            </div>
          )}
        </div>
      )}
      {expenses.length > 0 && debts.length === 0 && (
        <div className="debts-card debts-card--settled">✅ Tout est équilibré !</div>
      )}

      {/* Category breakdown */}
      {activeSection === 'categories' && (
        <div className="expense-categories">
          {byCategory.length === 0 ? (
            <p className="expenses-list__empty">Aucune catégorie à afficher.</p>
          ) : (
            <>
              <DonutChart byCategory={byCategory} total={totalSpent} />
              <div className="expense-cat-list">
                {byCategory.map((cat, i) => (
                  <div key={cat.id} className="expense-cat-row">
                    <span className="expense-cat-dot" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
                    <span className="expense-cat-emoji">{cat.emoji}</span>
                    <span className="expense-cat-name">{cat.label}</span>
                    <div className="expense-cat-bar-wrap">
                      <div className="expense-cat-bar" style={{ width: `${(cat.total / totalSpent) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                    </div>
                    <span className="expense-cat-amount">{formatPrice(cat.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Per-traveler */}
      {activeSection === 'travelers' && (
        <div className="traveler-summary">
          <button className="spinwheel-trigger-btn" onClick={() => setShowSpinWheel(true)}>
            🎰 Roue de la fortune — qui paie ?
          </button>
          {travelerTotals.map(t => {
            const myOwes = debts.filter(d => d.from === t.id);
            const myOwed = debts.filter(d => d.to === t.id);
            return (
              <button key={t.id} className="traveler-card" onClick={() => setSelectedTraveler(t)}>
                <span className="traveler-card__avatar">{t.emoji}</span>
                <div className="traveler-card__info">
                  <div className="traveler-card__name">{t.name}</div>
                  <div className="traveler-card__detail">
                    {myOwes.length > 0
                      ? `Doit ${myOwes.reduce((s, d) => s + d.amount, 0).toFixed(2)}€`
                      : myOwed.length > 0
                        ? `À recevoir ${myOwed.reduce((s, d) => s + d.amount, 0).toFixed(2)}€`
                        : 'Équilibré ✅'
                    }
                  </div>
                </div>
                <span className={`traveler-card__balance${t.balance >= 0 ? ' traveler-card__balance--pos' : ' traveler-card__balance--neg'}`}>
                  {t.balance >= 0 ? '+' : ''}{formatPrice(t.balance)}
                </span>
                <span className="traveler-card__chevron">›</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Expense list */}
      {activeSection === 'list' && (
        <div className="expenses-list">
          {expenses.length === 0 && !showForm && (
            <div className="expenses-list__empty">Aucune dépense enregistrée.</div>
          )}
          {expenses.map(exp => {
            const n = exp.participantIds.length;
            const eurAmt = exp.eurAmount ?? exp.amount;
            const share = n > 0 ? eurAmt / n : eurAmt;
            const catMeta = EXPENSE_CATEGORIES.find(c => c.id === exp.expenseCategory) || EXPENSE_CATEGORIES[5];
            return (
              <SwipeableExpenseItem key={exp.id} exp={exp} onDelete={() => onDeleteExpense(exp.id)}>
                <div className="expense-item">
                  <div className="expense-item__main">
                    <span className="expense-item__emoji">{catMeta.emoji}</span>
                    <div className="expense-item__info">
                      <div className="expense-item__desc">{exp.description}</div>
                      <div className="expense-item__meta">
                        {getName(exp.payerId)} a payé{' '}
                        <strong>
                          {exp.currency && exp.currency !== 'EUR'
                            ? `${exp.amount} ${exp.currency} (≈ ${formatPrice(eurAmt)})`
                            : formatPrice(eurAmt)
                          }
                        </strong>
                        {n > 0 && ` · ${formatPrice(share)}/pers.`}
                        {exp.activityId && (() => {
                          const act = allActivities.find(a => a.id === exp.activityId);
                          return act ? <span className="expense-item__linked"> · 🔗 {act.title}</span> : null;
                        })()}
                      </div>
                      {n > 0 && (
                        <div className="expense-item__participants">
                          {exp.participantIds.map(id => <span key={id} className="expense-participant">{getEmoji(id)}</span>)}
                        </div>
                      )}
                    </div>
                  <button
                    className="expense-item__delete"
                    onClick={e => { e.stopPropagation(); onDeleteExpense(exp.id); }}
                    title="Supprimer"
                  >🗑️</button>
                  </div>
                </div>
              </SwipeableExpenseItem>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showForm ? (
        <div className="expense-form">
          <div className="form-group">
            <label className="form-label">Description</label>
            <input className="form-input" placeholder="Ex: Resto du soir" value={form.description}
              onChange={e => set('description', e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Catégorie</label>
            <div className="traveler-assign-row" style={{ flexWrap: 'wrap' }}>
              {EXPENSE_CATEGORIES.map(cat => (
                <button key={cat.id} type="button"
                  className={`traveler-assign-chip${form.expenseCategory === cat.id ? ' traveler-assign-chip--on' : ''}`}
                  onClick={() => set('expenseCategory', cat.id)}>
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Montant</label>
              <input className="form-input" type="number" min="0" step="0.5" placeholder="0.00"
                value={form.amount} onChange={e => set('amount', e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Devise</label>
              <select className="form-select" value={form.currency} onChange={e => set('currency', e.target.value)}>
                {SUPPORTED_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>
                ))}
              </select>
            </div>
          </div>
          {form.currency !== 'EUR' && form.amount && (
            <div className="currency-hint">
              ≈ {formatPrice(convertToEur(parseFloat(form.amount) || 0, form.currency))}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Qui a payé ?</label>
            <div className="traveler-assign-row">
              {travelers.map(t => (
                <button key={t.id} type="button"
                  className={`traveler-assign-chip${form.payerId === t.id ? ' traveler-assign-chip--on' : ''}`}
                  onClick={() => set('payerId', t.id)}>
                  {t.emoji} {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Pour qui ?</label>
            <div className="traveler-assign-row">
              {travelers.map(t => (
                <button key={t.id} type="button"
                  className={`traveler-assign-chip${form.participantIds.includes(t.id) ? ' traveler-assign-chip--on' : ''}`}
                  onClick={() => toggleParticipant(t.id)}>
                  {t.emoji} {t.name}
                </button>
              ))}
            </div>
          </div>
          {activitiesByDay.length > 0 && (
            <div className="form-group">
              <label className="form-label">Lier à une activité <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>— optionnel</span></label>
              <select className="form-select" value={form.activityId} onChange={e => set('activityId', e.target.value)}>
                <option value="">— aucune —</option>
                {activitiesByDay.map(({ day, dayIdx }) => (
                  <optgroup key={day.id} label={`Jour ${dayIdx + 1} · ${formatDateShort(day.date)}`}>
                    {day.activities.map(a => (
                      <option key={a.id} value={a.id}>{a.title}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--secondary btn--full" onClick={() => setShowForm(false)}>Annuler</button>
            <button className="btn btn--primary btn--full" onClick={handleAdd}>✅ Ajouter</button>
          </div>
        </div>
      ) : (
        <button className="btn btn--primary" style={{ width: '100%', marginTop: 8 }} onClick={openForm}>
          + Ajouter une dépense
        </button>
      )}
    </div>
  );
}
