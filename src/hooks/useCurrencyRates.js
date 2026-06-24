import { useState, useEffect } from 'react';

const CACHE_KEY = 'provo_fx_rates';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

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

function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && Date.now() - raw.ts < CACHE_TTL) return raw.rates;
  } catch {}
  return null;
}

export function useCurrencyRates() {
  const [rates, setRates] = useState(() => loadCache() || {});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cached = loadCache();
    if (cached) { setRates(cached); return; }
    setLoading(true);
    fetch('https://api.frankfurter.app/latest?from=EUR')
      .then(r => r.json())
      .then(data => {
        if (data?.rates) {
          const r = { EUR: 1, ...data.rates };
          localStorage.setItem(CACHE_KEY, JSON.stringify({ rates: r, ts: Date.now() }));
          setRates(r);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const convertToEur = (amount, fromCurrency) => {
    if (fromCurrency === 'EUR' || !rates[fromCurrency]) return amount;
    return amount / rates[fromCurrency];
  };

  const convertFromEur = (amount, toCurrency) => {
    if (toCurrency === 'EUR' || !rates[toCurrency]) return amount;
    return amount * rates[toCurrency];
  };

  return { rates, loading, convertToEur, convertFromEur };
}
