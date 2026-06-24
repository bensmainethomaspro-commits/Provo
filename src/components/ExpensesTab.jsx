import { useState } from 'react';
import { formatPrice } from '../utils/helpers';

function calcDebts(expenses, travelers) {
  if (!travelers.length) return [];
  const bal = {};
  travelers.forEach(t => { bal[t.id] = 0; });

  expenses.forEach(exp => {
    const n = exp.participantIds.length;
    if (!n) return;
    const share = exp.amount / n;
    bal[exp.payerId] = (bal[exp.payerId] || 0) + exp.amount;
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

const BLANK = { description: '', amount: '', payerId: '', participantIds: [], activityId: '' };

export default function ExpensesTab({ trip, onAddExpense, onDeleteExpense }) {
  const travelers = trip.tripTravelers || [];
  const expenses = trip.expenses || [];
  const allActivities = trip.days.flatMap(d => d.activities);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const getName = (id) => travelers.find(t => t.id === id)?.name || id;
  const getEmoji = (id) => travelers.find(t => t.id === id)?.emoji || '👤';

  const toggleParticipant = (id) => {
    const ids = form.participantIds;
    set('participantIds', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const openForm = () => {
    setForm({ ...BLANK, payerId: travelers[0]?.id || '', participantIds: travelers.map(t => t.id) });
    setError('');
    setShowForm(true);
  };

  const handleAdd = () => {
    if (!form.description.trim()) { setError('Décris la dépense.'); return; }
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError('Montant invalide.'); return; }
    if (!form.payerId) { setError('Qui a payé ?'); return; }
    if (!form.participantIds.length) { setError('Qui participe ?'); return; }
    onAddExpense({ ...form, amount, description: form.description.trim() });
    setShowForm(false);
  };

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const debts = calcDebts(expenses, travelers);

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
      {/* Summary */}
      {expenses.length > 0 && (
        <div className="expenses-summary">
          <div className="expenses-summary__total">
            <span className="expenses-summary__label">Total dépensé</span>
            <span className="expenses-summary__amount">{formatPrice(totalSpent)}</span>
          </div>
          <div className="expenses-summary__per">
            soit {formatPrice(totalSpent / travelers.length)} par personne
          </div>
        </div>
      )}

      {/* Debt settlement */}
      {debts.length > 0 && (
        <div className="debts-card">
          <div className="debts-card__title">💳 Remboursements</div>
          {debts.map((d, i) => (
            <div key={i} className="debt-row">
              <span className="debt-emoji">{getEmoji(d.from)}</span>
              <span className="debt-from">{getName(d.from)}</span>
              <span className="debt-arrow">→</span>
              <span className="debt-amount">{formatPrice(d.amount)}</span>
              <span className="debt-arrow">→</span>
              <span className="debt-emoji">{getEmoji(d.to)}</span>
              <span className="debt-to">{getName(d.to)}</span>
            </div>
          ))}
        </div>
      )}
      {expenses.length > 0 && debts.length === 0 && (
        <div className="debts-card debts-card--settled">✅ Tout est équilibré !</div>
      )}

      {/* Expense list */}
      <div className="expenses-list">
        {expenses.length === 0 && !showForm && (
          <div className="expenses-list__empty">Aucune dépense enregistrée.</div>
        )}
        {expenses.map(exp => {
          const n = exp.participantIds.length;
          const share = n > 0 ? exp.amount / n : exp.amount;
          return (
            <div key={exp.id} className="expense-item">
              <div className="expense-item__main">
                <span className="expense-item__emoji">{getEmoji(exp.payerId)}</span>
                <div className="expense-item__info">
                  <div className="expense-item__desc">{exp.description}</div>
                  <div className="expense-item__meta">
                    {getName(exp.payerId)} a payé <strong>{formatPrice(exp.amount)}</strong>
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
                <button className="expense-item__delete" onClick={() => onDeleteExpense(exp.id)}>🗑️</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add form */}
      {showForm ? (
        <div className="expense-form">
          <div className="form-group">
            <label className="form-label">Description</label>
            <input className="form-input" placeholder="Ex: Resto du soir" value={form.description}
              onChange={e => set('description', e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Montant (€)</label>
            <input className="form-input" type="number" min="0" step="0.5" placeholder="0.00"
              value={form.amount} onChange={e => set('amount', e.target.value)} />
          </div>
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
          {allActivities.length > 0 && (
            <div className="form-group">
              <label className="form-label">Lier à une activité <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>— optionnel</span></label>
              <select className="form-select" value={form.activityId} onChange={e => set('activityId', e.target.value)}>
                <option value="">— aucune —</option>
                {allActivities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
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
