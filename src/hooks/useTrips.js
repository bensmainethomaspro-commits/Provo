import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

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

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function useTrips() {
  const [trips, setTrips] = useState(load);
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const syncedHashRef = useRef({});
  const syncTimeouts = useRef({});
  const remoteIdsRef = useRef(new Set());
  const tripsRef = useRef(trips);
  useEffect(() => { tripsRef.current = trips; }, [trips]);

  // ── Charger depuis Supabase (appelé directement à la connexion) ───────────
  const loadFromSupabase = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from('trips')
      .select('id, data')
      .order('updated_at', { ascending: false });
    if (error || !data) return;

    const cloudTrips = data.map(r => r.data).filter(Boolean);
    cloudTrips.forEach(t => {
      remoteIdsRef.current.add(t.id);
      syncedHashRef.current[t.id] = JSON.stringify(t);
    });

    setTrips(prev => {
      const cloudIds = new Set(cloudTrips.map(t => t.id));
      const localOnly = prev.filter(t => !cloudIds.has(t.id));
      localOnly.forEach(trip => {
        supabase.from('trips').insert({
          id: trip.id, owner_id: uid,
          data: trip, updated_at: new Date().toISOString(),
        }).then(({ error: e }) => { if (!e) remoteIdsRef.current.add(trip.id); });
      });
      return [...cloudTrips, ...localOnly];
    });
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setAuthLoading(false);
      if (uid) loadFromSupabase(uid);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (uid) loadFromSupabase(uid);
      } else if (event === 'SIGNED_OUT') {
        setTrips([]);
        remoteIdsRef.current = new Set();
        syncedHashRef.current = {};
      }
    });
    return () => subscription.unsubscribe();
  }, [loadFromSupabase]);

  // ── Cache localStorage (toujours) ─────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); } catch {}
  }, [trips]);

  // ── Sync vers Supabase (debounced, 700ms) ────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    trips.forEach(trip => {
      const hash = JSON.stringify(trip);
      if (syncedHashRef.current[trip.id] === hash) return;
      clearTimeout(syncTimeouts.current[trip.id]);
      syncTimeouts.current[trip.id] = setTimeout(async () => {
        syncedHashRef.current[trip.id] = hash;
        if (remoteIdsRef.current.has(trip.id)) {
          await supabase.from('trips')
            .update({ data: trip, updated_at: new Date().toISOString() })
            .eq('id', trip.id);
        } else {
          const { error } = await supabase.from('trips').insert({
            id: trip.id, owner_id: userId,
            data: trip, updated_at: new Date().toISOString(),
          });
          if (!error) remoteIdsRef.current.add(trip.id);
        }
      }, 700);
    });
  }, [trips, userId]);

  // ── Realtime : recevoir les changements des collaborateurs ────────────────
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`user_trips_${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips' }, (payload) => {
        const remoteTrip = payload.new?.data;
        const tripId = payload.new?.id;
        if (!remoteTrip || !tripId) return;
        const remoteHash = JSON.stringify(remoteTrip);
        setTrips(prev => {
          const existing = prev.find(t => t.id === tripId);
          if (!existing) return [...prev, remoteTrip];
          if (JSON.stringify(existing) === remoteHash) return prev;
          syncedHashRef.current[tripId] = remoteHash;
          return prev.map(t => t.id === tripId ? remoteTrip : t);
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trips' }, (payload) => {
        const newTrip = payload.new?.data;
        const tripId = payload.new?.id;
        if (!newTrip || !tripId) return;
        remoteIdsRef.current.add(tripId);
        syncedHashRef.current[tripId] = JSON.stringify(newTrip);
        setTrips(prev => prev.find(t => t.id === tripId) ? prev : [newTrip, ...prev]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'trips' }, (payload) => {
        const tripId = payload.old?.id;
        if (tripId) setTrips(prev => prev.filter(t => t.id !== tripId));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [userId]);

  // ── Auth helpers ──────────────────────────────────────────────────────────
  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message || error.toString() } : { success: true };
  }, []);

  const signUp = useCallback(async (email, password, displayName) => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: displayName } },
    });
    return error ? { error: error.message || error.toString() } : { success: true };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // ── Collaboration ─────────────────────────────────────────────────────────
  const enableCollaboration = useCallback(async (tripId) => {
    if (!userId) return null;
    // Essayer d'insérer, sinon récupérer le code existant
    const { data: existing } = await supabase
      .from('trip_members')
      .select('invite_code')
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) return existing.invite_code;
    const { data, error } = await supabase
      .from('trip_members')
      .insert({ trip_id: tripId, user_id: userId, role: 'owner' })
      .select('invite_code')
      .single();
    return error ? null : data?.invite_code;
  }, [userId]);

  const joinTripByInvite = useCallback(async (inviteCode) => {
    if (!userId) return { error: 'Non connecté' };
    const { data, error } = await supabase.rpc('join_trip_by_invite', { p_invite_code: inviteCode });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error };
    const tripData = data?.data;
    if (tripData) {
      remoteIdsRef.current.add(data.trip_id);
      syncedHashRef.current[data.trip_id] = JSON.stringify(tripData);
      setTrips(prev => prev.find(t => t.id === data.trip_id) ? prev : [tripData, ...prev]);
    }
    return { tripId: data?.trip_id };
  }, [userId]);

  // ── Toutes les mutations existantes ──────────────────────────────────────

  const createTrip = useCallback((data) => {
    const id = genId();
    const trip = {
      id, name: data.name, destination: data.destination || '',
      emoji: data.emoji || '✈️',
      coverPhoto: data.coverPhoto || null,
      travelers: parseInt(data.travelers) || 1,
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
    if (userId) supabase.from('trips').delete().eq('id', tripId).then();
  }, [userId]);

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

  const reorderDay = useCallback((tripId, dayId, dir) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const arr = [...t.days];
      const i = arr.findIndex(d => d.id === dayId);
      if (i < 0) return t;
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return t;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...t, days: arr };
    }));
  }, []);

  const addToAllDays = useCallback((tripId, activity) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, days: t.days.map(d => ({
        ...d, activities: [...d.activities, { ...activity, id: genId(), status: 'todo' }]
      }))
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
          ...d, id: genId(),
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

  const restoreTrip = useCallback((tripId, snapshot) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : snapshot));
  }, []);

  const addTravelBlock = useCallback((tripId, dayId, afterActivityId, durationMin) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      return {
        ...t, days: t.days.map(d => {
          if (d.id !== dayId) return d;
          const idx = d.activities.findIndex(a => a.id === afterActivityId);
          if (idx < 0) return d;
          const travel = { id: genId(), title: 'Trajet', category: 'trajet', status: 'todo', durationHours: Math.floor(durationMin / 60), durationMinutes: durationMin % 60, address: '', notes: '', price: 0, link: '', screenshots: [], photoUrl: '', openingHours: '', lat: null, lon: null, fixedStart: null };
          const newActs = [...d.activities];
          newActs.splice(idx + 1, 0, travel);
          return { ...d, activities: newActs };
        })
      };
    }));
  }, []);

  const setDayActivitiesOrder = useCallback((tripId, dayId, orderedActivities) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, days: t.days.map(d => d.id !== dayId ? d : { ...d, activities: orderedActivities })
    }));
  }, []);

  const importTrip = useCallback((tripData) => {
    const id = genId();
    const trip = { ...tripData, id, createdAt: new Date().toISOString() };
    setTrips(p => [trip, ...p]);
    return id;
  }, []);

  // Partage legacy (shared_trips) — conservé pour compatibilité
  const enableSharing = useCallback(async (tripId) => {
    const trip = tripsRef.current.find(t => t.id === tripId);
    if (!trip) throw new Error('Trip not found');
    if (trip.shareId) return trip.shareId;
    const shareId = generateUUID();
    const tripWithShare = { ...trip, shareId };
    const { error } = await supabase.from('shared_trips').insert({ share_id: shareId, data: tripWithShare });
    if (error) throw error;
    syncedHashRef.current[shareId] = JSON.stringify(tripWithShare);
    setTrips(p => p.map(t => t.id !== tripId ? t : tripWithShare));
    return shareId;
  }, []);

  const loadSharedTrip = useCallback(async (shareId) => {
    const { data, error } = await supabase.from('shared_trips').select('data').eq('share_id', shareId).single();
    if (error) throw error;
    const remoteTrip = data.data;
    if (!remoteTrip) throw new Error('Empty trip data');
    syncedHashRef.current[shareId] = JSON.stringify(remoteTrip);
    setTrips(p => {
      const exists = p.find(t => t.shareId === shareId);
      if (exists) return p.map(t => t.shareId === shareId ? remoteTrip : t);
      return [remoteTrip, ...p];
    });
    return remoteTrip.id;
  }, []);

  const addExpense = useCallback((tripId, expense) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, expenses: [...(t.expenses || []), {
        ...expense, id: genId(),
        date: new Date().toISOString().split('T')[0],
      }]
    }));
  }, []);

  const deleteExpense = useCallback((tripId, expenseId) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, expenses: (t.expenses || []).filter(e => e.id !== expenseId)
    }));
  }, []);

  const copyDay = useCallback((tripId, sourceDayId, targetDayId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      const src = t.days.find(d => d.id === sourceDayId);
      if (!src) return t;
      const copies = src.activities.map(a => ({ ...a, id: genId(), status: 'todo' }));
      return {
        ...t, days: t.days.map(d => d.id !== targetDayId ? d : {
          ...d, activities: [...d.activities, ...copies]
        })
      };
    }));
  }, []);

  const sortDayByTime = useCallback((tripId, dayId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId) return t;
      return {
        ...t, days: t.days.map(d => {
          if (d.id !== dayId) return d;
          const withTime = d.activities.filter(a => a.fixedStart);
          const noTime = d.activities.filter(a => !a.fixedStart);
          withTime.sort((a, b) => {
            const [ah, am] = a.fixedStart.split(':').map(Number);
            const [bh, bm] = b.fixedStart.split(':').map(Number);
            return ah * 60 + am - (bh * 60 + bm);
          });
          return { ...d, activities: [...withTime, ...noTime] };
        })
      };
    }));
  }, []);

  const addDailyTemplate = useCallback((tripId, activity) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, dailyTemplates: [...(t.dailyTemplates || []), { ...activity, id: genId() }]
    }));
  }, []);

  const removeDailyTemplate = useCallback((tripId, templateId) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, dailyTemplates: (t.dailyTemplates || []).filter(a => a.id !== templateId)
    }));
  }, []);

  const fetchTripMembers = useCallback(async (tripId) => {
    const { data: members, error } = await supabase
      .from('trip_members')
      .select('user_id, role')
      .eq('trip_id', tripId);
    if (error || !members || members.length === 0) return [];
    const userIds = members.map(m => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', userIds);
    return members.map(m => ({
      userId: m.user_id,
      role: m.role,
      name: (profiles || []).find(p => p.id === m.user_id)?.name || null,
    }));
  }, []);

  const removeTripMember = useCallback(async (tripId, memberUserId) => {
    const { error } = await supabase
      .from('trip_members')
      .delete()
      .eq('trip_id', tripId)
      .eq('user_id', memberUserId);
    return error ? { error: error.message } : { success: true };
  }, []);

  return {
    trips,
    userId,
    authLoading,
    currentTrips: trips.filter(t => !isPast(t.endDate)),
    pastTrips: trips.filter(t => isPast(t.endDate)).sort((a, b) => new Date(b.endDate) - new Date(a.endDate)),
    signIn, signUp, signOut,
    enableCollaboration, joinTripByInvite,
    createTrip, updateTrip, deleteTrip, getTripById,
    addToReserve, addToDay,
    setActivityStatus, updateActivity,
    moveToReserve, moveFromReserveToDay, moveDayToDay, moveToNextDay,
    reorderActivity, reorderInReserve,
    deleteActivity, setDayStartTime, importTrip, duplicateToDay,
    duplicateTrip, setDayNotes,
    addPackingItem, togglePackingItem, deletePackingItem,
    setPackingOrder, sweepDayToReserve,
    restoreTrip, addTravelBlock, setDayActivitiesOrder,
    enableSharing, loadSharedTrip,
    reorderDay, addToAllDays,
    addExpense, deleteExpense,
    copyDay, sortDayByTime,
    addDailyTemplate, removeDailyTemplate,
    fetchTripMembers, removeTripMember,
  };
}
