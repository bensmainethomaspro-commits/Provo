// Jeu de données de référence pour les vérifications d'interface.
//
// Une app vide ne révèle rien : ni carte trop dense, ni liste qui déborde, ni
// contraste sur fond coloré. Ce voyage sert de sujet stable à `/verif-ui`,
// pour que deux mesures faites à deux semaines d'écart soient comparables.
const ds = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const n = new Date();
const day = k => { const d = new Date(n); d.setDate(d.getDate() + k); return ds(d); };

const PHOTO = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="#8B5E3C"/><stop offset="1" stop-color="#E8C39E"/>
     </linearGradient></defs>
     <rect width="400" height="200" fill="url(#g)"/>
   </svg>`).toString('base64');

const repas = (slot, h, m, prix) => ({
  id: `m${slot}`, title: slot === 'midi' ? 'Repas midi' : 'Repas soir',
  category: 'resto', status: 'todo', price: String(prix),
  durationHours: h, durationMinutes: m, isMeal: true, mealSlot: slot,
  fixedStart: slot === 'midi' ? '12:00' : '19:00', travelerIds: [],
});

export const trip = {
  id: 'tr1', name: 'Vienne', destination: 'Vienne', emoji: '🇦🇹', coverPhoto: null,
  travelers: 2, initialBudget: 900, startDate: day(0), endDate: day(5),
  createdAt: new Date().toISOString(), packingList: [],
  // Forme exacte attendue par ExpensesTab : `payerId` / `participantIds` /
  // `description`. Une fixture approximative faisait planter l'onglet, et
  // /verif-ui mesurait donc un écran d'erreur en croyant mesurer les dépenses.
  expenses: [
    { id: 'e1', description: 'Billets de train', amount: 148, eurAmount: 148,
      currency: 'EUR', expenseCategory: 'transport',
      payerId: 't1', date: day(0), participantIds: ['t1', 't2'] },
    { id: 'e2', description: 'Dîner Figlmüller', amount: 52.4, eurAmount: 52.4,
      currency: 'EUR', expenseCategory: 'resto',
      payerId: 't2', date: day(1), participantIds: ['t1', 't2'] },
  ],
  tripTravelers: [{ id: 't1', name: 'Thomas', emoji: '🧔' }, { id: 't2', name: 'Léa', emoji: '👩' }],
  tripNotes: 'Vol AB1234 — 14h30 Terminal 2',
  days: [0, 1, 2, 3, 4, 5].map((k, i) => ({
    id: `d${i + 1}`, date: day(k), startTime: '09:00', notes: '',
    activities: i === 0
      ? [
          { id: 'a01', title: 'Cathédrale Saint-Étienne', category: 'visite', status: 'todo',
            durationHours: 1, durationMinutes: 0, fixedStart: '10:00',
            address: 'Stephansplatz 3, Vienne, Autriche', lat: 48.2085, lon: 16.3735,
            travelerIds: [] },
          repas('midi', 1, 0, 20),
          { id: 'a02', title: 'Schönbrunn', category: 'visite', status: 'todo',
            durationHours: 2, durationMinutes: 0, address: 'Schönbrunn, Vienne',
            lat: 48.1845, lon: 16.3122, travelerIds: [] },
          repas('soir', 1, 30, 20),
        ]
      : i === 1
        ? [
            { id: 'a10', title: 'Schönbrunn', category: 'visite', status: 'todo',
              durationHours: 3, durationMinutes: 0, price: '26', fixedStart: '10:00',
              address: 'Schönbrunner Schloßstraße 47, Vienne, Autriche',
              openingHours: 'Mo-Su 08:30-17:30', lat: 48.1845, lon: 16.3122,
              photoUrl: PHOTO, mustDo: true, travelerIds: ['t1', 't2'] },
            repas('midi', 1, 0, 20), repas('soir', 1, 30, 35),
            { id: 'a11', title: 'Opéra de Vienne', category: 'fun', status: 'todo',
              durationHours: 2, durationMinutes: 30, price: '60', fixedStart: '20:00',
              address: 'Opernring 2, Vienne, Autriche', lat: 48.2032, lon: 16.3691,
              travelerIds: ['t1'] },
          ]
        : [repas('midi', 1, 0, 20), repas('soir', 1, 30, 20)],
  })),
  reserve: [
    { id: 'r1', title: 'Café bel étage, Kärntner Straße 38, 1010 Vienna Austria',
      category: 'resto', status: 'todo', durationHours: 0, durationMinutes: 45,
      address: '38 Kärntner Straße, Vienne, Autriche', photoUrl: PHOTO,
      openingHours: 'Mo-Su 09:00-23:00', price: '18', lat: 48.2045, lon: 16.3707,
      link: 'https://maps.google.com/x', travelerIds: [] },
    { id: 'r2', title: 'Gerstner K café', category: 'resto', status: 'todo',
      durationHours: 0, durationMinutes: 45, address: 'Vienne, Autriche',
      photoUrl: PHOTO, lat: 48.2039, lon: 16.3695, travelerIds: [] },
    { id: 'r3', title: 'Kunsthistorisches Museum', category: 'visite', status: 'todo',
      durationHours: 2, durationMinutes: 0, address: '5 Burgring, Vienne, Autriche',
      openingHours: 'Tu-Su 10:00-18:00', price: '21', lat: 48.2038, lon: 16.3614,
      travelerIds: [] },
    { id: 'r4', title: 'Naschmarkt', category: 'balade', status: 'todo',
      durationHours: 1, durationMinutes: 30, address: 'Vienne, Autriche',
      lat: 48.1985, lon: 16.3625, travelerIds: [] },
    { id: 'r5', title: 'Belvédère', category: 'visite', status: 'todo',
      durationHours: 2, durationMinutes: 0, address: 'Prinz-Eugen-Straße 27, Vienne',
      price: '17', openingHours: 'Mo-Su 09:00-18:00', lat: 48.1915, lon: 16.3806,
      photoUrl: PHOTO, travelerIds: [] },
    { id: 'r6', title: 'Prater', category: 'fun', status: 'todo',
      durationHours: 2, durationMinutes: 30, address: 'Vienne, Autriche',
      lat: 48.2166, lon: 16.3958, travelerIds: [] },
    { id: 'r7', title: 'Figlmüller', category: 'resto', status: 'todo',
      durationHours: 1, durationMinutes: 30, address: 'Wollzeile 5, Vienne',
      price: '25', lat: 48.2087, lon: 16.3745, travelerIds: [] },
    { id: 'r8', title: 'Hundertwasserhaus', category: 'visite', status: 'todo',
      durationHours: 1, durationMinutes: 0, address: 'Kegelgasse 36-38, Vienne',
      lat: 48.2074, lon: 16.3939, travelerIds: [] },
  ],
};

export const settings = { onboardingDone: true };
