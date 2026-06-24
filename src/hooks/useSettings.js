import { useState, useEffect } from 'react';

const KEY = 'provo_settings';
export const DEFAULTS = {
  haptics: true,
  onboardingDone: false,
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function useSettings() {
  const [settings, setSettings] = useState(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);
  const setSetting = (key, value) => setSettings(s => ({ ...s, [key]: value }));
  return { settings, setSetting };
}

export function vibrate(pattern) {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (s.haptics === false) return;
    navigator.vibrate?.(pattern);
  } catch {}
}
