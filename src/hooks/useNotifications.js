import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { VAPID_PUBLIC_KEY } from '../lib/vapid';

/**
 * Les rappels du voyage : « tu pars dans 20 minutes », « le musée ferme dans
 * une heure », « Léa a ajouté une idée ».
 *
 * **Sur iPhone, il faut que Provo soit sur l'écran d'accueil.** Le Web Push
 * existe depuis iOS 16.4, mais Safari refuse l'abonnement à un onglet ordinaire.
 * Ce n'est pas une panne : le dire est la seule réponse honnête, et c'est
 * exactement le genre de limite qu'on préfère annoncer plutôt que laisser
 * découvrir.
 *
 * L'abonnement est rangé côté serveur avec le compte : c'est lui qui sait
 * quels voyages regarder. Sans compte connecté, on ne propose rien — il n'y
 * aurait personne à qui envoyer.
 */

const CLE = VAPID_PUBLIC_KEY;

function versOctets(base64url) {
  const b64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(b64);
  return Uint8Array.from(brut, c => c.charCodeAt(0));
}

/** Ce que le navigateur sait faire, avant même de demander quoi que ce soit. */
export function etatNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iPhone en onglet Safari : `PushManager` n'existe tout simplement pas.
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const installee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return { possible: false, raison: iOS && !installee ? 'ios_onglet' : 'navigateur' };
  }
  if (!CLE) return { possible: false, raison: 'non_configure' };
  return { possible: true, raison: null };
}

export function useNotifications(userId) {
  const [etat] = useState(etatNotifications);
  const [actives, setActives] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!etat.possible) return;
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setActives(!!sub))
      .catch(() => {});
  }, [etat.possible]);

  const activer = useCallback(async () => {
    setMessage('');
    setEnCours(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage(permission === 'denied'
          ? "Les notifications sont refusées pour Provo. Ça se rouvre dans les réglages du téléphone."
          : 'Rien de changé.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: versOctets(CLE),
      });
      const j = sub.toJSON();
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: j.endpoint,
        p256dh: j.keys.p256dh,
        auth: j.keys.auth,
        user_id: userId,
        // Le fuseau sert à ne pas réveiller quelqu'un à trois heures du matin
        // parce que le serveur, lui, est à Francfort.
        fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
      }, { onConflict: 'endpoint' });
      if (error) {
        await sub.unsubscribe().catch(() => {});
        setMessage("L'abonnement n'a pas pu être enregistré. Réessaie plus tard.");
        return;
      }
      setActives(true);
    } catch (e) {
      setMessage(`L'abonnement a échoué (${String(e.message || e).slice(0, 60)}).`);
    } finally {
      setEnCours(false);
    }
  }, [userId]);

  const desactiver = useCallback(async () => {
    setMessage('');
    setEnCours(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setActives(false);
    } catch {
      setMessage("La désinscription n'a pas abouti — recharge l'app et réessaie.");
    } finally {
      setEnCours(false);
    }
  }, []);

  return { etat, actives, enCours, message, activer, desactiver };
}
