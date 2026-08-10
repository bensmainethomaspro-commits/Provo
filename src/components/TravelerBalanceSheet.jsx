import { createPortal } from 'react-dom';
import { formatPrice, partEnEuros } from '../utils/helpers';

export default function TravelerBalanceSheet({ traveler, travelers, expenses, debts, onClose, onDelete }) {
  const getName = (id) => travelers.find(t => t.id === id)?.name || id;
  const getEmoji = (id) => travelers.find(t => t.id === id)?.emoji || '👤';

  const paid = expenses
    .filter(e => e.payerId === traveler.id)
    .reduce((s, e) => s + (e.eurAmount ?? e.amount), 0);

  // La part vient de `partEnEuros`, pas d'une division locale : à parts
  // inégales, cette feuille afficherait sinon un chiffre différent de celui
  // des dettes juste en dessous — sur la même dépense.
  const share = expenses.reduce((s, e) => {
    if (!(e.participantIds || []).includes(traveler.id)) return s;
    return s + partEnEuros(e, traveler.id);
  }, 0);

  const balance = paid - share;

  // Debts involving this person
  const owes = debts.filter(d => d.from === traveler.id);
  const owed = debts.filter(d => d.to === traveler.id);

  // Expenses paid by or involving this traveler
  const myExpenses = expenses.filter(
    e => e.payerId === traveler.id || e.participantIds.includes(traveler.id)
  );

  // Même raison que la roue : rendu dans document.body pour échapper aux
  // ancêtres animés (transform), qui fausseraient le positionnement « fixed ».
  return createPortal(
    <div className="sheet-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet tbs">
        <div className="sheet__handle" />

        {/* Header */}
        <div className="tbs__hero">
          <div className="tbs__avatar">{traveler.emoji}</div>
          <div className="tbs__name">{traveler.name}</div>
          <div className={`tbs__balance-chip${balance >= 0 ? ' tbs__balance-chip--pos' : ' tbs__balance-chip--neg'}`}>
            {balance >= 0 ? `Se faire rembourser ${formatPrice(balance)}` : `Doit rembourser ${formatPrice(-balance)}`}
          </div>
        </div>

        <div className="sheet__body">

          {/* Stats row */}
          <div className="tbs__stats">
            <div className="tbs__stat">
              <div className="tbs__stat-value">{formatPrice(paid)}</div>
              <div className="tbs__stat-label">A payé</div>
            </div>
            <div className="tbs__stat-sep" />
            <div className="tbs__stat">
              <div className="tbs__stat-value">{formatPrice(share)}</div>
              <div className="tbs__stat-label">Part réelle</div>
            </div>
            <div className="tbs__stat-sep" />
            <div className="tbs__stat">
              <div className={`tbs__stat-value${balance >= 0 ? ' tbs__stat-value--pos' : ' tbs__stat-value--neg'}`}>
                {balance >= 0 ? '+' : ''}{formatPrice(balance)}
              </div>
              <div className="tbs__stat-label">Solde</div>
            </div>
          </div>

          {/* Transfers */}
          {(owes.length > 0 || owed.length > 0) && (
            <div className="tbs__section">
              <div className="tbs__section-title">Remboursements</div>
              {owes.map((d, i) => (
                <div key={i} className="tbs__transfer tbs__transfer--owes">
                  <span className="tbs__transfer-avatar">{traveler.emoji}</span>
                  <div className="tbs__transfer-text">
                    <span className="tbs__transfer-amount">{formatPrice(d.amount)}</span>
                    <span className="tbs__transfer-label"> à payer à </span>
                    <span className="tbs__transfer-name">{getEmoji(d.to)} {getName(d.to)}</span>
                  </div>
                  <span className="tbs__transfer-badge tbs__transfer-badge--owes">Doit</span>
                </div>
              ))}
              {owed.map((d, i) => (
                <div key={i} className="tbs__transfer tbs__transfer--owed">
                  <span className="tbs__transfer-avatar">{traveler.emoji}</span>
                  <div className="tbs__transfer-text">
                    <span className="tbs__transfer-amount">{formatPrice(d.amount)}</span>
                    <span className="tbs__transfer-label"> à recevoir de </span>
                    <span className="tbs__transfer-name">{getEmoji(d.from)} {getName(d.from)}</span>
                  </div>
                  <span className="tbs__transfer-badge tbs__transfer-badge--owed">Reçoit</span>
                </div>
              ))}
              {owes.length === 0 && owed.length === 0 && (
                <div className="tbs__settled">✅ Tout est équilibré</div>
              )}
            </div>
          )}
          {owes.length === 0 && owed.length === 0 && expenses.length > 0 && (
            <div className="tbs__section">
              <div className="tbs__settled">✅ Tout est équilibré</div>
            </div>
          )}

          {/* My expenses */}
          {myExpenses.length > 0 && (
            <div className="tbs__section">
              <div className="tbs__section-title">Ses dépenses</div>
              {myExpenses.map(exp => {
                const eurAmt = exp.eurAmount ?? exp.amount;
                const isPayer = exp.payerId === traveler.id;
                return (
                  <div key={exp.id} className="tbs__exp-row">
                    <div className="tbs__exp-info">
                      <div className="tbs__exp-desc">{exp.description}</div>
                      <div className="tbs__exp-meta">
                        {isPayer ? `A payé ${formatPrice(eurAmt)}` : `Part : ${formatPrice(partEnEuros(exp, traveler.id))}`}
                      </div>
                    </div>
                    <span className={`tbs__exp-badge${isPayer ? ' tbs__exp-badge--paid' : ''}`}>
                      {isPayer ? 'Payeur' : 'Participant'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Danger zone */}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn--danger btn--full" onClick={() => { onDelete(traveler.id); onClose(); }}>
              🗑️ Retirer {traveler.name} du voyage
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
