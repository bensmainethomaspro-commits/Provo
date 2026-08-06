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

  // `serviceWorker.ready` ne se résout jamais si aucun worker n'a été
  // enregistré dans ce contexte — et une app fraîchement posée sur l'écran
  // d'accueil démarre avec son propre stockage, donc son propre worker. Sans
  // délai maximum, l'interrupteur reste sur « … » indéfiniment : ça se lit
  // comme une panne, sans jamais dire laquelle.
  const workerPret = () => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, ko) => setTimeout(() => ko(new Error('worker_absent')), 8000)),
  ]);

  const activer = useCallback(async () => {
    setMessage('');
    setEnCours(true);
    // Chaque étape porte son nom : quand ça casse, on sait OÙ, au lieu de
    // « ça ne marche pas ». Trois fois dans ce projet un correctif a été livré
    // sur une cause supposée ; ici la panne se désigne elle-même.
    let etape = 'permission';
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage(permission === 'denied'
          ? "iOS a refusé — Réglages › Notifications › Provo pour rouvrir."
          : "La demande n'a pas abouti. Retouche l'interrupteur.");
        return;
      }

      etape = 'worker';
      const reg = await workerPret();

      etape = 'abonnement';
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: versOctets(CLE),
      });

      etape = 'compte';
      if (!userId) {
        await sub.unsubscribe().catch(() => {});
        setMessage("Il faut être connecté : c'est le compte qui dit quels voyages surveiller.");
        return;
      }

      etape = 'enregistrement';
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
        setMessage(`Enregistrement refusé : ${String(error.message || error).slice(0, 90)}`);
        return;
      }
      setActives(true);
    } catch (e) {
      const brut = String(e?.message || e);
      setMessage(brut.includes('worker_absent')
        ? "Le service en arrière-plan n'a pas démarré. Ferme complètement Provo, rouvre-le depuis l'icône, et réessaie."
        : `Bloqué à l'étape « ${etape} » : ${brut.slice(0, 90)}`);
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
