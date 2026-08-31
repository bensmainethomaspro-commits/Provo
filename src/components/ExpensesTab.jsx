import { useState, useRef, useMemo } from 'react';
import {
  formatPrice, formatDateShort, lireRecu, reduireImage,
  partEnEuros, partageInegal, evaluerMontant, estUnCalcul, formatMontantExact,
  dateLocale,
} from '../utils/helpers';
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
    bal[exp.payerId] = (bal[exp.payerId] || 0) + eurAmount;
    // La part de chacun vient de `partEnEuros`, jamais d'une division locale :
    // un partage inégal doit donner le même chiffre ici, dans les soldes et
    // dans la feuille par voyageur. Trois copies d'un calcul d'argent finissent
    // par ne plus dire la même chose.
    exp.participantIds.forEach(id => { bal[id] = (bal[id] || 0) - partEnEuros(exp, id); });
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
    bal[exp.payerId] = (bal[exp.payerId] || 0) + (exp.eurAmount ?? exp.amount);
    exp.participantIds.forEach(id => { bal[id] = (bal[id] || 0) - partEnEuros(exp, id); });
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

// Les trois natures d'une opération, comme chez Tricount.
// Un REVENU est enregistré en montant NÉGATIF plutôt qu'avec un drapeau :
// sept fichiers somment de l'argent dans ce dépôt, et un drapeau obligerait
// chacun à s'en souvenir — c'est exactement la faute que E13 décrit. Le signe
// vit dans la valeur ; les totaux, les soldes et les dettes suivent sans rien
// savoir de la nouveauté.
// Un TRANSFERT est un remboursement : il existait déjà sous `isSettlement`,
// mais seulement atteignable depuis le panneau des dettes. On peut désormais
// le noter au moment où on le fait.
const TYPES = [
  { id: 'depense',   label: 'Dépense',   titre: 'Ajouter une dépense',   signe: 1 },
  { id: 'revenu',    label: 'Revenu',    titre: 'Ajouter un revenu',     signe: -1 },
  { id: 'transfert', label: 'Transfert', titre: 'Noter un remboursement', signe: 1 },
];

// Les quatre signes de la calculatrice du champ « Montant ». Les caractères
// mathématiques (× ÷ −) et pas leurs sosies du clavier (x / -) : c'est ce qui
// se lit sur un ticket, et `evaluerMontant` accepte les deux.
const OPERATEURS = ['+', '−', '×', '÷'];
const NOM_OPERATEUR = { '+': 'plus', '−': 'moins', '×': 'multiplié par', '÷': 'divisé par' };

// Les quatre façons de diviser. `egal` ne demande aucune saisie — c'est le cas
// courant, et il ne doit rien coûter.
const MODES = [
  { id: 'egal',        label: 'Également',       unite: 'part' },
  { id: 'parts',       label: 'En parts',        unite: 'parts' },
  { id: 'montants',    label: 'En montants',     unite: 'montant en euros' },
  { id: 'pourcentages', label: 'En pourcentages', unite: 'pourcentage' },
];

/**
 * Ce que chaque participant doit, PENDANT la saisie.
 *
 * C'est le cœur de cet écran : on voit le partage se faire au fur et à mesure,
 * au lieu de le découvrir après enregistrement. Rend aussi l'écart à combler,
 * parce qu'un partage qui ne tombe pas juste doit se voir avant de valider et
 * pas se découvrir dans les dettes à la fin du voyage.
 */
function repartir(mode, participants, valeurs, total) {
  const part = {};
  if (!participants.length) return { part, ecart: null };
  const lu = (id) => {
    const v = parseFloat(valeurs[id]);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  if (mode === 'montants') {
    let somme = 0;
    participants.forEach(id => { part[id] = lu(id) ?? 0; somme += part[id]; });
    const reste = Math.round((total - somme) * 100) / 100;
    return {
      part,
      ecart: Math.abs(reste) < 0.005 ? null
        : reste > 0 ? `Il reste ${formatMontantExact(reste)} à répartir`
        : `${formatMontantExact(-reste)} de trop`,
    };
  }

  if (mode === 'pourcentages') {
    let somme = 0;
    participants.forEach(id => { const v = lu(id) ?? 0; part[id] = total * v / 100; somme += v; });
    const reste = Math.round((100 - somme) * 100) / 100;
    return {
      part,
      ecart: Math.abs(reste) < 0.005 ? null
        : reste > 0 ? `Il reste ${reste} % à répartir` : `${-reste} % de trop`,
    };
  }

  // `egal` et `parts` : une part chacun par défaut, donc les deux se calculent
  // pareil — « également » n'est que « toutes les parts à 1 ».
  const parts = {};
  let somme = 0;
  participants.forEach(id => {
    const v = mode === 'parts' ? (lu(id) ?? 1) : 1;
    parts[id] = v > 0 ? v : 1;
    somme += parts[id];
  });
  participants.forEach(id => { part[id] = somme ? total * parts[id] / somme : 0; });
  return { part, ecart: null };
}

const BLANK = { description: '', amount: '', payerId: '', participantIds: [], parts: {},
  activityId: '', currency: 'EUR', expenseCategory: 'autre',
  type: 'depense', mode: 'egal', valeurs: {}, date: '' };

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
  const [emojisOuverts, setEmojisOuverts] = useState(false);
  const [lectureRecu, setLectureRecu] = useState(false);
  const [recuMsg, setRecuMsg] = useState('');
  const formRef = useRef(null);
  // Le champ du montant accepte une opération : il faut pouvoir y insérer un
  // signe au point d'insertion, et lui rendre le focus juste après.
  const montantRef = useRef(null);
  const [calculOuvert, setCalculOuvert] = useState(false);
  const { convertToEur } = useCurrencyRates();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Un id technique ne se lit pas. Une dépense payée par quelqu'un qui a
  // quitté le voyage garde son `payerId` — l'argent est bien sorti de sa
  // poche — mais l'écran doit le dire en mots, pas en identifiant.
  //
  // A-029 (audit du 2026-08-31) signale « le panneau des dettes réaffiche un
  // identifiant technique » après le retrait d'un voyageur. NON REPRODUIT :
  // ce repli est passé par ici en A-025, et TOUT affichage d'un payeur ou d'un
  // participant traverse `getName` — la ligne de dette, le détail des soldes,
  // la feuille par voyageur, la liste. Vérifié au grep : aucun `payerId`,
  // `d.from` ni `d.to` n'atteint le JSX sans lui.
  // Ce qui reste vrai, et qui n'est pas un défaut : la dépense garde son payeur
  // parti, donc les dettes affichent « Voyageur retiré ». L'effacer rendrait la
  // dépense payée par personne et fausserait le solde de tous les autres.
  // Si l'attaque du constat est un jour exercée et qu'un identifiant sort, ce
  // commentaire est faux — pas l'inverse.
  const getName = (id) => travelers.find(t => t.id === id)?.name || 'Voyageur retiré';
  const getEmoji = (id) => travelers.find(t => t.id === id)?.emoji || '👤';

  const toggleParticipant = (id) => {
    const ids = form.participantIds;
    const sort = ids.includes(id);
    // Retirer quelqu'un retire aussi sa part : la garder ferait réapparaître
    // un « ×3 » oublié le jour où on le remet dans la dépense.
    const parts = { ...(form.parts || {}) };
    if (sort) delete parts[id];
    setForm(f => ({
      ...f,
      participantIds: sort ? ids.filter(x => x !== id) : [...ids, id],
      parts,
    }));
  };

  // Un écran partagé répond « et moi, où j'en suis ? », pas seulement « quel
  // est l'état global ». La personne connectée sert de payeur par défaut, se
  // marque « (Moi) » dans les listes, et sa part est celle qu'on affiche.
  const me = currentUserId ? travelers.find(t => t.profileId === currentUserId) : null;

  const aujourdhui = () => dateLocale();

  const openForm = () => {
    setForm({
      ...BLANK,
      // MOI par défaut : c'est presque toujours celui qui saisit qui vient de
      // payer. C4 du playbook — se placer du point de vue du compte connecté.
      payerId: me?.id || travelers[0]?.id || '',
      participantIds: travelers.map(t => t.id),
      date: aujourdhui(),
    });
    setEditingId(null);
    setEmojisOuverts(false);
    setRecuMsg('');
    setError('');
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const openEditForm = (exp) => {
    // Une dépense enregistrée ne porte que des PARTS — c'est la seule unité que
    // connaît `partEnEuros`. On rouvre donc en « parts », jamais en montants
    // ou en pourcentages : les rejouer demanderait de deviner l'unité saisie,
    // et on afficherait un chiffre que personne n'a tapé.
    const parts = exp.parts || {};
    const inegal = partageInegal(exp);
    const valeurs = {};
    if (inegal) {
      // Ramenées à la plus petite, pour lire « 2 » et « 1 » plutôt que
      // « 0,666… » et « 0,333… ».
      const brutes = (exp.participantIds || []).map(id => parts[id] || 0).filter(v => v > 0);
      const mini = brutes.length ? Math.min(...brutes) : 1;
      (exp.participantIds || []).forEach(id => {
        valeurs[id] = String(Math.round(((parts[id] || 0) / mini) * 100) / 100);
      });
    }
    setForm({
      ...BLANK,
      description: exp.description || '',
      // Un revenu est stocké en négatif : le formulaire, lui, montre toujours
      // un montant positif et laisse le segment porter le sens.
      amount: String(Math.abs(exp.amount ?? '')),
      type: exp.isSettlement ? 'transfert' : ((exp.eurAmount ?? exp.amount ?? 0) < 0 ? 'revenu' : 'depense'),
      mode: inegal ? 'parts' : 'egal',
      valeurs,
      payerId: exp.payerId || '',
      participantIds: exp.participantIds || [],
      parts,
      activityId: exp.activityId || '',
      currency: exp.currency || 'EUR',
      expenseCategory: exp.expenseCategory || 'autre',
      date: exp.date || aujourdhui(),
    });
    setEditingId(exp.id);
    setEmojisOuverts(false);
    setRecuMsg('');
    setError('');
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const lireLeRecu = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setLectureRecu(true);
    setRecuMsg('');
    try {
      // La photo ne part plus nulle part : la lecture se fait sur le téléphone.
      // On réduit quand même — le moteur travaille mieux sur des glyphes de
      // taille raisonnable qu'en agrandissant une image de 4000 px.
      const image = await reduireImage(fichier, 1400);
      const lu = await lireRecu(image, (avance) => {
        // Trois à dix secondes sur un téléphone : sans compteur, on croit que
        // rien ne se passe et on relance.
        setRecuMsg(`Lecture du ticket… ${Math.round(avance * 100)} %`);
      });
      if (!lu || lu.error) {
        setRecuMsg("Ce ticket n'a pas pu être lu. Saisis le montant à la main.");
        return;
      }
      // Le champ s'écrit comme on l'y taperait : virgule, et les deux centimes.
      // `String(48.4)` rendait « 48.4 » — un point dans un formulaire dont le
      // repère est « 0,00 », et un ticket de 48,40 qui a l'air d'en valoir 48,4.
      const ecrit = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2)).replace('.', ',');
      setForm(f => ({
        ...f,
        description: lu.commerce || f.description,
        amount: lu.montant != null ? ecrit(lu.montant) : f.amount,
        currency: lu.devise || f.currency,
        expenseCategory: lu.categorie || f.expenseCategory,
        // Le ticket porte sa date : un ticket photographié le lendemain doit
        // compter au jour où on a payé, pas au jour où on l'a noté. Jamais une
        // date à venir — ce serait une faute de lecture (2062 pour 2026), et
        // une dépense datée du futur disparaît du bilan.
        date: lu.date && lu.date <= aujourdhui() ? lu.date : f.date,
      }));
      const somme = formatMontantExact(lu.montant, lu.devise || form.currency);
      setRecuMsg(lu.montant == null
        ? "Montant illisible sur la photo — complète-le toi-même."
        : lu.confiance === 'basse'
          ? `${somme} — photo peu nette, vérifie avant d'enregistrer.`
          : `Lu sur le ticket : ${somme}. Vérifie et enregistre.`);
    } catch {
      // `reduireImage` rejette sur un fichier que le navigateur ne sait pas
      // décoder — un HEIC transmis tel quel, une image tronquée. Sans ce
      // rattrapage, l'indicateur s'éteignait et il ne se passait plus rien :
      // ni montant, ni message. On ne saurait même pas qu'il faut recommencer.
      setRecuMsg("Cette photo n'a pas pu être ouverte. Reprends-la, ou saisis le montant à la main.");
    } finally {
      setLectureRecu(false);
    }
  };

  const changerType = (type) => setForm(f => ({
    ...f, type,
    // Un transfert va d'une personne à UNE autre : le partage n'a pas de sens.
    mode: 'egal', valeurs: {},
    participantIds: type === 'transfert'
      ? f.participantIds.slice(0, 1)
      : travelers.map(t => t.id),
  }));

  // Changer de mode repart des valeurs vides : convertir des parts en
  // pourcentages produirait des chiffres que personne n'a saisis.
  const changerMode = (mode) => setForm(f => ({ ...f, mode, valeurs: {} }));

  const reglerValeur = (id, v) => setForm(f => ({ ...f, valeurs: { ...f.valeurs, [id]: v } }));

  const fermerForm = () => {
    setShowForm(false); setEditingId(null); setEmojisOuverts(false); setError('');
  };

  // Le total en euros, tel qu'il sera enregistré. Le champ peut porter un
  // CALCUL (« 12,50+8 ») : c'est son résultat qui compte, ici comme partout.
  const totalEuros = useMemo(() => {
    const amt = evaluerMontant(form.amount);
    if (!amt || amt <= 0) return 0;
    return form.currency === 'EUR' ? amt : convertToEur(amt, form.currency);
  }, [form.amount, form.currency, convertToEur]);

  // L'aperçu « = 20,50 € », affiché pendant qu'on tape l'opération. Muet sur un
  // nombre simple — il n'apprendrait rien — et muet sur une opération
  // incomplète ou fautive, plutôt que d'annoncer un montant qu'on ne saisira
  // pas.
  const apercuCalcul = useMemo(() => {
    if (!estUnCalcul(form.amount)) return null;
    const v = evaluerMontant(form.amount);
    return v == null ? null : formatMontantExact(v, form.currency);
  }, [form.amount, form.currency]);

  // Au moment où l'on quitte le champ, l'opération laisse la place à son
  // résultat : ce qui reste écrit est ce qui sera enregistré.
  const figerLeCalcul = () => {
    if (!estUnCalcul(form.amount)) return;
    const v = evaluerMontant(form.amount);
    if (v != null) set('amount', String(v));
  };

  // La rangée de signes se referme APRÈS le clic, pas pendant.
  //
  // Repliée dès la perte du focus, elle disparaissait au `mousedown` sur
  // « Ajouter » : les 50 px qu'elle occupait s'évanouissaient, tout remontait,
  // et le `mouseup` tombait à côté du bouton — donc aucun clic. Le parcours
  // « Modifier puis supprimer une dépense » l'a attrapé : la modification
  // n'était jamais enregistrée. Sous un vrai doigt, le bouton saute au moment
  // où on le touche : même cause, même effet.
  const fermetureCalc = useRef(null);
  const fermerLeCalcul = () => {
    clearTimeout(fermetureCalc.current);
    fermetureCalc.current = setTimeout(() => setCalculOuvert(false), 180);
  };

  const taperOperateur = (op) => {
    const champ = montantRef.current;
    const texte = form.amount ?? '';
    // Au point d'insertion, pas à la fin : on corrige souvent le milieu d'une
    // opération. Sans sélection connue, on ajoute au bout.
    const d = champ?.selectionStart ?? texte.length;
    const f = champ?.selectionEnd ?? texte.length;
    const suite = texte.slice(0, d) + op + texte.slice(f);
    set('amount', suite);
    requestAnimationFrame(() => {
      champ?.focus();
      champ?.setSelectionRange(d + 1, d + 1);
    });
  };

  // LA RÉPARTITION EN DIRECT — le point de tout cet écran. Chacun voit ce
  // qu'il doit pendant qu'on tape, au lieu de le découvrir après coup.
  const { part: repartition, ecart: ecartRepartition } = useMemo(
    () => repartir(form.mode, form.participantIds, form.valeurs, totalEuros),
    [form.mode, form.participantIds, form.valeurs, totalEuros]);

  const handleAdd = () => {
    if (!form.description.trim()) { setError('Donne un titre.'); return; }
    const amount = evaluerMontant(form.amount);
    if (!amount || amount <= 0) {
      setError(estUnCalcul(form.amount)
        ? "Ce calcul ne tombe pas juste — vérifie l'opération."
        : 'Montant invalide.');
      return;
    }
    if (hasTravelers) {
      if (!form.payerId) { setError(form.type === 'transfert' ? 'De qui ?' : 'Qui a payé ?'); return; }
      if (!form.participantIds.length) {
        setError(form.type === 'transfert' ? 'Pour qui ?' : 'Qui participe ?'); return;
      }
      // Un partage qui ne tombe pas juste fabrique des dettes fausses, et on
      // ne s'en aperçoit qu'à la fin du voyage. On refuse d'enregistrer.
      if (ecartRepartition) { setError(ecartRepartition); return; }
    }
    const eur = form.currency === 'EUR' ? amount : convertToEur(amount, form.currency);
    const signe = TYPES.find(t => t.id === form.type)?.signe ?? 1;

    // Les parts enregistrées sont TOUJOURS des parts, quel que soit le mode de
    // saisie : `partEnEuros` — la seule règle de partage du dépôt — ne connaît
    // que ça. Un montant ou un pourcentage se convertit donc ici, une fois,
    // au lieu d'apprendre trois unités à tout le reste de l'app.
    const parts = {};
    if (form.mode !== 'egal' && form.type !== 'transfert' && eur > 0) {
      form.participantIds.forEach(id => {
        // Une part est un ratio : les euros de chacun rapportés au total.
        parts[id] = (repartition[id] || 0) / eur;
      });
    }

    const payload = {
      description: form.description.trim(),
      amount: signe * amount,
      eurAmount: signe * Math.round(eur * 100) / 100,
      currency: form.currency,
      expenseCategory: form.expenseCategory,
      payerId: form.payerId,
      participantIds: form.participantIds,
      parts,
      activityId: form.type === 'transfert' ? '' : form.activityId,
      date: form.date || undefined,
      // Un transfert est un remboursement : c'est le même objet qu'avant, et
      // le panneau des dettes continue de le reconnaître.
      ...(form.type === 'transfert' ? { isSettlement: true } : {}),
    };
    if (editingId) onUpdateExpense?.(editingId, payload);
    else onAddExpense(payload);
    fermerForm();
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
          return s + partEnEuros(e, t.id);
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

      {/* ── Formulaire, disposé comme Tricount ────────────────────────────
          Demandé explicitement, capture à l'appui. Trois écarts assumés avec
          ce que Provo faisait :
           · le TITRE passe avant le montant. #34 avait choisi l'inverse (le
             montant est écrit sur le ticket qu'on tient). Tricount fait le
             contraire et c'est ce qui est demandé ;
           · la DATE devient saisissable. Le champ existait dans les données
             depuis toujours, aucun écran ne le proposait ;
           · « Transfert » sort du panneau des dettes : on peut noter un
             remboursement au moment où on le fait, pas seulement en soldant. */}
      {showForm ? (
        <div className="expense-form ef" ref={formRef}>
          <div className="ef__entete">
            <button type="button" className="ef__annuler" onClick={fermerForm}>Annuler</button>
            <span className="ef__titre-ecran">
              {editingId ? 'Modifier' : TYPES.find(t => t.id === form.type)?.titre}
            </span>
          </div>

          {/* Dépense · Revenu · Transfert. Un revenu est enregistré en montant
              NÉGATIF, pas avec un drapeau : sept endroits somment de l'argent
              dans ce dépôt, et un drapeau obligerait chacun à s'en souvenir.
              Le signe vit dans la valeur, tout le reste suit sans le savoir. */}
          {!editingId && (
            <div className="ef__segments" role="tablist" aria-label="Nature de l'opération">
              {TYPES.map(t => (
                <button key={t.id} type="button" role="tab"
                  aria-selected={form.type === t.id}
                  className={`ef__segment${form.type === t.id ? ' ef__segment--on' : ''}`}
                  onClick={() => changerType(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Titre</label>
            <div className="ef__ligne-titre">
              {/* Le champ ne fait plus que 240 px : deux icônes lui prennent
                  le reste de la ligne. « Par exemple : boissons » y était
                  coupé au milieu du mot. */}
              <input className="form-input" placeholder="Boissons, taxi…"
                value={form.description} onChange={e => set('description', e.target.value)} />
              <button type="button" className="ef__icone" aria-label="Choisir une icône"
                aria-expanded={emojisOuverts} onClick={() => setEmojisOuverts(o => !o)}>
                {EXPENSE_CATEGORIES.find(c => c.id === form.expenseCategory)?.emoji || '🙂'}
              </button>
              {!editingId && (
                <label className="ef__icone" aria-label="Photographier le ticket">
                  {lectureRecu ? '⏳' : '📷'}
                  <input type="file" accept="image/*" capture="environment"
                    onChange={lireLeRecu} disabled={lectureRecu} hidden />
                </label>
              )}
              {/* La catégorie EST le choix d'icône : deux réglages pour une
                  seule décision, c'était un de trop. La palette s'ancre sur
                  cette ligne et se pose par-dessus la suite du formulaire. */}
              {emojisOuverts && (
                <>
                  <button type="button" className="ef__voile"
                    aria-label="Fermer le choix d'icône"
                    onClick={() => setEmojisOuverts(false)} />
                  <div className="ef__emojis">
                    {EXPENSE_CATEGORIES.map(cat => (
                      <button key={cat.id} type="button"
                        className={`ef__emoji${form.expenseCategory === cat.id ? ' ef__emoji--on' : ''}`}
                        onClick={() => { set('expenseCategory', cat.id); setEmojisOuverts(false); }}>
                        <span className="ef__emoji-signe">{cat.emoji}</span>
                        <span className="ef__emoji-nom">{cat.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {recuMsg && <p className="recu__msg">{recuMsg}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Montant</label>
            <div className="ef__ligne">
              {/* `type="text"` et non `number` : un champ numérique refuse
                  « 12,50+8 ». `inputMode="decimal"` garde le pavé numérique
                  sur téléphone — c'est lui qu'on veut, pas le clavier complet.
                  Les opérateurs, eux, viennent de la rangée ci-dessous : aucun
                  clavier système ne les propose sur un pavé décimal. */}
              <input className="form-input ef__montant" type="text" inputMode="decimal"
                placeholder="0,00" autoFocus ref={montantRef}
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
                onFocus={() => { clearTimeout(fermetureCalc.current); setCalculOuvert(true); }}
                onBlur={() => { figerLeCalcul(); fermerLeCalcul(); }} />
              <select className="form-select ef__devise" value={form.currency}
                aria-label="Devise" onChange={e => set('currency', e.target.value)}>
                {SUPPORTED_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>
                ))}
              </select>
            </div>

            {/* La calculatrice de Tricount, adaptée au web : là-bas le pavé
                numérique est dessiné par l'app et porte ses opérateurs ; ici le
                clavier appartient au système, donc les quatre signes vivent
                juste sous le champ. Ils n'apparaissent que pendant la saisie du
                montant — le cas courant est un nombre, et il ne doit rien payer
                pour l'exception. */}
            {calculOuvert && (
              <div className="ef__calc" role="group" aria-label="Calculer le montant">
                {OPERATEURS.map(op => (
                  <button key={op} type="button" className="ef__calc-touche"
                    aria-label={`Ajouter ${NOM_OPERATEUR[op]}`}
                    /* Sans ça, toucher une touche sort du champ : le clavier se
                       referme et la rangée disparaît sous le doigt. */
                    onMouseDown={e => e.preventDefault()}
                    onTouchStart={e => e.preventDefault()}
                    onFocus={() => clearTimeout(fermetureCalc.current)}
                    onClick={() => taperOperateur(op)}>
                    {op}
                  </button>
                ))}
              </div>
            )}

            {(apercuCalcul || form.currency !== 'EUR') && form.amount && (
              <div className="currency-hint">
                {apercuCalcul && <strong>= {apercuCalcul}</strong>}
                {form.currency !== 'EUR' && <> ≈ {formatMontantExact(totalEuros)}</>}
              </div>
            )}
          </div>

          <div className="ef__deux">
            {hasTravelers && (
              <div className="form-group">
                <label className="form-label">
                  {form.type === 'transfert' ? 'De'
                    : form.type === 'revenu' ? 'Reçu par' : 'Payé par'}
                </label>
                <select className="form-select" value={form.payerId}
                  onChange={e => set('payerId', e.target.value)}>
                  {travelers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.emoji} {t.name}{me && t.id === me.id ? ' (Moi)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Quand</label>
              <input className="form-input" type="date" value={form.date}
                onChange={e => set('date', e.target.value)} />
            </div>
          </div>

          {hasTravelers && (
            <div className="form-group">
              <div className="ef__diviser-entete">
                <label className="form-label">
                  {form.type === 'transfert' ? 'Pour' : 'Diviser'}
                </label>
                {form.type !== 'transfert' && (
                  <select className="ef__mode" value={form.mode} aria-label="Mode de partage"
                    onChange={e => changerMode(e.target.value)}>
                    {MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                )}
              </div>

              <div className="ef__personnes">
                {travelers.map(t => {
                  const dedans = form.participantIds.includes(t.id);
                  return (
                    <div key={t.id} className={`ef__personne${dedans ? '' : ' ef__personne--off'}`}>
                      <button type="button" className="ef__coche"
                        aria-pressed={dedans}
                        aria-label={`${dedans ? 'Retirer' : 'Ajouter'} ${t.name}`}
                        onClick={() => toggleParticipant(t.id)}>
                        <span className={`ef__coche-rond${dedans ? ' ef__coche-rond--on' : ''}`}>
                          {dedans ? '✓' : ''}
                        </span>
                      </button>
                      <span className="ef__nom">
                        {t.emoji} {t.name}{me && t.id === me.id ? ' (Moi)' : ''}
                      </span>
                      {/* En parts, en montants ou en pourcentages, la valeur se
                          saisit ; à parts égales elle se lit seulement. Dans
                          tous les cas, les euros de chacun s'affichent PENDANT
                          la saisie — c'est le point de tout cet écran. */}
                      {dedans && form.mode !== 'egal' && form.type !== 'transfert' && (
                        <input className="ef__valeur" type="number" inputMode="decimal"
                          min="0" step={form.mode === 'parts' ? '1' : '0.01'}
                          aria-label={`${MODES.find(m => m.id === form.mode)?.unite} pour ${t.name}`}
                          value={form.valeurs[t.id] ?? ''}
                          placeholder={form.mode === 'parts' ? '1' : '0'}
                          onChange={e => reglerValeur(t.id, e.target.value)} />
                      )}
                      <span className="ef__euros">
                        {/* Au centime, pas à l'euro : « 33 € · 33 € · 33 € »
                            pour 100 € partagés en trois se lit comme une
                            erreur de calcul. */}
                        {dedans ? formatMontantExact(repartition[t.id] || 0) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Ce qui ne tombe pas juste doit se voir avant d'enregistrer,
                  pas se découvrir dans les dettes à la fin du voyage. */}
              {ecartRepartition && (
                <p className="ef__ecart">{ecartRepartition}</p>
              )}
            </div>
          )}

          {(activitiesByDay.length > 0 || (trip.reserve || []).length > 0) && form.type !== 'transfert' && (
            /* Le libellé vit dans la liste elle-même : c'est le dernier champ
               du formulaire, et le bouton collant venait se poser dessus en
               laissant un intitulé seul, sans rien dessous. Un champ
               facultatif dont l'option par défaut se lit « aucune activité
               liée » n'a besoin de personne pour l'annoncer. */
            <div className="form-group">
              <select className="form-select" value={form.activityId}
                aria-label="Lier à une activité"
                onChange={e => set('activityId', e.target.value)}>
                <option value="">🔗 Aucune activité liée — optionnel</option>
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

          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
          <button className="btn btn--primary btn--full ef__valider" onClick={handleAdd}>
            {editingId ? 'Enregistrer' : 'Ajouter'}
          </button>
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
          {/* Ni barre de budget ni « X € restants » : l'en-tête du voyage le
              dit déjà, 250 px plus haut, avec les mêmes mots. Le doublon
              coûtait 90 px avant la première dépense — et sur cet écran, la
              première dépense est ce qu'on vient voir. */}
          {hasTravelers && (
            <div className="expenses-summary__per">
              soit {formatPrice(totalSpent / travelers.length)} par personne
            </div>
          )}
        </div>
      )}

      {/* Ce bouton est le SEUL moyen d'ajouter une dépense : le « + » de
          l'en-tête ouvre le formulaire d'ACTIVITÉ, pas celui-ci. Je l'ai
          retiré une fois en le croyant redondant — sept parcours l'ont
          rattrapé avant livraison. Ne pas refaire : vérifier ce que le « + »
          de l'en-tête ouvre avant de le déclarer doublon. */}
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
            // Même garde que dans `calcDebts` et `calcBalances`, pour la même
            // raison : une dépense arrivée à moitié par la synchro n'a pas
            // forcément ce champ. La garde posée dans les calculs ne protège
            // pas le rendu — sans elle ici, un seul objet mal formé fait
            // toujours tomber toute la vue voyage, barre d'onglets comprise.
            // La liaison `participants` sert aussi deux fois plus bas, où les
            // accès étaient restés nus : c'est la version de l'audit, gardée.
            const participants = exp.participantIds || [];
            const n = participants.length;
            const eurAmt = exp.eurAmount ?? exp.amount;
            // « X €/pers. » n'a de sens QUE si le partage est égal. À parts
            // inégales il n'existe aucun montant « par personne » — et cette
            // ligne, la plus lue de l'app, annonçait la division simple pendant
            // que les dettes et la feuille par voyageur disaient autre chose.
            // Sur 90 € partagés 1:2 : 45 ici, 30 et 60 ailleurs.
            const inegal = partageInegal(exp);
            const maPart = me ? partEnEuros(exp, me.id) : 0;
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
                          ? <>{getName(exp.payerId)} a remboursé <strong>{formatPrice(eurAmt)}</strong> à {participants.map(getName).join(', ')}</>
                          : <>
                              {exp.payerId && `${getName(exp.payerId)} a payé `}
                              <strong>
                                {exp.currency && exp.currency !== 'EUR'
                                  ? `${exp.amount} ${exp.currency} (≈ ${formatPrice(eurAmt)})`
                                  : formatPrice(eurAmt)
                                }
                              </strong>
                              {n > 0 && (inegal
                                ? (maPart > 0
                                  ? ` · ta part : ${formatPrice(maPart)}`
                                  : ' · à parts inégales')
                                : ` · ${formatPrice(share)}/pers.`)}
                            </>
                        }
                        {exp.activityId && (() => {
                          const act = allActivities.find(a => a.id === exp.activityId);
                          return act ? <span className="expense-item__linked"> · 🔗 {act.title}</span> : null;
                        })()}
                      </div>
                      {n > 0 && (
                        <div className="expense-item__participants">
                          {participants.map(id => <span key={id} className="expense-participant">{getEmoji(id)}</span>)}
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

    </div>
  );
}
