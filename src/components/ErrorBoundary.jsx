import { Component } from 'react';

// Catches any render/lifecycle error so the app never dies to a blank screen.
// Data is safe (localStorage + Supabase) — we offer a reload and a hard reset
// of caches/service worker for when a bad deploy or stale cache is the cause.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Provo] Uncaught render error:', error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleHardReset = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch { /* ignore */ }
    const u = new URL(window.location.origin);
    u.searchParams.set('_r', Date.now().toString());
    window.location.replace(u.toString());
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen">
        <div className="error-screen__card">
          <div className="error-screen__icon">🧳</div>
          <h1 className="error-screen__title">Oups, un imprévu de voyage…</h1>
          <p className="error-screen__text">
            L'application a rencontré une erreur. Tes voyages sont en sécurité —
            recharge pour reprendre où tu en étais.
          </p>
          <div className="error-screen__actions">
            <button className="btn btn--primary btn--full" onClick={this.handleReload}>
              🔄 Recharger l'application
            </button>
            <button className="btn btn--secondary btn--full" onClick={this.handleHardReset}>
              🧹 Vider le cache et recharger
            </button>
          </div>
          <details className="error-screen__details">
            <summary>Détails techniques</summary>
            <pre>{String(this.state.error?.stack || this.state.error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
