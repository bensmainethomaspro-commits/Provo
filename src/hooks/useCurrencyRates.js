import { useState, useEffect, useCallback } from 'react';
import { avecDelai } from '../utils/reseau';

const CACHE_KEY = 'provo_fx_rates';
// Au-delà, on cherche des taux plus récents — mais les anciens RESTENT en
// repli. Avant, ils étaient jetés au bout de 24 h même sans réseau pour les
// remplacer : hors ligne depuis un jour, une dépense de 10 000 ¥ (une
// soixantaine d'euros) s'enregistrait à 10 000 € (audit A-003).
const FRAIS_MS = 24 * 60 * 60 * 1000;

export const SUPPORTED_CURRENCIES = [
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'USD', symbol: '$', name: 'Dollar US' },
  { code: 'GBP', symbol: '£', name: 'Livre sterling' },
  { code: 'JPY', symbol: '¥', name: 'Yen japonais' },
  { code: 'CHF', symbol: 'CHF', name: 'Franc suisse' },
  { code: 'CAD', symbol: 'CA$', name: 'Dollar canadien' },
  { code: 'AUD', symbol: 'A$', name: 'Dollar australien' },
  { code: 'MXN', symbol: 'MX$', name: 'Peso mexicain' },
  { code: 'BRL', symbol: 'R$', name: 'Real brésilien' },
  { code: 'THB', symbol: '฿', name: 'Baht thaïlandais' },
  { code: 'SGD', symbol: 'S$', name: 'Dollar de Singapour' },
  { code: 'AED', symbol: 'د.إ', name: 'Dirham des EAU' },
  { code: 'MAD', symbol: 'د.م.', name: 'Dirham marocain' },
  { code: 'EGP', symbol: 'E£', name: 'Livre égyptienne' },
  { code: 'TRY', symbol: '₺', name: 'Lire turque' },
  { code: 'IDR', symbol: 'Rp', name: 'Roupie indonésienne' },
  { code: 'KRW', symbol: '₩', name: 'Won sud-coréen' },
  { code: 'INR', symbol: '₹', name: 'Roupie indienne' },
  { code: 'NOK', symbol: 'kr', name: 'Couronne norvégienne' },
  { code: 'SEK', symbol: 'kr', name: 'Couronne suédoise' },
];

function lireCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw?.rates && typeof raw.rates === 'object') return { rates: raw.rates, ts: Number(raw.ts) || 0 };
  } catch { /* cache illisible : comme s'il n'y en avait pas */ }
  return null;
}

// Un taux de plus d'un jour et demi se date à l'écran : hors ligne, c'est le
// dernier connu qui sert, et la personne doit savoir sur quoi repose le chiffre.
const ANCIEN_MS = 36 * 60 * 60 * 1000;
const etatDepuis = (c) => ({
  rates: c?.rates || {},
  ancienDu: c?.ts && Date.now() - c.ts > ANCIEN_MS ? c.ts : 0,
});

// Deux sources, dans cet ordre (règle E9 : ce qui dépend d'un tiers a
// plusieurs échelons, et l'ordre est écrit).
//  1. Frankfurter : les taux de référence de la BCE. Sûrs, mais une trentaine
//     de devises seulement — le dirham marocain, le dirham des Émirats ou la
//     livre égyptienne n'y sont pas, et la liste ci-dessus les propose.
//  2. open.er-api.com (ExchangeRate-API, accès libre sans clé) : ne sert qu'à
//     ce que la première ne publie pas.
// Non vérifiable depuis le bac à sable de développement (les deux domaines y
// sont bloqués) : la forme des réponses est celle documentée par chaque
// service, et une réponse inattendue rend simplement « pas de taux ».
async function lireFrankfurter() {
  const r = await avecDelai('https://api.frankfurter.app/latest?from=EUR');
  if (!r.ok) return null;
  const d = await r.json();
  return d?.rates && typeof d.rates === 'object' ? d.rates : null;
}

async function lireSecours() {
  const r = await avecDelai('https://open.er-api.com/v6/latest/EUR');
  if (!r.ok) return null;
  const d = await r.json();
  return d?.result === 'success' && d.rates && typeof d.rates === 'object' ? d.rates : null;
}

async function chargerTaux() {
  let rates = await lireFrankfurter().catch(() => null);
  if (SUPPORTED_CURRENCIES.some(c => !rates?.[c.code] && c.code !== 'EUR')) {
    const secours = await lireSecours().catch(() => null);
    // La BCE garde la main sur ce qu'elle publie.
    if (secours) rates = { ...secours, ...(rates || {}) };
  }
  if (!rates) return null;
  const res = { rates: { ...rates, EUR: 1 }, ts: Date.now() };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(res)); } catch { /* le stockage plein se dit ailleurs */ }
  return res;
}

// Une seule requête pour tous les écrans qui en ont besoin au même moment.
let enCours = null;

export function useCurrencyRates() {
  const [etat, setEtat] = useState(() => etatDepuis(lireCache()));
  const [loading, setLoading] = useState(() => Date.now() - (lireCache()?.ts || 0) >= FRAIS_MS);

  useEffect(() => {
    const c = lireCache();
    if (c && Date.now() - c.ts < FRAIS_MS) return;
    let vivant = true;
    (enCours ||= chargerTaux().finally(() => { enCours = null; }))
      .then(res => { if (vivant && res) setEtat(etatDepuis(res)); })
      .catch(() => {})
      .finally(() => { if (vivant) setLoading(false); });
    return () => { vivant = false; };
  }, []);

  /**
   * `null` quand le taux manque — JAMAIS le montant tel quel. Rendre le
   * montant revenait à décréter 1 € = 1 ¥, et le chiffre faux était enregistré
   * pour toujours dans la dépense.
   */
  const convertToEur = useCallback((amount, fromCurrency) => {
    if (fromCurrency === 'EUR' || !fromCurrency) return amount;
    const taux = etat.rates[fromCurrency];
    return taux > 0 ? amount / taux : null;
  }, [etat.rates]);

  // `ancienDu` : date du taux quand il a plus d'un jour et demi, 0 sinon.
  return { rates: etat.rates, ancienDu: etat.ancienDu, loading, convertToEur };
}
