import { createPortal } from 'react-dom';

/**
 * Installer Provo sur iPhone.
 *
 * iOS n'expose pas `beforeinstallprompt` : aucun bouton ne peut déclencher
 * l'installation, contrairement à Android. Le seul chemin passe par le menu de
 * partage de Safari. On ne peut pas le faire à la place de l'utilisateur — on
 * peut au moins arrêter de laisser croire que la fonction n'existe pas.
 *
 * Rendu par portail : la feuille doit couvrir l'écran, or ses ancêtres portent
 * des transformations qui redéfiniraient le référentiel d'un `position: fixed`.
 */
export default function InstallIosSheet({ onClose }) {
  return createPortal(
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet install-ios">
        <div className="sheet__header">
          <h2 className="sheet__title">Installer Provo</h2>
          <button className="sheet__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="sheet__body">
          <p className="install-ios__intro">
            Sur iPhone, l'installation passe par Safari — trois gestes, une fois
            pour toutes. L'app s'ouvre ensuite en plein écran et fonctionne hors
            connexion.
          </p>

          <ol className="install-ios__steps">
            <li>
              <span className="install-ios__num">1</span>
              <span>
                Touche <strong>Partager</strong> en bas de Safari
                <span className="install-ios__glyph" aria-hidden="true"> ⬆︎ </span>
              </span>
            </li>
            <li>
              <span className="install-ios__num">2</span>
              <span>Fais défiler et choisis <strong>Sur l'écran d'accueil</strong></span>
            </li>
            <li>
              <span className="install-ios__num">3</span>
              <span>Confirme avec <strong>Ajouter</strong></span>
            </li>
          </ol>

          <p className="install-ios__note">
            Le bouton Partager n'apparaît que dans Safari. Depuis Chrome ou
            l'aperçu d'une autre application, ouvre d'abord la page dans Safari.
          </p>
        </div>

        <div className="sheet__footer">
          <button className="btn btn--primary" style={{ width: '100%' }} onClick={onClose}>
            J'ai compris
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
