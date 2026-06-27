// Forces the installed/cached app onto the latest Vercel deploy: clears cached
// assets, pulls the newest service worker, and reloads from the network — without
// having to re-add the app to the home screen.
async function forceRefreshApp() {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); await reg.update(); }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== 'provo-tiles-v1').map(k => caches.delete(k)));
    }
  } catch { /* ignore */ }
  window.location.reload();
}

export default function RefreshButton({ className = 'btn btn--ghost-white btn--sm' }) {
  return (
    <button
      className={className}
      onClick={forceRefreshApp}
      title="Mettre à jour vers la dernière version"
      aria-label="Rafraîchir l'application"
    >
      🔄
    </button>
  );
}
