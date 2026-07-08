// Valise intelligente : suggestions contextuelles déduites de la météo de la
// destination et des activités planifiées. Retourne [{ text, category, reason }]
// — `category` correspond aux catégories de PackingList.

const RAIN_CODES = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99);
const SNOW_CODES = (c) => c >= 71 && c <= 77;

export function suggestSmartPacking(trip, weatherByDate) {
  const out = [];
  const push = (text, category, reason) => {
    if (!out.some(s => s.text.toLowerCase() === text.toLowerCase())) out.push({ text, category, reason });
  };

  // ── Météo ──
  const days = Object.values(weatherByDate || {});
  if (days.length > 0) {
    const maxT = Math.max(...days.map(d => d.max));
    const minT = Math.min(...days.map(d => d.min));
    const rainy = days.some(d => RAIN_CODES(d.code));
    const snowy = days.some(d => SNOW_CODES(d.code));

    if (maxT >= 25) {
      const r = `☀️ jusqu'à ${maxT}° prévu`;
      push('Crème solaire', 'toilette', r);
      push('Lunettes de soleil', 'vetements', r);
      push('Casquette / chapeau', 'vetements', r);
      push('Gourde', 'autre', r);
    }
    if (minT <= 8) {
      const r = `🥶 jusqu'à ${minT}° prévu`;
      push('Manteau chaud', 'vetements', r);
      push('Écharpe', 'vetements', r);
      push('Gants', 'vetements', r);
    }
    if (rainy) {
      push('K-way / imperméable', 'vetements', '🌧️ pluie annoncée');
      push('Parapluie pliable', 'autre', '🌧️ pluie annoncée');
    }
    if (snowy) {
      push('Bonnet', 'vetements', '❄️ neige annoncée');
      push('Chaussures imperméables', 'vetements', '❄️ neige annoncée');
    }
  }

  // ── Activités planifiées ──
  const acts = [
    ...(trip?.days || []).flatMap(d => d.activities || []),
    ...(trip?.reserve || []),
  ].filter(a => a.status !== 'nogo');
  const cats = new Set(acts.map(a => a.category));
  const catCount = (id) => acts.filter(a => a.category === id).length;

  if (cats.has('plage')) {
    push('Maillot de bain', 'vetements', '🏖️ plage au programme');
    push('Serviette de plage', 'autre', '🏖️ plage au programme');
    push('Tongs', 'vetements', '🏖️ plage au programme');
  }
  if (cats.has('balade') || cats.has('sport')) {
    push('Chaussures de marche', 'vetements', '🥾 balade / sport prévu');
    push('Petit sac à dos', 'autre', '🥾 balade / sport prévu');
  }
  if (cats.has('sport')) {
    push('Tenue de sport', 'vetements', '🏋️ activité sportive');
  }
  if (cats.has('fun') || catCount('resto') >= 3) {
    push('Tenue habillée', 'vetements', '🎉 sorties prévues');
  }

  // ── Essentiels (si la valise démarre de zéro) ──
  const r = '🧳 indispensable';
  push("Papiers d'identité", 'docs', r);
  push('Chargeur téléphone', 'electronique', r);
  push('Brosse à dents', 'toilette', r);
  push('Médicaments perso', 'sante', r);
  if ((trip?.days?.length || 0) >= 5) {
    push('Batterie externe', 'electronique', `📅 ${trip.days.length} jours de voyage`);
  }

  return out;
}
