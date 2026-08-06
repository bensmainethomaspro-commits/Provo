import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_COLORS, getCategoryMeta, fetchPlaceData, haversineKm } from '../utils/helpers';
import { useLiveLocation, formatDistance, formatMarche } from '../hooks/useLiveLocation';

// L'échappement évite qu'un titre contenant des chevrons casse la bulle —
// le contenu est injecté en HTML brut par Leaflet.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function markerIcon(category, titre = '') {
  const color = CATEGORY_COLORS[category] || '#35A7DD';
  const { emoji, label } = getCategoryMeta(category);
  // Un point de carte qui ne dit que son émoji est muet pour une synthèse
  // vocale — et l'émoji seul ne dit pas de quel lieu il s'agit.
  const nom = esc(titre ? `${titre} — ${label}` : label);
  return L.divIcon({
    className: '',
    html: `<div role="img" aria-label="${nom}" title="${nom}" style="background:${color};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,0.35);border:2px solid #fff;">${emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

// Le point bleu du système : reconnaissable partout, et sa taille dit la
// précision plutôt que de la cacher.
function moiIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="map-moi"><span class="map-moi__halo"></span><span class="map-moi__point"></span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** Montre tout ce qu'il y a à voir. Rend `false` s'il n'y a rien à cadrer. */
function cadrer(map, bounds) {
  if (!map || !bounds?.length) return false;
  if (bounds.length === 1) map.setView(bounds[0], 14);
  else map.fitBounds(bounds, { padding: [24, 24] });
  return true;
}

function homeIcon() {
  return L.divIcon({
    className: '',
    html: `<div role="img" aria-label="Hébergement" title="Hébergement" style="background:#1a1a2e;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 10px rgba(0,0,0,0.45);border:2.5px solid #fff;">🏠</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

export default function MapView({ days, reserve, roadTripMode, tripColor, accommodationAddress, accommodationLat, accommodationLon, onOpenActivity, onPiocher }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  // Les épingles vivent dans leur propre calque : on peut les redessiner sans
  // toucher à la carte, donc sans reprendre la main sur le zoom.
  const couchesRef = useRef(null);
  const recadreRef = useRef(false);
  // Ce qu'il faut pour recadrer sans tout reconstruire, et le seul cas où on
  // s'y autorise encore : tant que l'utilisateur n'a pas touché la carte.
  const boundsRef = useRef(null);
  const toucheeRef = useRef(false);
  const [accomTrouve, setAccomTrouve] = useState(null);
  // « Où suis-je par rapport à tout ça ? » se répond sur la carte, pas dans une
  // liste de distances. Éteinte par défaut : autorisation système et batterie.
  const geo = useLiveLocation();
  const moiRef = useRef(null);
  // Les rappels changent d'identité à chaque rendu du parent. Les mettre dans
  // les dépendances de l'effet reconstruirait la carte en continu — zoom perdu,
  // bulles refermées. Ils passent donc par des refs, tenus à jour hors rendu.
  const piocherRef = useRef(onPiocher);
  const ouvrirRef = useRef(onOpenActivity);
  useEffect(() => { piocherRef.current = onPiocher; ouvrirRef.current = onOpenActivity; },
    [onPiocher, onOpenActivity]);

  // L'hébergement est localisé une fois, à la saisie, et rangé sur le voyage.
  // La carte n'a donc plus rien à demander au réseau : elle affiche l'épingle
  // même hors ligne, et une adresse introuvable se dit dans les réglages au
  // lieu de disparaître ici sans un mot.
  const addr = (accommodationAddress || '').trim();
  const stocke = Number.isFinite(accommodationLat) && Number.isFinite(accommodationLon);
  const accom = !addr ? null
    : stocke ? { lat: accommodationLat, lon: accommodationLon, address: addr }
    : accomTrouve;

  // Repli pour les voyages enregistrés avant ce changement, qui n'ont que
  // l'adresse en texte.
  useEffect(() => {
    if (!addr || stocke) return;
    let cancelled = false;
    fetchPlaceData(addr)
      .then(p => { if (!cancelled && p?.lat != null) setAccomTrouve({ lat: p.lat, lon: p.lon, address: p.address || addr }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [addr, stocke]);

  const geoActs = [
    ...days.flatMap((d, i) => d.activities
      .filter(a => a.lat && a.lon)
      .map(a => ({ ...a, dayLabel: `Jour ${i + 1}`, dayIdx: i }))),
    ...reserve.filter(a => a.lat && a.lon).map(a => ({ ...a, dayLabel: 'Réserve', dayIdx: 999, enReserve: true })),
  ];

  const hasContent = geoActs.length > 0 || !!(accom && accom.lat != null);

  // Ce que la carte dessine, résumé en texte. Le comparer par contenu et non
  // par identité est ce qui empêche la carte de se reconstruire pour rien :
  // à chaque rendu, `geoActs` et `accom` sont des objets neufs, alors que ce
  // qu'ils décrivent n'a pas bougé d'un mètre.
  const dessin = JSON.stringify([
    geoActs.map(a => [a.id, a.lat, a.lon, a.category, a.title, a.address || '', a.dayLabel, !!a.enReserve]),
    !!roadTripMode, tripColor || '',
    accom && accom.lat != null ? [accom.lat, accom.lon, accom.address || ''] : null,
  ]);

  // Ce qu'on veut savoir en regardant la carte : lequel est à portée.
  const plusProche = geo.position && geoActs.length
    ? geoActs
        .map(a => ({ ...a, km: haversineKm(geo.position.lat, geo.position.lon, a.lat, a.lon) }))
        .sort((a, b) => a.km - b.km)[0]
    : null;

  // La carte elle-même ne se crée qu'une fois. Tout ce qui la reconstruisait
  // remettait le cadrage à zéro : on zoomait, le GPS envoyait un point, et la
  // vue repartait de zéro — la carte devenait inutilisable dès qu'on marchait.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasContent) return;

    const map = L.map(container);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    couchesRef.current = L.layerGroup().addTo(map);
    recadreRef.current = false;
    toucheeRef.current = false;

    // Dès que le doigt se pose sur la carte, la vue lui appartient : plus aucun
    // recadrage automatique ne viendra la lui reprendre.
    const prendreLaMain = () => { toucheeRef.current = true; };
    container.addEventListener('pointerdown', prendreLaMain, true);
    container.addEventListener('wheel', prendreLaMain, { capture: true, passive: true });

    // La zone de carte change de hauteur en cours de route — la ligne « le plus
    // proche » apparaît dès que la position arrive. Sans cet avertissement,
    // Leaflet garde l'ancienne taille et place ses tuiles à côté ; et le cadrage
    // calculé pour l'ancienne hauteur rognerait les épingles du bord.
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ debounceMoveend: true });
      if (!toucheeRef.current) cadrer(map, boundsRef.current);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      container.removeEventListener('pointerdown', prendreLaMain, true);
      container.removeEventListener('wheel', prendreLaMain, { capture: true });
      map.remove();
      mapRef.current = null;
      couchesRef.current = null;
      moiRef.current = null;
    };
  }, [hasContent]);

  // Les épingles, elles, se redessinent quand leur contenu change.
  useEffect(() => {
    const map = mapRef.current;
    const couche = couchesRef.current;
    if (!map || !couche) return;
    couche.clearLayers();

    const bounds = [];
    geoActs.forEach((a, idx) => {
      // Une épingle sans issue oblige à retrouver l'activité dans une autre
      // liste pour la corriger. La bulle ouvre désormais sa fiche.
      // `title` porte le nom accessible du point : Leaflet le pose sur l'élément
      // cliquable lui-même, là où une synthèse vocale va le chercher.
      const marker = L.marker([a.lat, a.lon], {
        icon: markerIcon(a.category, a.title),
        title: `${a.title || 'Lieu'} — ${getCategoryMeta(a.category).label}`,
      })
        .addTo(couche)
        .bindPopup(
          `<strong>${esc(a.title)}</strong>`
          + `<br><small style="color:#888">${esc(a.dayLabel)}`
          + `${a.address ? ' · ' + esc(a.address) : ''}</small>`
          // Le geste central du produit : on est quelque part, on voit ce qui
          // est autour, on le prend. Chercher dans une liste après avoir vu le
          // lieu sur la carte n'a aucun sens.
          + (a.enReserve && piocherRef.current
            ? `<br><button type="button" class="map-popup__pick">Ajouter à aujourd'hui</button>`
            : '')
          + (ouvrirRef.current
            ? `<br><button type="button" class="map-popup__edit">Ouvrir la fiche</button>`
            : '')
        );

      marker.on('popupopen', (e) => {
        const el = e.popup.getElement();
        const ouvrir = el?.querySelector('.map-popup__edit');
        if (ouvrir) ouvrir.onclick = () => { map.closePopup(); ouvrirRef.current?.(a.id); };
        const prendre = el?.querySelector('.map-popup__pick');
        // Déplacer l'idée change `reserve` et `days` : les épingles se
        // redessinent, la bulle disparaît. Toute confirmation écrite ici serait
        // donc invisible. C'est le bandeau d'annulation de l'app qui confirme —
        // et il permet en plus de revenir en arrière.
        if (prendre) prendre.onclick = () => { map.closePopup(); piocherRef.current?.(a.id); };
      });

      if (roadTripMode) {
        L.marker([a.lat, a.lon], {
          icon: L.divIcon({
            className: '',
            html: `<div style="background:${tripColor || '#35A7DD'};color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${idx + 1}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
          zIndexOffset: 100,
        }).addTo(couche);
      }
      bounds.push([a.lat, a.lon]);
    });

    if (roadTripMode && geoActs.length >= 2) {
      const points = geoActs.map(a => [a.lat, a.lon]);
      L.polyline(points, {
        color: tripColor || '#35A7DD',
        weight: 3,
        opacity: 0.75,
        dashArray: '8 6',
      }).addTo(couche);
    }

    // Accommodation marker (🏠) from trip settings
    if (accom && accom.lat != null) {
      L.marker([accom.lat, accom.lon], { icon: homeIcon(), zIndexOffset: 200, title: 'Hébergement' })
        .addTo(couche)
        .bindPopup(`<strong>🏠 Hébergement</strong>${accom.address ? `<br><small style="color:#888">${accom.address}</small>` : ''}`);
      bounds.push([accom.lat, accom.lon]);
    }

    boundsRef.current = bounds;

    // Le cadrage automatique n'a lieu qu'à l'ouverture de la carte. Ensuite la
    // vue appartient à l'utilisateur : ajouter une idée depuis une bulle ne doit
    // pas lui reprendre son zoom. Revenir sur l'onglet recadre à nouveau.
    if (!recadreRef.current) {
      recadreRef.current = cadrer(map, bounds);
    }
  }, [dessin]); // eslint-disable-line react-hooks/exhaustive-deps

  // La position bouge en continu : la redessiner par le même effet que les
  // épingles reconstruirait la carte entière à chaque pas, et perdrait le
  // zoom. Le marqueur se déplace donc seul.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const p = geo.position;
    if (!p) {
      if (moiRef.current) { moiRef.current.remove(); moiRef.current = null; }
      return;
    }
    if (moiRef.current) {
      moiRef.current.setLatLng([p.lat, p.lon]);
    } else {
      moiRef.current = L.marker([p.lat, p.lon], { icon: moiIcon(), zIndexOffset: 500 })
        .addTo(map).bindPopup('<strong>Tu es ici</strong>');
    }
  }, [geo.position]);

  if (!hasContent) {
    return (
      <div className="map-empty">
        <div className="map-empty__icon">🗺️</div>
        <p>Aucune activité géolocalisée.</p>
        {/* Nommer un bouton qui n'existe pas fait chercher pour rien : le
            chemin réel est le ＋ de l'en-tête, puis le champ « adresse, nom du
            lieu, ou lien » — où un lien Google Maps se colle directement. */}
        <p className="map-empty__hint">
          Ajoute un lieu avec le bouton ＋ en haut : un nom, une adresse, ou un lien collé.
        </p>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div className="map-pill">
        <span className="map-pill__count">
          {geoActs.length} lieu{geoActs.length > 1 ? 'x' : ''} sur la carte
          {accom && accom.lat != null && <span> · 🏠 Hébergement</span>}
          {roadTripMode && <span className="map-pill__road"> · 🛣️ Road trip</span>}
        </span>
        {geo.disponible && (
          <button
            className={`map-moi-btn${geo.active ? ' map-moi-btn--on' : ''}`}
            onClick={geo.basculer}
            aria-pressed={geo.active}
            title={geo.active ? 'Masquer ma position' : 'Voir ma position'}
          >
            ◎ {geo.active ? 'Ma position' : 'Me situer'}
          </button>
        )}
      </div>
      {/* Le plus proche, dit en une phrase : sur la carte on voit où, pas à
          quelle distance. */}
      {geo.position && plusProche && (
        <div className="map-proche">
          <span className="map-proche__label">Le plus proche</span>
          <strong>{plusProche.title}</strong>
          <span className="map-proche__dist">
            {formatDistance(plusProche.km)} · {formatMarche(plusProche.km)}
          </span>
        </div>
      )}
      {geo.erreur && <div className="map-proche map-proche--err">{geo.erreur}</div>}
      <div ref={containerRef} className="map-canvas" />
    </div>
  );
}
