import { useState, useRef, useMemo } from 'react';
import { formatPrice, CATEGORIES, formatDateShort, lireRecu, reduireImage } from '../utils/helpers';
import { useCurrencyRates, SUPPORTED_CURRENCIES } from '../hooks/useCurrencyRates';
import TravelerBalanceSheet from './TravelerBalanceSheet';
import SpinWheel from './SpinWheel';

function SwipeableExpenseItem({ exp, onDelete, children }) {
  const [offset, setOffset] = useState(0);
  const swRef = useRef({ startX: null, startY: null, dragging: false });
  // Un glissement se termine par un clic de synthèse. Depuis que la ligne
  // elle-même ouvre la fiche, ce clic rouvrirait la dépense qu'on vient de
  // supprimer — ou en ouvrirait une autre au relâchement. On l'avale.
  const apresGlissement = useRef(false);
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
    const glisse = swRef.current.dragging;
    swRef.current.startX = null;
    // Remis à plat ici, sinon le retour en place se fait sans transition :
    // la ligne saute au lieu de revenir.
    swRef.current.dragging = false;
    if (glisse) {
      apresGlissement.current = true;
      setTimeout(() => { apresGlissement.current = false; }, 400);
    }
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
        onClickCapture={e => {
          if (!apresGlissement.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
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
    // Une dépense écrite par une version antérieure, ou arrivée à moitié par
    // la synchro, n'a pas forcément ce champ. Sans garde, un seul objet mal
    // formé fait tomber toute la vue voyage — barre d'onglets comprise.
    const n = (exp.participantIds || []).length;
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
    // Une dépense écrite par une version antérieure, ou arrivée à moitié par
    // la synchro, n'a pas forcément ce champ. Sans garde, un seul objet mal
    // formé fait tomber toute la vue voyage — barre d'onglets comprise.
    const n = (exp.participantIds || []).length;
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
  { id: 'verre', emoji: '🍻', label: 'Verre' },
  { id: 'activite', emoji: '🎯', label: 'Activité' },
  { id: 'shopping', emoji: '🛍️', label: 'Shopping' },
  { id: 'autre', emoji: '💳', label: 'Autre' },
];

const CAT_DEFAUT = EXPENSE_CATEGORIES.find(c => c.id === 'autre');

const BLANK = { description: '', amount: '', payerId: '', participantIds: [], activityId: '', currency: 'EUR', expenseCategory: 'autre' };

const CAT_COLORS = ['#35A7DD', '#3b82f6', '#8b5cf6', '#22c55e', '#14b8a6', '#06b6d4'];

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

export default function ExpensesTab({ trip, onAddExpense, onUpdateExpense, onDeleteExpense, onDeleteTraveler, currentUserId }) {
  const travelers = trip.tripTravelers || [];
  const hasTravelers = travelers.length > 0;
  const expenses = trip.expenses || [];
  // Une dépense se rattache aussi bien à une idée de la Réserve : on paie
  // souvent un billet ou un acompte avant d'avoir casé l'activité dans un jour.
  const allActivities = [...trip.days.flatMap(d => d.activities), ...(trip.reserve || [])];
  const activitiesByDay = trip.days.map((d, i) => ({ day: d, dayIdx: i })).filter(({ day }) => day.activities.length > 0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('list'); // 'list' | 'categories' | 'travelers'
  const [selectedTraveler, setSelectedTraveler] = useState(null);
  const [showSpinWheel, setShowSpinWheel] = useState(false);
  const [showDebtDetail, setShowDebtDetail] = useState(false);
  const [editingId, setEditingId] = useState(null); // dépense en cours de modification
  const [detailsOuverts, setDetailsOuverts] = useState(false);
  const formRef = useRef(null);
  const { convertToEur } = useCurrencyRates();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const getName = (id) => travelers.find(t => t.id === id)?.name || id;
  const getEmoji = (id) => travelers.find(t => t.id === id)?.emoji || '👤';

  const toggleParticipant = (id) => {
    const ids = form.participantIds;
    set('participantIds', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  // `block: 'center'` centrait un formulaire plus haut que l'écran : ses deux
  // boutons tombaient sous la barre d'onglets flottante — mesuré à 29 px
  // recouverts — et rien ne le laissait voir. On amène le haut du formulaire
  // en haut du cadre : c'est là qu'on va taper, et la validation reste dedans.
  const scrollToForm = () => {
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openEditForm = (exp) => {
    setForm({
      description: exp.description || '',
      amount: String(exp.amount ?? ''),
      payerId: exp.payerId || '',
      participantIds: exp.participantIds || [],
      activityId: exp.activityId || '',
      currency: exp.currency || 'EUR',
      expenseCategory: exp.expenseCategory || 'autre',
    });
    setEditingId(exp.id);
    setError('');
    setDetailsOuverts(false);
    setShowForm(true);
    scrollToForm();
  };

  const [lectureRecu, setLectureRecu] = useState(false);
  const [recuMsg, setRecuMsg] = useState('');

  /**
   * Lit le ticket photographié et REMPLIT le formulaire — sans l'enregistrer.
   * L'utilisateur relit et corrige : c'est lui qui valide, comme avant.
   */
  const lireLeRecu = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setLectureRecu(true);
    setRecuMsg('');
    try {
      // Réduite avant l'envoi : une photo d'iPhone fait 4 Mo, un ticket se lit
      // très bien à 1000 px de large, et c'est du réseau en itinérance.
      const image = await reduireImage(fichier, 1000);
      const lu = await lireRecu(image);
      if (!lu || lu.error) {
        setRecuMsg(lu?.error === 'cle_absente'
          ? "La lecture de ticket n'est pas configurée — saisis le montant à la main."
          : "Ce ticket n'a pas pu être lu. Saisis le montant à la main.");
        return;
      }
      setForm(f => ({
        ...f,
        description: lu.commerce || f.description,
        amount: lu.montant != null ? String(lu.montant) : f.amount,
        currency: lu.devise || f.currency,
        expenseCategory: lu.categorie || f.expenseCategory,
      }));
      setRecuMsg(lu.montant == null
        ? "Montant illisible sur la photo — complète-le toi-même."
        : lu.confiance === 'basse'
          ? `${lu.montant} ${lu.devise || ''} — photo peu nette, vérifie avant d'enregistrer.`
          : `Lu sur le ticket : ${lu.montant} ${lu.devise || ''}. Vérifie et enregistre.`);
    } finally {
      setLectureRecu(false);
    }
  };

  const openForm = () => {
    setForm({ ...BLANK, payerId: travelers[0]?.id || '', participantIds: travelers.map(t => t.id), currency: 'EUR' });
    setEditingId(null);
    setError('');
    setDetailsOuverts(false);
    setShowForm(true);
    // Le formulaire s'ouvre sous la liste : on l'amène à l'écran, sinon on ne
    // voit rien se passer au clic sur « Ajouter une dépense ».
    scrollToForm();
  };

  // « Qui suis-je ? » — le voyageur lié au compte connecté. Chaque participant
  // voit donc SON propre solde, pas celui du propriétaire du voyage.
  const me = currentUserId ? travelers.find(t => t.profileId === currentUserId) : null;

  // Aperçu du partage pendant la saisie : « 60 € ÷ 2 = 30 € par personne »
  const splitPreview = (() => {
    const amt = parseFloat(form.amount);
    const n = form.participantIds.length;
    if (!amt || amt <= 0 || n === 0) return null;
    const eur = form.currency === 'EUR' ? amt : convertToEur(amt, form.currency);
    if (n === 1) {
      const only = travelers.find(t => t.id === form.participantIds[0]);
      return `${formatPrice(eur)} pour ${only ? only.name : '1 personne'} seul·e`;
    }
    return `${formatPrice(eur)} ÷ ${n} = ${formatPrice(eur / n)} par personne`;
  })();

  // Ce que le pli « Détails » contient, écrit sur sa propre ligne : replier
  // n'a le droit de faire gagner de la place que si on continue à voir ce
  // qu'on est en train d'enregistrer.
  const resumeDetails = (() => {
    const cat = EXPENSE_CATEGORIES.find(c => c.id === form.expenseCategory) || CAT_DEFAUT;
    const n = form.participantIds.length;
    const partage = !hasTravelers ? null
      : n === 0 ? 'partagé avec personne'
      : n === travelers.length ? 'partagé avec tout le monde'
      : n === 1 ? `pour ${getName(form.participantIds[0])} seul·e`
      : `partagé entre ${n}`;
    const liee = form.activityId
      ? allActivities.find(a => a.id === form.activityId)?.title
      : null;
    return [`${cat.emoji} ${cat.label}`, partage, liee && `🔗 ${liee}`]
      .filter(Boolean).join(' · ');
  })();

  const handleAdd = () => {
    if (!form.description.trim()) { setError('Décris la dépense.'); return; }
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError('Montant invalide.'); return; }
    if (hasTravelers) {
      if (!form.payerId) { setError('Qui a payé ?'); return; }
      if (!form.participantIds.length) { setError('Qui participe ?'); return; }
    }
    const eurAmount = form.currency === 'EUR' ? amount : convertToEur(amount, form.currency);
    const payload = {
      ...form,
      amount,
      eurAmount: Math.round(eurAmount * 100) / 100,
      description: form.description.trim(),
    };
    if (editingId) onUpdateExpense?.(editingId, payload);
    else onAddExpense(payload);
    setEditingId(null);
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

  // Settlements are money transfers between travelers, not group spending:
  // they count in the debt/balance math (that's how they cancel a debt) but
  // must not inflate totals or the category breakdown.
  // Tous ces calculs parcourent la liste des dépenses plusieurs fois. Ils ne
  // dépendent que d'elle et des voyageurs — les refaire à chaque frappe dans
  // le formulaire, ou à chaque relevé GPS, se paie sur un gros voyage.
  const {
    totalSpent, debts, balances, byCategory, travelerTotals,
  } = useMemo(() => {
    const reelles = expenses.filter(e => !e.isSettlement);
    const total = reelles.reduce((s, e) => s + (e.eurAmount ?? e.amount), 0);
    return {
      totalSpent: total,
      debts: calcDebts(expenses, travelers),
      balances: calcBalances(expenses, travelers),
      byCategory: EXPENSE_CATEGORIES.map(cat => ({
        ...cat,
        total: reelles
          .filter(e => e.expenseCategory === cat.id)
          .reduce((s, e) => s + (e.eurAmount ?? e.amount), 0),
      })).filter(c => c.total > 0),
      travelerTotals: travelers.map(t => {
        const paid = expenses
          .filter(e => e.payerId === t.id)
          .reduce((s, e) => s + (e.eurAmount ?? e.amount), 0);
        const share = expenses.reduce((s, e) => {
          if (!(e.participantIds || []).includes(t.id)) return s;
          return s + (e.eurAmount ?? e.amount) / ((e.participantIds || []).length || 1);
        }, 0);
        return { ...t, paid, share, balance: paid - share };
      }),
    };
  }, [expenses, travelers]);

  const tripBudget = parseFloat(trip.initialBudget) || 0;
  const budgetOver = tripBudget > 0 && totalSpent > tripBudget;

  return (
    <div className="expenses-tab">
      {!hasTravelers && expenses.length === 0 && !showForm && (
        <div className="expenses-hint">
          💡 Vous êtes plusieurs ? Ajoute des voyageurs dans <strong>⚙️ Paramètres du voyage</strong> pour répartir les dépenses. Sinon, ajoute directement une dépense ci-dessous.
        </div>
      )}
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
          {hasTravelers && (
            <div className="expenses-summary__per">
              soit {formatPrice(totalSpent / travelers.length)} par personne
            </div>
          )}
        </div>
      )}

      {/* Le bouton vient après le total : on lit d'abord où on en est, on
          ajoute ensuite. Hors de la condition sur le nombre de dépenses —
          c'est justement quand il n'y en a aucune qu'il faut pouvoir en
          ajouter une. */}
      {!showForm && (
        <button className="btn btn--primary expenses-add-top" onClick={openForm}>
          + Ajouter une dépense
        </button>
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

      {/* Solde personnel du participant connecté — répond à « et moi, je dois quoi ? » */}
      {me && debts.length > 0 && (() => {
        const iOwe = debts.filter(d => d.from === me.id);
        const owedToMe = debts.filter(d => d.to === me.id);
        if (iOwe.length === 0 && owedToMe.length === 0) return null;
        return (
          <div className="my-balance">
            <div className="my-balance__title">{me.emoji} Pour toi, {me.name}</div>
            {iOwe.map((d, i) => (
              <div key={`o${i}`} className="my-balance__line my-balance__line--owe">
                Tu dois <strong>{formatPrice(d.amount)}</strong> à {getEmoji(d.to)} {getName(d.to)}
              </div>
            ))}
            {owedToMe.map((d, i) => (
              <div key={`r${i}`} className="my-balance__line my-balance__line--get">
                {getEmoji(d.from)} {getName(d.from)} te doit <strong>{formatPrice(d.amount)}</strong>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Debt settlement */}
      {debts.length > 0 && (
        <div className="debts-card">
          <div className="debts-card__header">
            <div className="debts-card__title">💳 Remboursements</div>
            <button className="debts-card__detail-btn" onClick={() => setShowDebtDetail(o => !o)}>
              {showDebtDetail ? '▲ Masquer' : '▼ Détail'}
            </button>
          </div>
          {/* Phrase explicite : « X doit N € à Y ». Les flèches seules ne disaient
              pas dans quel sens allait l'argent. */}
          {debts.map((d, i) => (
            <div key={i} className="debt-row">
              <div className="debt-row__text">
                <span className="debt-emoji">{getEmoji(d.from)}</span>
                <span className="debt-from">{getName(d.from)}</span>
                <span className="debt-verb">doit</span>
                <span className="debt-amount">{formatPrice(d.amount)}</span>
                <span className="debt-verb">à</span>
                <span className="debt-emoji">{getEmoji(d.to)}</span>
                <span className="debt-to">{getName(d.to)}</span>
              </div>
              <button className="debt-settle-btn" onClick={() => handleSettleDebt(d)}>
                ✓ Remboursé
              </button>
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
              <div className="debt-detail__note">Positif = on te doit de l'argent · Négatif = tu dois de l'argent</div>
            </div>
          )}
        </div>
      )}
      {hasTravelers && expenses.length > 0 && debts.length === 0 && (
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
            const catMeta = exp.isSettlement
              ? { emoji: '🤝', label: 'Remboursement' }
              // Le repli se cherchait par index : insérer une catégorie avant
              // « Autre » l'aurait silencieusement remplacé par la nouvelle.
              : (EXPENSE_CATEGORIES.find(c => c.id === exp.expenseCategory) || CAT_DEFAUT);
            // Un remboursement ne se modifie pas : il découle des dépenses.
            const modifiable = !exp.isSettlement && !!onUpdateExpense;
            const Ligne = modifiable ? 'button' : 'div';
            return (
              <SwipeableExpenseItem key={exp.id} exp={exp} onDelete={() => onDeleteExpense(exp.id)}>
                <Ligne
                  className={`expense-item${modifiable ? ' expense-item--ouvrable' : ''}`}
                  {...(modifiable ? {
                    type: 'button',
                    onClick: () => openEditForm(exp),
                    'aria-label': `Modifier ${exp.description}`,
                  } : {})}
                >
                  <div className="expense-item__main">
                    <span className="expense-item__emoji">{catMeta.emoji}</span>
                    <div className="expense-item__info">
                      <div className="expense-item__desc">{exp.description}</div>
                      <div className="expense-item__meta">
                        {exp.isSettlement
                          ? <>{getName(exp.payerId)} a remboursé <strong>{formatPrice(eurAmt)}</strong> à {exp.participantIds.map(getName).join(', ')}</>
                          : <>
                              {exp.payerId && `${getName(exp.payerId)} a payé `}
                              <strong>
                                {exp.currency && exp.currency !== 'EUR'
                                  ? `${exp.amount} ${exp.currency} (≈ ${formatPrice(eurAmt)})`
                                  : formatPrice(eurAmt)
                                }
                              </strong>
                              {n > 0 && ` · ${formatPrice(share)}/pers.`}
                            </>
                        }
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
                  </div>
                </Ligne>
              </SwipeableExpenseItem>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showForm ? (
        <div className="expense-form" ref={formRef}>
          {/* Le montant est déjà écrit sur le ticket qu'on tient : le retaper
              est un calcul de plus que l'app devrait éviter. Rien n'est
              enregistré sans relecture — un montant faux dans un partage se
              découvre à la fin du voyage, trop tard pour le corriger. */}
          {!editingId && (
            <div className="recu">
              <label className="recu__btn">
                {lectureRecu ? '⏳ Lecture du ticket…' : '📷 Photographier le ticket'}
                <input type="file" accept="image/*" capture="environment"
                  onChange={lireLeRecu} disabled={lectureRecu} hidden />
              </label>
              {recuMsg && <p className="recu__msg">{recuMsg}</p>}
            </div>
          )}
          {/* Le montant d'abord : on l'a sous les yeux, écrit sur le ticket
              qu'on tient. Le curseur y arrive directement, clavier numérique
              ouvert — on tape 24, on valide, c'est fini. La description
              venait avant et coûtait deux champs de traversée pour un texte
              qu'on écrit rarement. */}
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Montant</label>
              <input className="form-input" type="number" inputMode="decimal" min="0" step="0.5"
                placeholder="0.00" autoFocus
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
          {/* Le partage se lit sous le montant, là où on vient de taper — même
              quand le détail du partage est replié. */}
          {splitPreview && <p className="expense-form__preview">{splitPreview}</p>}

          <div className="form-group">
            <label className="form-label">Description</label>
            <input className="form-input" placeholder="Ex: Resto du soir" value={form.description}
              onChange={e => set('description', e.target.value)} />
          </div>

          {hasTravelers && (
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
          )}

          {/* Même pli que la fiche d'activité, même intention : la catégorie
              par défaut convient presque toujours, le partage est déjà « tout
              le monde », et lier une activité est explicitement optionnel.
              Le résumé dit ce qu'il y a dessous — rien n'est caché, c'est
              seulement rangé. */}
          <button
            type="button"
            className="details-pli"
            onClick={() => setDetailsOuverts(o => !o)}
            aria-expanded={detailsOuverts}
          >
            <span>{detailsOuverts ? '▴' : '▾'} Détails</span>
            <small>{resumeDetails}</small>
          </button>
          {detailsOuverts && (<>
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
          {hasTravelers && (
            <div className="form-group">
              <label className="form-label">
                Partagé entre
                <button
                  type="button"
                  className="expense-form__all-btn"
                  onClick={() => set('participantIds',
                    form.participantIds.length === travelers.length ? [] : travelers.map(t => t.id))}
                >
                  {form.participantIds.length === travelers.length ? 'Tout décocher' : 'Tout le monde'}
                </button>
              </label>
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
          )}
          {(activitiesByDay.length > 0 || (trip.reserve || []).length > 0) && (
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
                {(trip.reserve || []).length > 0 && (
                  <optgroup label="📦 Réserve">
                    {trip.reserve.map(a => (
                      <option key={a.id} value={a.id}>{a.title}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}
          </>)}
          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--secondary btn--full" onClick={() => { setShowForm(false); setEditingId(null); }}>Annuler</button>
            <button className="btn btn--primary btn--full" onClick={handleAdd}>
              {editingId ? '✅ Enregistrer' : '✅ Ajouter'}
            </button>
          </div>
          {/* La corbeille a quitté chaque ligne de la liste — sept fois moins
              d'icônes à l'écran. Supprimer reste possible de deux façons : le
              glissement, et ici, dans la fiche qu'on a justement ouverte. */}
          {editingId && (
            <button type="button" className="expense-form__supprimer"
              onClick={() => { onDeleteExpense(editingId); setEditingId(null); setShowForm(false); }}>
              Supprimer cette dépense
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
