/**
 * Une icône d'interface : un seul trait, une seule grille, la couleur du texte.
 *
 * Jusqu'au 1er octobre 2026, l'interface dessinait ses commandes avec des
 * émojis (130 différents dans le code). Un émoji ne se teinte pas, il change
 * de dessin d'un téléphone à l'autre, et certains disent faux : l'onglet
 * Planning affichait 📅 « 17 juillet » toute l'année.
 *
 * Règle tenue depuis : **l'émoji est du contenu, l'icône est du chrome.**
 * Un émoji reste là où l'utilisateur le choisit lui-même (émoji du voyage,
 * catégorie, voyageur, drapeau). Partout où l'app dessine une commande, elle
 * passe par ce composant.
 *
 * Les dessins viennent de Lucide (licence ISC), importés un par un : seuls
 * ceux qu'on utilise entrent dans le paquet.
 */
export default function Icone({ de: Dessin, taille = 20, className = '' }) {
  return (
    <Dessin
      size={taille}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
      className={`icone${className ? ` ${className}` : ''}`}
    />
  );
}
