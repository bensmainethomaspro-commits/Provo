import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_COLORS, getCategoryMeta, fetchPlaceData } from '../utils/helpers';

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

function homeIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="background:#1a1a2e;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 10px rgba(0,0,0,0.45);border:2.5px solid #fff;">🏠</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

export default function MapView({ days, reserve, roadTripMode, tripColor, accommodationAddress }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [accom, setAccom] = useState(null);

  // Geocode the accommodation address from trip settings (Nominatim, CORS-ok).
  useEffect(() => {
    const addr = (accommodationAddress || '').trim();
    if (!addr) { setAccom(null); return; }
    let cancelled = false;
    fetchPlaceData(addr)
      .then(p => { if (!cancelled && p?.lat != null) setAccom({ lat: p.lat, lon: p.lon, address: p.address || addr }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accommodationAddress]);

  const geoActs = [
    ...days.flatMap((d, i) => d.activities
      .filter(a => a.lat && a.lon)
      .map(a => ({ ...a, dayLabel: `Jour ${i + 1}`, dayIdx: i }))),
    ...reserve.filter(a => a.lat && a.lon).map(a => ({ ...a, dayLabel: 'Réserve', dayIdx: 999 })),
  ];

  const hasContent = geoActs.length > 0 || (accom && accom.lat != null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasContent) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const map = L.map(container);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = [];
    geoActs.forEach((a, idx) => {
      const marker = L.marker([a.lat, a.lon], { icon: markerIcon(a.category) })
        .addTo(map)
        .bindPopup(`<strong>${a.title}</strong><br><small style="color:#888">${a.dayLabel}${a.address ? ' · ' + a.address : ''}</small>`);

      if (roadTripMode) {
        L.divIcon({ className: '' });
        L.marker([a.lat, a.lon], {
          icon: L.divIcon({
            className: '',
            html: `<div style="background:${tripColor || '#FF6B35'};color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${idx + 1}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
          zIndexOffset: 100,
        }).addTo(map);
      }
      bounds.push([a.lat, a.lon]);
    });

    if (roadTripMode && geoActs.length >= 2) {
      const points = geoActs.map(a => [a.lat, a.lon]);
      L.polyline(points, {
        color: tripColor || '#FF6B35',
        weight: 3,
        opacity: 0.75,
        dashArray: '8 6',
      }).addTo(map);
    }

    // Accommodation marker (🏠) from trip settings
    if (accom && accom.lat != null) {
      L.marker([accom.lat, accom.lon], { icon: homeIcon(), zIndexOffset: 200 })
        .addTo(map)
        .bindPopup(`<strong>🏠 Hébergement</strong>${accom.address ? `<br><small style="color:#888">${accom.address}</small>` : ''}`);
      bounds.push([accom.lat, accom.lon]);
    }

    if (bounds.length === 1) map.setView(bounds[0], 14);
    else map.fitBounds(bounds, { padding: [24, 24] });

    return () => { map.remove(); mapRef.current = null; };
  }, [days, reserve, roadTripMode, tripColor, accom]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasContent) {
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
      <div className="map-pill">
        {geoActs.length} lieu{geoActs.length > 1 ? 'x' : ''} sur la carte
        {accom && accom.lat != null && <span> · 🏠 Hébergement</span>}
        {roadTripMode && <span className="map-pill__road"> · 🛣️ Road trip</span>}
      </div>
      <div ref={containerRef} className="map-canvas" />
    </div>
  );
}
