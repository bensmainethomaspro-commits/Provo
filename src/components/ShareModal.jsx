import { useState } from 'react';
import { encodeTrip } from '../utils/helpers';

export default function ShareModal({ trip, onClose }) {
  const [copied, setCopied] = useState(false);

  const url = `${window.location.origin}${window.location.pathname}#share=${encodeTrip(trip)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <h2 className="modal__title">🔗 Partager le voyage</h2>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: '1.5' }}>
            Partage cette URL avec quelqu'un pour qu'il puisse importer ton voyage dans son appli.
            Toutes les données sont encodées directement dans le lien.
          </p>
          <div className="share-url">{url}</div>
          {copied && <div className="share-copied">✅ Lien copié dans le presse-papier !</div>}
        </div>
        <div className="modal__footer">
          <button className="btn btn--secondary btn--full" onClick={onClose}>Fermer</button>
          <button className="btn btn--primary btn--full" onClick={handleCopy}>
            {copied ? '✅ Copié !' : '📋 Copier le lien'}
          </button>
        </div>
      </div>
    </div>
  );
}
