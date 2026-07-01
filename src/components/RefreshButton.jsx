// Forces the installed/cached app onto the latest Vercel deploy: clears cached
// assets, pulls the newest service worker, and reloads from the network — without
// having to re-add the app to the home screen.
async function forceRefreshApp() {
  try {
    // Clear ALL caches (the app shell + tiles).
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // Fully unregister the service worker so the next load isn't served by a
    // stale worker — this is what was missing before (update() alone leaves the
    // old worker in control, so the reload kept showing the old version).
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch { /* ignore */ }
  // Cache-busting navigation so no HTTP/bfcache serves a stale shell either.
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('_r', Date.now().toString());
    window.location.replace(u.toString());
  } catch {
    window.location.reload();
  }
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
