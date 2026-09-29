import { accordNom, normaliser } from '../../supabase/functions/_shared/lecture-lien.ts';
import { distKm } from './enrich.js';

/**
 * Ce lieu est-il déjà dans le voyage ?
 *
 * En préparant, on retombe sur le même restaurant par trois chemins : une
 * vidéo, un guide, un ami. Sans avertissement, la Réserve se remplit de
 * doublons qu'on découvre sur place, en piochant deux fois la même idée.
 *
 * Trois indices, du plus sûr au moins sûr : le même lien, le même point
 * (moins de 60 m) sous un nom apparenté, ou exactement le même nom. Rend la
 * première fiche qui correspond, avec où elle se trouve, ou null.
 */
const SEUIL_KM = 0.06;

const lienNet = (l) => String(l || '').trim().toLowerCase()
  .replace(/^https?:\/\/(www\.)?/, '').replace(/#.*$/, '').replace(/\/+$/, '');

export function trouverDoublon(fiche, days = [], reserve = []) {
  const titre = normaliser(fiche?.title || '');
  const lien = lienNet(fiche?.link);
  const situe = Number.isFinite(fiche?.lat) && Number.isFinite(fiche?.lon);
  if (titre.length < 3 && !lien && !situe) return null;

  const candidats = [
    ...reserve.map(a => ({ a, ou: 'dans ta Réserve' })),
    ...days.flatMap((d, i) => (d.activities || []).map(a => ({ a, ou: `au Jour ${i + 1}` }))),
  ];
  for (const { a, ou } of candidats) {
    if (!a || a.isMeal || (fiche.id && a.id === fiche.id)) continue;
    if (lien && lienNet(a.link) === lien) return { activite: a, ou };
    if (situe && Number.isFinite(a.lat) && Number.isFinite(a.lon)
      && distKm(fiche.lat, fiche.lon, a.lat, a.lon) < SEUIL_KM
      && accordNom(fiche.title || '', [a.title || ''])) return { activite: a, ou };
    if (titre.length >= 3 && normaliser(a.title || '') === titre) return { activite: a, ou };
  }
  return null;
}
