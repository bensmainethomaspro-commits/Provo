import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fusionnerVoyages, dateLocale } from '../utils/helpers';

const STORAGE_KEY = 'provo_trips';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    days.push({ id: genId(), date: dateLocale(cursor), activities: buildMealActivities(), startTime: '09:00' });
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
  // `addToReserve` est mémoïsé sur une liste de dépendances vide : sans ref, il
  // capturerait l'identifiant du premier rendu, c'est-à-dire `null`.
  const userIdRef = useRef(null);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  const [userEmail, setUserEmail] = useState(null);
  const [userProfile, setUserProfile] = useState({ name: null, emoji: null });
  const [authLoading, setAuthLoading] = useState(true);
  // Vrai dès qu'une écriture locale échoue : le voyage ne tient plus dans le
  // stockage du navigateur, et tout ce qui n'est pas parti chez Supabase est
  // en sursis. Ça se dit à l'écran.
  const [stockagePlein, setStockagePlein] = useState(false);
  // Le drapeau est doublé d'une référence : sans elle, on appellerait setState
  // à chaque sauvegarde — donc à chaque frappe. On ne rend l'information à
  // React qu'au moment où elle change vraiment.
  const pleinRef = useRef(false);
  const syncedHashRef = useRef({});
  // La dernière version réellement synchronisée, en entier. L'empreinte seule
  // dit QUE ça a changé, jamais CE QU'IL Y AVAIT — et sans ça une fusion ne
  // peut pas distinguer « ajouté ici » de « supprimé là-bas ».
  const baseFusionRef = useRef({});
  const syncTimeouts = useRef({});
  // Les dépenses dont il reste à prévenir les autres voyageurs. La notification
  // était tirée AVANT l'écriture qu'elle annonce : hors ligne, l'appel partait
  // dans le vide, et la fonction Edge — qui relit la dépense en base — n'avait
  // rien à lire. Elle part maintenant APRÈS une écriture acceptée.
  const notifsEnAttente = useRef({});
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
      baseFusionRef.current[t.id] = JSON.parse(JSON.stringify(t));
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
        baseFusionRef.current = {};
      }
    });
    return () => subscription.unsubscribe();
  }, [loadFromSupabase, applySession]);

  // ── Cache localStorage (toujours) ─────────────────────────────────────────
  // Vrai dès qu'une écriture locale échoue : le voyage ne tient plus.
  // Synchroniser React avec un système extérieur (le stockage du navigateur)
  // est exactement ce à quoi un effet sert ; l'écriture ne se produit qu'au
  // changement d'état. (La règle `set-state-in-effect` ne se déclenche plus
  // ici : la directive qui la taisait était devenue morte.)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
      if (pleinRef.current) { pleinRef.current = false; setStockagePlein(false); }
    } catch (e) {
      // Photos de couverture, captures et PDF sont stockés en base64 dans le
      // voyage : le stockage local tient 5,1 Mo — mesuré — et il se dépasse
      // vite. L'écriture échoue alors pour TOUT le reste aussi, et ce qui n'est
      // pas encore parti vers Supabase disparaît au rechargement.
      //
      // C'est la pire panne possible : silencieuse, et elle mange le travail.
      // Elle se dit maintenant à l'écran, pas dans une console que personne
      // n'ouvre sur un téléphone.
      console.error('[Provo] Sauvegarde locale impossible :', e?.name || e);
      if (!pleinRef.current) { pleinRef.current = true; setStockagePlein(true); }
    }
  }, [trips]);

  /**
   * Prévenir les autres voyageurs qu'une dépense commune vient d'être notée.
   *
   * Rien n'est envoyé d'ici : le téléphone ne voit pas les abonnements des
   * autres (la table n'expose que les siens) et ne détient pas les clés. On
   * passe deux identifiants à la fonction Edge, qui relit la dépense en base et
   * écrit elle-même le texte — sinon n'importe quel membre pourrait faire
   * afficher n'importe quoi sur le téléphone des autres.
   *
   * Appelé APRÈS une écriture acceptée, jamais avant : la fonction Edge relit
   * la dépense en base, et une dépense pas encore écrite n'existe pour personne.
   * Hors ligne, l'identifiant reste en file et repart à la première écriture
   * qui passe. Il ne survit pas à la fermeture de l'app, et c'est voulu :
   * « Léa a ajouté une dépense » trois heures plus tard n'aide plus personne.
   *
   * Silencieux par construction : une notification qui ne part pas ne doit
   * jamais gêner celui qui est en train de noter une dépense.
   */
  const viderLesNotifs = useCallback((tripId) => {
    const enAttente = notifsEnAttente.current[tripId];
    if (!enAttente?.size || !userIdRef.current) return;
    delete notifsEnAttente.current[tripId];
    for (const expenseId of enAttente) {
      supabase.functions
        .invoke('notifier-depense', { body: { tripId, expenseId } })
        .catch(() => {});
    }
  }, []);

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
          } else {
            // Écriture acceptée : c'est désormais ce que les deux côtés savent.
            baseFusionRef.current[trip.id] = JSON.parse(hash);
            viderLesNotifs(trip.id);
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
            baseFusionRef.current[trip.id] = JSON.parse(hash);
            viderLesNotifs(trip.id);
          }
        }
      }, 700);
    });
  }, [trips, userId, viderLesNotifs]);

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
          // FUSIONNER, ne pas remplacer. Le remplacement effaçait la dépense
          // qu'on venait de saisir et que le débounce n'avait pas encore
          // envoyée : deux appareils sur le même compte se volaient leurs
          // ajouts. `base` est la dernière version que les deux côtés
          // connaissaient — c'est elle qui distingue un ajout d'ici d'une
          // suppression de là-bas.
          const fusionne = fusionnerVoyages(baseFusionRef.current[tripId], existing, remoteTrip);
          const fusionneHash = JSON.stringify(fusionne);
          // La base avance jusqu'au distant : c'est ce que le serveur porte.
          baseFusionRef.current[tripId] = JSON.parse(remoteHash);
          // Si la fusion a gardé quelque chose que le serveur n'a pas, il ne
          // faut PAS marquer le voyage comme synchronisé : l'effet d'écriture
          // doit repartir pour y renvoyer ce qui manque.
          if (fusionneHash === remoteHash) syncedHashRef.current[tripId] = remoteHash;
          else delete syncedHashRef.current[tripId];
          return prev.map(t => t.id === tripId ? fusionne : t);
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trips' }, (payload) => {
        const newTrip = payload.new?.data;
        const tripId = payload.new?.id;
        if (!newTrip || !tripId) return;
        remoteIdsRef.current.add(tripId);
        syncedHashRef.current[tripId] = JSON.stringify(newTrip);
        baseFusionRef.current[tripId] = JSON.parse(JSON.stringify(newTrip));
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
      baseFusionRef.current[data.trip_id] = JSON.parse(JSON.stringify(tripData));
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
      // Qui a proposé l'idée : à plusieurs, la Réserve devient une liste
      // commune où l'on ne sait plus qui a mis quoi — et une idée sans auteur
      // ne se discute pas. Posé à l'ajout, jamais modifié ensuite.
      ...t, reserve: [...t.reserve, { ...activity, id, status: 'todo', proposePar: userIdRef.current || null }]
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
    // L'identifiant est tiré ICI, pas dans la mise à jour : celle-ci peut être
    // rejouée par React, et il faut de toute façon savoir de quelle dépense on
    // parle pour la signaler aux autres.
    const id = genId();
    setTrips(p => p.map(t => t.id !== tripId ? t : {
      ...t, expenses: [...(t.expenses || []), {
        ...expense, id,
        // La date vient du formulaire quand on l'a choisie. Elle était écrasée
        // par celle du jour : le champ « Quand » existait à l'écran et ne
        // servait à rien, et une dépense notée le lendemain se rangeait au
        // mauvais jour sans que rien ne le signale.
        date: expense.date || dateLocale(new Date()),
      }]
    }));
    // Seulement ce qui concerne plusieurs personnes. Une dépense pour soi seul
    // n'a rien à annoncer, et ce filtre évite un appel inutile à chaque saisie
    // sur un voyage sans collaborateur. Mise en FILE : c'est la synchro qui
    // préviendra, une fois la dépense réellement écrite.
    if ((expense.participantIds || []).length >= 2 || expense.isSettlement) {
      (notifsEnAttente.current[tripId] ||= new Set()).add(id);
    }
    return id;
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
    stockagePlein,
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
