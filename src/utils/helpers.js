export const CATEGORIES = [
  { id: 'restaurant', emoji: '🍽️', label: 'Resto' },
  { id: 'culture', emoji: '🏛️', label: 'Culture' },
  { id: 'nature', emoji: '🏔️', label: 'Nature/Sport' },
  { id: 'transport', emoji: '🚗', label: 'Trajet' },
  { id: 'accommodation', emoji: '🛏️', label: 'Hébergement' },
  { id: 'rest', emoji: '🧘', label: 'Repos' },
];

export const STATUS_CONFIG = {
  todo: { emoji: '⏳', label: 'À faire', cls: 'status--todo' },
  done: { emoji: '✅', label: 'Fait', cls: 'status--done' },
  nogo: { emoji: '❌', label: 'Nogo', cls: 'status--nogo' },
};

export function getCategoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) || { emoji: '📌', label: id };
}

export function totalMinutes(activities) {
  return activities.reduce((sum, a) => sum + (a.durationHours || 0) * 60 + (a.durationMinutes || 0), 0);
}

export function formatDuration(minutes) {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getDayLabel(index, total) {
  if (total === 1) return 'Jour unique';
  return `Jour ${index + 1}`;
}

export function encodeTrip(trip) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(trip))));
}

export function decodeTrip(encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

export function getLogicAlerts(activities) {
  const alerts = [];
  const activeActivities = activities.filter(a => a.status !== 'nogo');
  const total = totalMinutes(activeActivities);

  if (total > 8 * 60) {
    alerts.push({ type: 'overload', icon: '⚠️', message: `Journée surchargée ! (${formatDuration(total)} planifiées)` });
  }

  const hasRestaurant = activeActivities.some(a => a.category === 'restaurant');
  if (!hasRestaurant && total >= 180) {
    alerts.push({ type: 'meal', icon: '🍽️', message: 'Aucun repas prévu pour cette longue journée.' });
  }

  const sportMinutes = activeActivities
    .filter(a => a.category === 'nature')
    .reduce((s, a) => s + (a.durationHours || 0) * 60 + (a.durationMinutes || 0), 0);
  if (sportMinutes > 3 * 60) {
    alerts.push({ type: 'effort', icon: '🧘', message: `Grosse journée sportive (${formatDuration(sportMinutes)}) — pensez à une pause repos !` });
  }

  return alerts;
}
