import { useState } from 'react';
import { encodeTrip } from '../utils/helpers';
import { useTripsContext } from '../context/TripsContext';

export default function ShareModal({ trip, onClose }) {
  const { enableSharing } = useTripsContext();
  const [copied, setCopied] = useState(false);
  const [collabUrl, setCollabUrl] = useState(
    trip.shareId ? `${window.location.origin}${window.location.pathname}?share=${trip.shareId}` : null
  );
  const [collabLoading, setCollabLoading] = useState(false);
  const [collabError, setCollabError] = useState(null);
  const [collabCopied, setCollabCopied] = useState(false);

  const staticUrl = `${window.location.origin}${window.location.pathname}#share=${encodeTrip(trip)}`;

  const copyText = async (text, setDone) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  };

  const handleEnableCollab = async () => {
    setCollabLoading(true);
    setCollabError(null);
    try {
      const shareId = await enableSharing(trip.id);
      const url = `${window.location.origin}${window.location.pathname}?share=${shareId}`;
      setCollabUrl(url);
    } catch (e) {
      setCollabError('Erreur de connexion. Vérifie ta connexion internet.');
    } finally {
      setCollabLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <h2 className="modal__title">🔗 Partager le voyage</h2>
          <button aria-label="Fermer" className="sheet__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Collaborative share */}
          <div className="share-section">
            <div className="share-section__label">
              <span className="share-section__badge share-section__badge--collab">✦ Collaboratif</span>
              <span className="share-section__desc">Tes amis voient et modifient le voyage en temps réel</span>
            </div>
            {collabUrl ? (
              <>
                <div className="share-url share-url--collab">{collabUrl}</div>
                {collabCopied && <div className="share-copied">✅ Lien copié !</div>}
                <button className="btn btn--primary btn--full" onClick={() => copyText(collabUrl, setCollabCopied)}>
                  {collabCopied ? '✅ Copié !' : '📋 Copier le lien collaboratif'}
                </button>
              </>
            ) : (
              <>
                {collabError && <div className="share-error">{collabError}</div>}
                <button
                  className="btn btn--primary btn--full"
                  onClick={handleEnableCollab}
                  disabled={collabLoading}
                >
                  {collabLoading ? '⏳ Activation...' : '🚀 Activer le partage collaboratif'}
                </button>
              </>
            )}
          </div>

          <div className="share-divider">ou</div>

          {/* Static share */}
          <div className="share-section">
            <div className="share-section__label">
              <span className="share-section__badge">📤 Import statique</span>
              <span className="share-section__desc">Ton ami importe une copie du voyage (sans sync)</span>
            </div>
            <div className="share-url">{staticUrl.length > 80 ? staticUrl.slice(0, 80) + '…' : staticUrl}</div>
            {copied && <div className="share-copied">✅ Lien copié !</div>}
            <button className="btn btn--secondary btn--full" onClick={() => copyText(staticUrl, setCopied)}>
              {copied ? '✅ Copié !' : '📋 Copier le lien statique'}
            </button>
          </div>

        </div>
        <div className="modal__footer">
          <button className="btn btn--secondary btn--full" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
