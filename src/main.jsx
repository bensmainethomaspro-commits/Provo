import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  // Quand une NOUVELLE version prend la main, on recharge pour être à jour.
  //
  // Deux pièges refermés (audit du 30 septembre 2026, reproduits) :
  //  · à la toute première installation, `clients.claim()` déclenche aussi
  //    cet événement. On rechargeait donc au premier lancement — et l'app
  //    avait déjà retiré de l'adresse le lien qui l'avait ouverte
  //    (`?invite=`, `?share=`, `?voyage=`, `?ajout=`). Une invitation ouverte
  //    par quelqu'un qui n'avait jamais lancé Provo ne faisait rien. Sans
  //    ancienne version aux commandes, il n'y a rien à rattraper ;
  //  · recharger sur-le-champ coupe une saisie en cours. On attend que l'app
  //    passe en arrière-plan : la personne ne le voit pas, et l'écriture
  //    locale est vidée avant (`useTrips`, sur ce même événement).
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let aRecharger = false;
  const rechargerSiCachee = () => {
    if (document.visibilityState === 'hidden') window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitUneVersion || aRecharger) return;
    aRecharger = true;
    if (document.visibilityState === 'hidden') window.location.reload();
    else document.addEventListener('visibilitychange', rechargerSiCachee);
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const promote = (sw) => {
        if (sw && sw.state === 'installed' && navigator.serviceWorker.controller) {
          sw.postMessage({ type: 'SKIP_WAITING' });
        }
      };
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => promote(nw));
      });
      // Check for a newer deployed version on launch, periodically, and on focus.
      reg.update();
      setInterval(() => reg.update(), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(() => {});
  });
}
