import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'provo_trips';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildMealActivities() {
  return [
    { id: genId(), title: 'Repas midi', category: 'resto', status: 'todo', price: '20', durationHours: 1, durationMinutes: 0, isMeal: true, mealSlot: 'midi', fixedStart: '12:00', travelerIds: [] },
    { id: genId(), title: 'Repas soir', category: 'resto', status: 'todo', price: '20', durationHours: 1, durationMinutes: 30, isMeal: true, mealSlot: 'soir', fixedStart: '19:00', travelerIds: [] },
  ];
}

function ensureMeals(day) {
  const hasMidi = day.activities.some(a => a.isMeal && a.mealSlot === 'midi');
  const hasSoir = day.activities.some(a => a.isMeal && a.mealSlot === 'soir');
  if (hasMidi && hasSoir) return day;
  const extras = [];
  if (!hasMidi) extras.push({ id: genId(), title: 'Repas midi', category: 'resto', status: 'todo', price: '20', durationHours: 1, durationMinutes: 0, isMeal: true, mealSlot: 'midi', fixedStart: '12:00', travelerIds: [] });
  if (!hasSoir) extras.push({ id: genId(), title: 'Repas soir', category: 'resto', status: 'todo', price: '20', durationHours: 1, durationMinutes: 30, isMeal: true, mealSlot: 'soir', fixedStart: '19:00', travelerIds: [] });
  return { ...day, activities: [...day.activities, ...extras] };
}

function migrateMeals(trips) {
  return trips.map(t => ({ ...t, days: t.days.map(ensureMeals) }));
}

function buildDays(startDate, endDate) {
  const days = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (cursor <= end) {
    days.push({ id: genId(), date: localDateStr(cursor), activities: buildMealActivities(), startTime: '09:00' });
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
  const [trips, setTrips] = useState(() => migrateMeals(load()));
  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [userProfile, setUserProfile] = useState({ name: null, emoji: null });
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
      return migrateMeals([...cloudTrips, ...localOnly]);
    });
  }, []);

  const applySession = useCallback((session) => {
    const uid = session?.user?.id ?? null;
    const meta = session?.user?.user_metadata || {};
    setUserId(uid);
    setUserEmail(session?.user?.email ?? null);
    setUserProfile({ name: meta.display_name ?? null, emoji: meta.profile_emoji ?? null });
    // Sync display_name to profiles table so other trip members can see it
    if (uid && meta.display_name) {
      supabase.from('profiles')
        .upsert({ id: uid, name: meta.display_name }, { onConflict: 'id' })
        .then(({ error }) => {
          // Sans cette ligne, les autres membres du voyage voient un identifiant
          // à la place du prénom, sans qu'aucune erreur ne le signale.
          if (error) console.error('[Provo] Publication du profil refusée :', error.message);
        });
    }
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
      setAuthLoading(false);
      if (session?.user?.id) loadFromSupabase(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      applySession(session);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user?.id) loadFromSupabase(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        setTrips([]);
        remoteIdsRef.current = new Set();
        syncedHashRef.current = {};
      }
    });
    return () => subscription.unsubscribe();
  }, [loadFromSupabase, applySession]);

  // ── Cache localStorage (toujours) ─────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
    } catch (e) {
      // Photos de couverture, captures et PDF sont stockés en base64 dans le
      // voyage : le quota du navigateur (~5 Mo) se dépasse vite. L'écriture
      // échoue alors pour tout le reste aussi, et ce qui n'est pas encore parti
      // vers Supabase disparaît au rechargement. À défaut de mieux, ne plus
      // avaler l'échec en silence.
      console.error('[Provo] Sauvegarde locale impossible :', e?.name || e);
    }
  }, [trips]);

  // ── Sync vers Supabase (debounced, 700ms) ────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    trips.forEach(trip => {
      const hash = JSON.stringify(trip);
      if (syncedHashRef.current[trip.id] === hash) return;
      clearTimeout(syncTimeouts.current[trip.id]);
      syncTimeouts.current[trip.id] = setTimeout(async () => {
        // L'empreinte est posée avant l'écriture pour qu'un rendu intermédiaire
        // ne relance pas la même requête. Mais si l'écriture échoue (hors ligne,
        // RLS), la garder revient à déclarer synchronisé ce qui ne l'est pas :
        // la modification ne repart jamais, et le nuage — resté en arrière —
        // l'écrase au prochain chargement. On la retire donc en cas d'échec,
        // pour que la prochaine modification du voyage la remonte avec elle.
        syncedHashRef.current[trip.id] = hash;
        if (remoteIdsRef.current.has(trip.id)) {
          const { error } = await supabase.from('trips')
            .update({ data: trip, updated_at: new Date().toISOString() })
            .eq('id', trip.id);
          if (error) {
            delete syncedHashRef.current[trip.id];
            console.error('[Provo] Écriture du voyage refusée :', error.message);
          }
        } else {
          const { error } = await supabase.from('trips').insert({
            id: trip.id, owner_id: userId,
            data: trip, updated_at: new Date().toISOString(),
          });
          if (error) {
            delete syncedHashRef.current[trip.id];
            console.error('[Provo] Création du voyage refusée :', error.message);
          } else {
            remoteIdsRef.current.add(trip.id);
          }
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

  const resetPassword = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return error ? { error: error.message || error.toString() } : { success: true };
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
    // Seul le propriétaire a le droit de supprimer : pour un collaborateur la
    // requête est refusée en silence, le voyage disparaît de l'écran puis
    // revient au chargement suivant. Au minimum, la trace apparaît en console.
    if (userId) {
      supabase.from('trips').delete().eq('id', tripId).then(({ error }) => {
        if (error) console.error('[Provo] Suppression du voyage refusée :', error.message);
      });
    }
  }, [userId]);

  const getTripById = useCallback((id) => trips.find(t => t.id === id), [trips]);

  const addToReserve = useCallback((tripId, activity) => {
    // L'identifiant est créé ici (et non dans l'updater) pour pouvoir être
    // renvoyé : l'enrichissement automatique en a besoin pour compléter la
    // fiche une fois les informations récupérées en ligne.
    const id = genId();
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, reserve: [...t.reserve, { ...activity, id, status: 'todo' }]
    }));
    return id;
  }, []);

  const addToDay = useCallback((tripId, dayId, activity) => {
    const id = genId();
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, days: t.days.map(d => d.id !== dayId ? d : {
        ...d, activities: [...d.activities, { ...activity, id, status: 'todo' }]
      })
    }));
    return id;
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

  /**
   * Déplace une idée devant une autre. Les flèches ne déplacent que d'un cran :
   * remonter la 12e en tête demandait onze taps. Le glisser-déposer a besoin
   * d'une insertion à une position quelconque, pas d'un échange.
   */
  const moveInReserve = useCallback((tripId, activityId, targetId) => {
    setTrips(p => p.map(t => {
      if (t.id !== tripId || activityId === targetId) return t;
      const arr = [...t.reserve];
      const from = arr.findIndex(a => a.id === activityId);
      if (from < 0) return t;
      const [item] = arr.splice(from, 1);
      // `targetId` nul = dépôt en fin de liste.
      const to = targetId ? arr.findIndex(a => a.id === targetId) : arr.length;
      arr.splice(to < 0 ? arr.length : to, 0, item);
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
        date: localDateStr(new Date()),
      }]
    }));
  }, []);

  const updateExpense = useCallback((tripId, expenseId, patch) => {
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, expenses: (t.expenses || []).map(e => e.id === expenseId ? { ...e, ...patch } : e)
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

  const userProfileRef = useRef(null);
  useEffect(() => { userProfileRef.current = userProfile; }, [userProfile]);

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
    return members.map(m => {
      const profileName = (profiles || []).find(p => p.id === m.user_id)?.name || null;
      // Fallback to local auth metadata for the current user (in case profiles UPDATE is blocked by RLS)
      const name = profileName || (m.user_id === userId ? (userProfileRef.current?.name || null) : null);
      return { userId: m.user_id, role: m.role, name };
    });
  }, [userId]);

  const removeTripMember = useCallback(async (tripId, memberUserId) => {
    const { error } = await supabase
      .from('trip_members')
      .delete()
      .eq('trip_id', tripId)
      .eq('user_id', memberUserId);
    return error ? { error: error.message } : { success: true };
  }, []);

  const updateProfile = useCallback(async ({ name, emoji }) => {
    const meta = {};
    if (name !== undefined) meta.display_name = name;
    if (emoji !== undefined) meta.profile_emoji = emoji;
    const { error } = await supabase.auth.updateUser({ data: meta });
    if (error) return { error: error.message };
    if (name !== undefined && userId) {
      await supabase.from('profiles').upsert({ id: userId, name }, { onConflict: 'id' });
    }
    setUserProfile(prev => ({
      name: name !== undefined ? name : prev.name,
      emoji: emoji !== undefined ? emoji : prev.emoji,
    }));
    return { success: true };
  }, [userId]);

  return {
    trips,
    userId,
    userEmail,
    userProfile,
    updateProfile,
    authLoading,
    currentTrips: trips.filter(t => !isPast(t.endDate)),
    pastTrips: trips.filter(t => isPast(t.endDate)).sort((a, b) => new Date(b.endDate) - new Date(a.endDate)),
    signIn, signUp, signOut, resetPassword,
    enableCollaboration, joinTripByInvite,
    createTrip, updateTrip, deleteTrip, getTripById,
    addToReserve, addToDay,
    setActivityStatus, updateActivity,
    moveToReserve, moveFromReserveToDay, moveDayToDay, moveToNextDay,
    reorderActivity, reorderInReserve, moveInReserve,
    deleteActivity, setDayStartTime, importTrip, duplicateToDay,
    duplicateTrip, setDayNotes,
    addPackingItem, togglePackingItem, deletePackingItem,
    setPackingOrder, sweepDayToReserve,
    restoreTrip, addTravelBlock, setDayActivitiesOrder,
    enableSharing, loadSharedTrip,
    reorderDay, addToAllDays,
    addExpense, updateExpense, deleteExpense,
    copyDay, sortDayByTime,
    addDailyTemplate, removeDailyTemplate,
    fetchTripMembers, removeTripMember,
  };
}
