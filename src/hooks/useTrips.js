import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'provo_trips';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildDays(startDate, endDate) {
  const days = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (cursor <= end) {
    days.push({ id: genId(), date: localDateStr(cursor), activities: [], startTime: '09:00' });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function isPast(endDate) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, m, d] = endDate.split('-').map(Number);
  return new Date(y, m - 1, d) < today;
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

export function useTrips() {
  const [trips, setTrips] = useState(load);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); } catch {}
  }, [trips]);

  const createTrip = useCallback((data) => {
    const id = genId();
    const trip = {
      id, name: data.name, destination: data.destination || '',
      emoji: data.emoji || '✈️',
      initialBudget: parseFloat(data.initialBudget) || 0,
      startDate: data.startDate, endDate: data.endDate,
      days: buildDays(data.startDate, data.endDate),
      reserve: [], createdAt: new Date().toISOString()
    };
    setTrips(p => [trip, ...p]);
    return id;
  }, []);

  const updateTrip = useCallback((tripId, data) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const needRebuild = data.startDate !== t.startDate || data.endDate !== t.endDate;
      if (needRebuild) {
        const newStart = data.startDate || t.startDate;
        const newEnd = data.endDate || t.endDate;
        const newDays = buildDays(newStart, newEnd);
        const byDate = {};
        t.days.forEach(d => { byDate[d.date] = d; });
        newDays.forEach(d => {
          if (byDate[d.date]) {
            d.activities = byDate[d.date].activities;
            d.startTime = byDate[d.date].startTime || '09:00';
          }
        });
        return { ...t, ...data, days: newDays };
      }
      return { ...t, ...data };
    }));
  }, []);

  const deleteTrip = useCallback((tripId) => {
    setTrips(p => p.filter(t => t.id !== tripId));
  }, []);

  const getTripById = useCallback((id) => trips.find(t => t.id === id), [trips]);

  const addToReserve = useCallback((tripId, activity) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, reserve: [...t.reserve, { ...activity, id: genId(), status: 'todo' }]
    }));
  }, []);

  const addToDay = useCallback((tripId, dayId, activity) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, days: t.days.map(d => d.id !== dayId ? d : {
        ...d, activities: [...d.activities, { ...activity, id: genId(), status: 'todo' }]
      })
    }));
  }, []);

  const setActivityStatus = useCallback((tripId, location, activityId, status) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      if (location.type === 'reserve') {
        return { ...t, reserve: t.reserve.map(a => a.id === activityId ? { ...a, status } : a) };
      }
      return {
        ...t, days: t.days.map(d => {
          if (d.id !== location.dayId) return d;
          let acts = d.activities.map(a => a.id === activityId ? { ...a, status } : a);
          // Move done activities to bottom
          if (status === 'done') {
            const target = acts.find(a => a.id === activityId);
            acts = [...acts.filter(a => a.id !== activityId && a.status !== 'done'), ...acts.filter(a => a.id !== activityId && a.status === 'done'), target];
          }
          return { ...d, activities: acts };
        })
      };
    }));
  }, []);

  const updateActivity = useCallback((tripId, location, activityId, updates) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      if (location.type === 'reserve') {
        return { ...t, reserve: t.reserve.map(a => a.id === activityId ? { ...a, ...updates } : a) };
      }
      return {
        ...t, days: t.days.map(d => d.id !== location.dayId ? d : {
          ...d, activities: d.activities.map(a => a.id === activityId ? { ...a, ...updates } : a)
        })
      };
    }));
  }, []);

  const moveToReserve = useCallback((tripId, dayId, activityId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const day = t.days.find(d => d.id === dayId);
      const activity = day?.activities.find(a => a.id === activityId);
      if (!activity) return t;
      return {
        ...t,
        days: t.days.map(d => d.id !== dayId ? d : {
          ...d, activities: d.activities.filter(a => a.id !== activityId)
        }),
        reserve: [...t.reserve, { ...activity, status: 'todo' }]
      };
    }));
  }, []);

  const moveFromReserveToDay = useCallback((tripId, dayId, activityId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const activity = t.reserve.find(a => a.id === activityId);
      if (!activity) return t;
      return {
        ...t,
        reserve: t.reserve.filter(a => a.id !== activityId),
        days: t.days.map(d => d.id !== dayId ? d : {
          ...d, activities: [...d.activities, { ...activity, status: 'todo' }]
        })
      };
    }));
  }, []);

  const moveDayToDay = useCallback((tripId, srcDayId, tgtDayId, activityId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const src = t.days.find(d => d.id === srcDayId);
      const activity = src?.activities.find(a => a.id === activityId);
      if (!activity) return t;
      return {
        ...t, days: t.days.map(d => {
          if (d.id === srcDayId) return { ...d, activities: d.activities.filter(a => a.id !== activityId) };
          if (d.id === tgtDayId) return { ...d, activities: [...d.activities, activity] };
          return d;
        })
      };
    }));
  }, []);

  const moveToNextDay = useCallback((tripId, dayId, activityId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const idx = t.days.findIndex(d => d.id === dayId);
      if (idx < 0 || idx >= t.days.length - 1) return t;
      const activity = t.days[idx].activities.find(a => a.id === activityId);
      if (!activity) return t;
      return {
        ...t, days: t.days.map((d, i) => {
          if (i === idx) return { ...d, activities: d.activities.filter(a => a.id !== activityId) };
          if (i === idx + 1) return { ...d, activities: [...d.activities, activity] };
          return d;
        })
      };
    }));
  }, []);

  const reorderActivity = useCallback((tripId, dayId, activityId, dir) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      return {
        ...t, days: t.days.map(d => {
          if (d.id !== dayId) return d;
          const arr = [...d.activities];
          const i = arr.findIndex(a => a.id === activityId);
          if (i < 0) return d;
          const j = dir === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= arr.length) return d;
          [arr[i], arr[j]] = [arr[j], arr[i]];
          return { ...d, activities: arr };
        })
      };
    }));
  }, []);

  const reorderInReserve = useCallback((tripId, activityId, dir) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const arr = [...t.reserve];
      const i = arr.findIndex(a => a.id === activityId);
      if (i < 0) return t;
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return t;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...t, reserve: arr };
    }));
  }, []);

  const deleteActivity = useCallback((tripId, location, activityId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      if (location.type === 'reserve') {
        return { ...t, reserve: t.reserve.filter(a => a.id !== activityId) };
      }
      return {
        ...t, days: t.days.map(d => d.id !== location.dayId ? d : {
          ...d, activities: d.activities.filter(a => a.id !== activityId)
        })
      };
    }));
  }, []);

  const setDayStartTime = useCallback((tripId, dayId, startTime) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, days: t.days.map(d => d.id !== dayId ? d : { ...d, startTime })
    }));
  }, []);

  const duplicateToDay = useCallback((tripId, activityId, targetDayId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      let activity = t.reserve.find(a => a.id === activityId);
      if (!activity) {
        for (const d of t.days) {
          activity = d.activities.find(a => a.id === activityId);
          if (activity) break;
        }
      }
      if (!activity) return t;
      const copy = { ...activity, id: genId(), status: 'todo' };
      return {
        ...t, days: t.days.map(d => d.id !== targetDayId ? d : {
          ...d, activities: [...d.activities, copy]
        })
      };
    }));
  }, []);

  const duplicateTrip = useCallback((tripId) => {
    setTrips(p => {
      const orig = p.find(t => t.id === tripId);
      if (!orig) return p;
      const copy = {
        ...orig,
        id: genId(),
        name: `${orig.name} (copie)`,
        createdAt: new Date().toISOString(),
        days: orig.days.map(d => ({
          ...d,
          id: genId(),
          activities: d.activities.map(a => ({ ...a, id: genId(), status: 'todo' })),
        })),
        reserve: orig.reserve.map(a => ({ ...a, id: genId(), status: 'todo' })),
      };
      return [copy, ...p];
    });
  }, []);

  const setDayNotes = useCallback((tripId, dayId, notes) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, days: t.days.map(d => d.id !== dayId ? d : { ...d, notes })
    }));
  }, []);

  const setPackingOrder = useCallback((tripId, newList) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : { ...t, packingList: newList }));
  }, []);

  const sweepDayToReserve = useCallback((tripId, dayId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const day = t.days.find(d => d.id === dayId);
      if (!day) return t;
      const swept = day.activities.filter(a => a.status === 'todo');
      if (swept.length === 0) return t;
      return {
        ...t,
        days: t.days.map(d => d.id !== dayId ? d : {
          ...d, activities: d.activities.filter(a => a.status !== 'todo')
        }),
        reserve: [...swept, ...t.reserve],
      };
    }));
  }, []);

  const addPackingItem = useCallback((tripId, text, category = 'autre') => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, packingList: [...(t.packingList || []), { id: genId(), text, category, checked: false }]
    }));
  }, []);

  const togglePackingItem = useCallback((tripId, itemId) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, packingList: (t.packingList || []).map(item =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
    }));
  }, []);

  const deletePackingItem = useCallback((tripId, itemId) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, packingList: (t.packingList || []).filter(item => item.id !== itemId)
    }));
  }, []);

  const importTrip = useCallback((tripData) => {
    const id = genId();
    const trip = { ...tripData, id, createdAt: new Date().toISOString() };
    setTrips(p => [trip, ...p]);
    return id;
  }, []);

  return {
    trips,
    currentTrips: trips.filter(t => !isPast(t.endDate)),
    pastTrips: trips.filter(t => isPast(t.endDate)).sort((a, b) => new Date(b.endDate) - new Date(a.endDate)),
    createTrip, updateTrip, deleteTrip, getTripById,
    addToReserve, addToDay,
    setActivityStatus, updateActivity,
    moveToReserve, moveFromReserveToDay, moveDayToDay, moveToNextDay,
    reorderActivity, reorderInReserve,
    deleteActivity, setDayStartTime, importTrip, duplicateToDay,
    duplicateTrip, setDayNotes,
    addPackingItem, togglePackingItem, deletePackingItem,
    setPackingOrder, sweepDayToReserve
  };
}
