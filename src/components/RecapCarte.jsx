import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_COLORS } from '../utils/helpers';

/**
 * Le trajet réellement parcouru, dessiné.
 *
 * Un bilan chiffré dit ce qu'on a fait ; une carte le fait *revoir*. C'est ce
 * qui donne envie de rouvrir un voyage terminé — le pourcentage, non.
 *
 * Ne montre que ce qui a eu lieu : les activités marquées faites, dans l'ordre
 * des journées. Y mettre le programme non réalisé raconterait le voyage qu'on
 * avait prévu, pas celui qu'on a vécu.
 */
export default function RecapCarte({ days }) {
  const conteneurRef = useRef(null);
  const carteRef = useRef(null);

  // Les points visités, dans l'ordre du voyage.
  const points = (days || []).flatMap((d, i) =>
    (d.activities || [])
      .filter(a => a && a.status === 'done' && Number.isFinite(a.lat) && Number.isFinite(a.lon))
      .map(a => ({ lat: a.lat, lon: a.lon, titre: a.title, categorie: a.category, jour: i + 1 })));

  // La signature évite de reconstruire la carte à chaque rendu du bilan.
  const dessin = JSON.stringify(points);

  useEffect(() => {
    const conteneur = conteneurRef.current;
    const pts = JSON.parse(dessin);
    if (!conteneur || pts.length < 1) return undefined;

    const carte = L.map(conteneur, {
      zoomControl: false, attributionControl: false,
      // Un bilan se regarde, il ne se manipule pas : on évite d'attraper le
      // geste de défilement de la feuille sous le doigt.
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, keyboard: false,
    });
    carteRef.current = carte;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(carte);

    pts.forEach((p, i) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 6, weight: 2, color: '#fff',
        fillColor: CATEGORY_COLORS[p.categorie] || '#35A7DD', fillOpacity: 1,
      }).addTo(carte).bindTooltip(`J${p.jour} · ${p.titre}`, { direction: 'top' });
      if (i === 0) L.circleMarker([p.lat, p.lon], { radius: 11, weight: 2, color: '#35A7DD', fill: false }).addTo(carte);
    });

    if (pts.length >= 2) {
      L.polyline(pts.map(p => [p.lat, p.lon]), {
        color: '#35A7DD', weight: 2.5, opacity: 0.8, dashArray: '6 5',
      }).addTo(carte);
    }

    const bornes = pts.map(p => [p.lat, p.lon]);
    if (bornes.length === 1) carte.setView(bornes[0], 13);
    else carte.fitBounds(bornes, { padding: [22, 22] });

    // La feuille s'ouvre par une animation : la carte naît donc à une taille
    // qui n'est pas la sienne. Sans ça, les tuiles se posent à côté.
    const ro = new ResizeObserver(() => carte.invalidateSize());
    ro.observe(conteneur);

    return () => { ro.disconnect(); carte.remove(); carteRef.current = null; };
  }, [dessin]);

  if (points.length < 1) return null;

  return (
    <div className="recap-carte">
      <div className="recap-carte__titre">
        🗺️ Où tu es allé{points.length > 1 ? ` — ${points.length} lieux` : ''}
      </div>
      <div ref={conteneurRef} className="recap-carte__toile" />
    </div>
  );
}
