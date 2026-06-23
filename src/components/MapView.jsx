import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_COLORS, getCategoryMeta } from '../utils/helpers';

function markerIcon(category) {
  const color = CATEGORY_COLORS[category] || '#FF6B35';
  const { emoji } = getCategoryMeta(category);
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,0.35);border:2px solid #fff;">${emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

export default function MapView({ days, reserve }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  const geoActs = [
    ...days.flatMap((d, i) => d.activities
      .filter(a => a.lat && a.lon)
      .map(a => ({ ...a, dayLabel: `Jour ${i + 1}` }))),
    ...reserve.filter(a => a.lat && a.lon).map(a => ({ ...a, dayLabel: 'Réserve' })),
  ];

  useEffect(() => {
    const container = containerRef.current;
    if (!container || geoActs.length === 0) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const map = L.map(container);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = [];
    geoActs.forEach(a => {
      L.marker([a.lat, a.lon], { icon: markerIcon(a.category) })
        .addTo(map)
        .bindPopup(`<strong>${a.title}</strong><br><small style="color:#888">${a.dayLabel}${a.address ? ' · ' + a.address : ''}</small>`);
      bounds.push([a.lat, a.lon]);
    });

    if (bounds.length === 1) map.setView(bounds[0], 14);
    else map.fitBounds(bounds, { padding: [24, 24] });

    return () => { map.remove(); mapRef.current = null; };
  }, [days, reserve]); // eslint-disable-line react-hooks/exhaustive-deps

  if (geoActs.length === 0) {
    return (
      <div className="map-empty">
        <div className="map-empty__icon">🗺️</div>
        <p>Aucune activité géolocalisée.</p>
        <p className="map-empty__hint">Importe des lieux via le bouton Google Maps pour les voir ici.</p>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div className="map-pill">{geoActs.length} lieu{geoActs.length > 1 ? 'x' : ''} sur la carte</div>
      <div ref={containerRef} className="map-canvas" />
    </div>
  );
}
