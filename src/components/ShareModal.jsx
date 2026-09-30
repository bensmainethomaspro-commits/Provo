import { useState } from 'react';
import { encodeTrip } from '../utils/helpers';
import { useTripsContext } from '../context/TripsContext';

/**
 * Partager un voyage : deux intentions, et chacune dit ce qu'elle fait.
 *
 * Avant, trois notions dans deux écrans : un « partage collaboratif » qui
 * promettait le temps réel et n'était qu'une photo figée (dans une table que
 * n'importe qui pouvait lister, audit A-001), un « import statique », et le
 * vrai lien d'invitation, rangé à part dans les Paramètres du voyage. Une
 * intention, un geste (règle A7) :
 *
 *  · Inviter à modifier ensemble : le lien d'invitation. Même programme, mêmes
 *    dépenses, pour tout le monde. Il faut un compte ; sans compte, la raison
 *    et le geste qui débloque (règle A8), jamais un bouton mort.
 *  · Envoyer une copie : l'ami reçoit le voyage pour lui, et ce qu'il y change
 *    ne touche pas au tien.
 */
export default function ShareModal({ trip, onClose, onShowAuth }) {
  const { userId, enableCollaboration, creerCopiePartagee } = useTripsContext();
  const [invitation, setInvitation] = useState(null);
  const [copie, setCopie] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const [erreur, setErreur] = useState('');
  const [fait, setFait] = useState('');

  const base = `${window.location.origin}${window.location.pathname}`;

  // Le menu de partage du téléphone quand il existe (messagerie, mail…),
  // sinon le presse-papier. Dans les deux cas, on dit ce qui s'est passé.
  const transmettre = async (url, titre, quoi) => {
    setErreur('');
    if (navigator.share) {
      try { await navigator.share({ title: titre, url }); setFait(quoi); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setFait(`${quoi} · lien copié`);
  };

  const inviter = async () => {
    setEnCours('invitation'); setErreur(''); setFait('');
    try {
      const code = invitation || await enableCollaboration(trip.id);
      if (!code) throw new Error('pas de code');
      setInvitation(code);
      await transmettre(`${base}?invite=${code}`, `Rejoins mon voyage « ${trip.name} »`, 'Invitation prête');
    } catch {
      setErreur("L'invitation n'a pas pu être créée. Vérifie ta connexion et réessaie.");
    } finally {
      setEnCours(null);
    }
  };

  const envoyerCopie = async () => {
    setEnCours('copie'); setErreur(''); setFait('');
    try {
      let url;
      if (userId) {
        const id = copie || await creerCopiePartagee(trip.id);
        setCopie(id);
        url = `${base}?share=${id}`;
      } else {
        // Sans compte, le voyage voyage DANS le lien. Ça marche sans serveur,
        // mais un gros voyage fait un lien très long.
        url = `${base}#share=${encodeTrip(trip)}`;
      }
      await transmettre(url, `Copie du voyage « ${trip.name} »`, 'Copie prête');
    } catch {
      setErreur("La copie n'a pas pu être créée. Vérifie ta connexion et réessaie.");
    } finally {
      setEnCours(null);
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

          <div className="share-section">
            <div className="share-section__label">
              <span className="share-section__badge share-section__badge--collab">👥 Modifier ensemble</span>
              <span className="share-section__desc">
                Tes proches rejoignent ce voyage : même programme, mêmes dépenses, pour tout le monde.
              </span>
            </div>
            {userId ? (
              <button className="btn btn--primary btn--full" onClick={inviter} disabled={!!enCours}>
                {enCours === 'invitation' ? '⏳ Préparation…' : '📨 Inviter'}
              </button>
            ) : (
              <>
                <p className="share-section__desc">Il faut un compte pour inviter : c'est lui qui garde le voyage commun.</p>
                <button className="btn btn--primary btn--full" onClick={() => { onClose(); onShowAuth?.(); }}>
                  🔑 Se connecter
                </button>
              </>
            )}
          </div>

          <div className="share-divider">ou</div>

          <div className="share-section">
            <div className="share-section__label">
              <span className="share-section__badge">📤 Envoyer une copie</span>
              <span className="share-section__desc">
                Ton ami reçoit le voyage pour lui. Ce qu'il y change ne touche pas au tien.
              </span>
            </div>
            <button className="btn btn--secondary btn--full" onClick={envoyerCopie} disabled={!!enCours}>
              {enCours === 'copie' ? '⏳ Préparation…' : '📤 Envoyer une copie'}
            </button>
          </div>

          {fait && <div className="share-copied" role="status">✅ {fait}</div>}
          {erreur && <div className="share-error" role="alert">{erreur}</div>}
        </div>
        <div className="modal__footer">
          <button className="btn btn--secondary btn--full" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
