import { usePiece } from '../hooks/usePiece';

/**
 * Une image du voyage, qu'elle soit une adresse, une donnée en clair ou une
 * pièce rangée à part. Tant qu'une pièce n'est pas arrivée sur ce téléphone,
 * rien ne s'affiche : pas d'icône cassée à la place d'une photo.
 */
export default function ImagePiece({ valeur, ...props }) {
  const src = usePiece(valeur);
  if (!src) return null;
  return <img src={src} {...props} />;
}
