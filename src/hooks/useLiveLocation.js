import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Position de l'utilisateur, à la demande.
 *
 * Jamais activée d'office : la géolocalisation déclenche une demande
 * d'autorisation système et consomme de la batterie. C'est l'utilisateur qui
 * l'allume, quand il veut savoir à quelle distance il est de la suite du
 * programme, et elle s'éteint dès qu'il quitte l'écran.
 *
 * Le choix est mémorisé : une fois autorisée, elle se rallume seule aux visites
 * suivantes, sans redemander.
 */
const CLE = 'provo_geo_active';

export function useLiveLocation() {
  const [position, setPosition] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem(CLE) === '1'; } catch { return false; }
  });
  const watchRef = useRef(null);

  const arreter = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  useEffect(() => {
    // L'absence de géolocalisation est déjà exposée par `disponible` : la
    // signaler ici en plus reviendrait à écrire dans l'état pendant l'effet.
    if (!active || !navigator.geolocation) {
      arreter();
      // Éteindre doit vraiment éteindre. Garder la dernière position laissait
      // le point bleu et les distances à l'écran, figés sur un lieu où l'on
      // n'est plus — pire que pas de position du tout.
      setPosition(null);
      setErreur(null);
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setErreur(null);
        setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy });
      },
      (e) => {
        // Un refus est définitif tant que l'utilisateur ne revient pas dessus
        // dans les réglages : inutile de laisser le suivi allumé.
        setErreur(e.code === e.PERMISSION_DENIED
          ? "Localisation refusée. Autorise-la dans les réglages du navigateur."
          : "Position introuvable pour l'instant.");
        if (e.code === e.PERMISSION_DENIED) setActive(false);
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
    return arreter;
  }, [active, arreter]);

  useEffect(() => {
    try { localStorage.setItem(CLE, active ? '1' : '0'); } catch { /* quota */ }
  }, [active]);

  return {
    position,
    erreur,
    active,
    basculer: () => setActive(a => !a),
    disponible: typeof navigator !== 'undefined' && 'geolocation' in navigator,
  };
}

/**
 * Distance à vol d'oiseau, formulée comme on la dit — et le temps de marche
 * qui va avec, à 4,5 km/h. L'app calcule, l'utilisateur lit une phrase.
 */
export function formatDistance(km) {
  if (!Number.isFinite(km)) return null;
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function formatMarche(km) {
  if (!Number.isFinite(km)) return null;
  const min = Math.round((km / 4.5) * 60);
  if (min < 1) return 'sur place';
  if (min < 60) return `${min} min à pied`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r} min à pied` : `${h} h à pied`;
}
