import { useState, useEffect, useRef } from 'react';
import { CATEGORIES, formatDate, getDayLabel, deduceTitle, fetchPlaceData, searchPlaces, getCategoryMeta, extractViaEdge, extractPlaceClient, nomDeLieu, lireReservation, ressembleAUneReservation, lireLegende, ressembleAUneLegende } from '../utils/helpers';
import { legendeTikTokNative, lectureNativePossible } from '../utils/tiktokNatif';
import { usePlaceSuggestions } from '../hooks/usePlaceSuggestions';
import { poiAtCoords } from '../utils/enrich';

const blank = { title: '', category: 'resto', durationHours: 0, durationMinutes: 0, address: '', notes: '', price: '', link: '', screenshots: [], photoUrl: '', openingHours: '', lat: null, lon: null, fixedStart: '', fixedEnd: '', mustDo: false, pdfs: [], travelerIds: [] };

const TEMPLATES = [
  { emoji: '✈️', label: 'Vol', category: 'trajet', durationHours: 2, durationMinutes: 30 },
  { emoji: '🚂', label: 'Train', category: 'trajet', durationHours: 3, durationMinutes: 0 },
  { emoji: '🚗', label: 'Route', category: 'trajet', durationHours: 2, durationMinutes: 0 },
  { emoji: '🏨', label: 'Hôtel', category: 'repos', durationHours: 1, durationMinutes: 0 },
  { emoji: '🍽', label: 'Restaurant', category: 'resto', durationHours: 1, durationMinutes: 30 },
  { emoji: '☕', label: 'Café', category: 'resto', durationHours: 0, durationMinutes: 45 },
  { emoji: '🏛', label: 'Visite', category: 'visite', durationHours: 2, durationMinutes: 0 },
  { emoji: '🏖', label: 'Plage', category: 'plage', durationHours: 3, durationMinutes: 0 },
];

const timeToMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

const DEFAULT_DURATIONS = {
  resto:  { h: 1, m: 30 },
  visite: { h: 2, m: 0  },
  balade: { h: 2, m: 0  },
  plage:  { h: 3, m: 0  },
  sport:  { h: 1, m: 30 },
  repos:  { h: 1, m: 0  },
  trajet: { h: 1, m: 0  },
  fun:    { h: 2, m: 30 },
};

function isDefaultDuration(f) {
  const total = (parseInt(f.durationHours) || 0) * 60 + (parseInt(f.durationMinutes) || 0);
  return total === 0;
}

export default function AddActivitySheet({ isOpen, onClose, days, onAddToReserve, onAddToDay,
  defaultDayId, editActivity, onEditSave, reserveActivities, onMoveFromReserve,
  tripTravelers, onAddToAllDays, tripLat, tripLon, tripDestination, lienInitial }) {
  const isEdit = !!editActivity;
  const [form, setForm] = useState({ ...blank });
  const { suggestions } = usePlaceSuggestions(tripLat, tripLon, isOpen && !isEdit);
  const [closing, setClosing] = useState(false);
  const [dest, setDest] = useState('reserve');
  const [selectedDayId, setSelectedDayId] = useState('');
  const [error, setError] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState([]);
  // Résultats de la frappe, distincts des candidats d'un import : ceux-là
  // s'effacent dès qu'on continue à écrire.
  const [candidats, setCandidats] = useState([]);
  const [chercheEnCours, setChercheEnCours] = useState(false);
  // Le retour de la recherche s'affiche sous le champ qui l'a déclenchée, en
  // haut de la feuille — `error` reste réservé à la validation, près du bouton.
  const [importMsg, setImportMsg] = useState('');
  // Établissement trouvé à l'adresse choisie : proposé, jamais imposé.
  const [poiHint, setPoiHint] = useState(null);
  const [saving, setSaving] = useState(false);
  const [recurring, setRecurring] = useState(false);
  // Une légende de vidéo cite rarement un seul endroit. Les autres sont déjà
  // lus : les jeter obligerait à les retaper un par un.
  const [autresLieux, setAutresLieux] = useState([]);
  const [lieuxRetenus, setLieuxRetenus] = useState(() => new Set());
  // En modification, on vient précisément pour changer un champ : le pli
  // s'ouvre. En création, la recherche suffit presque toujours.
  const [detailsOuverts, setDetailsOuverts] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      setError('');
      // Un lien arrivé du menu Partager : il est déjà là, autant le chercher
      // tout de suite plutôt que de faire appuyer sur un bouton de plus.
      setImportUrl(lienInitial || '');
      setCandidates([]);
      setImportMsg('');
      setPoiHint(null);
      setAutresLieux([]);
      setLieuxRetenus(new Set());
      setDetailsOuverts(isEdit);
      if (isEdit) {
        setForm({
          title: editActivity.title || '',
          category: editActivity.category || 'resto',
          durationHours: editActivity.durationHours || 0,
          durationMinutes: editActivity.durationMinutes || 30,
          address: editActivity.address || '',
          notes: editActivity.notes || '',
          price: editActivity.price || '',
          link: editActivity.link || '',
          screenshots: editActivity.screenshots || [],
          photoUrl: editActivity.photoUrl || '',
          openingHours: editActivity.openingHours || '',
          lat: editActivity.lat || null,
          lon: editActivity.lon || null,
          fixedStart: editActivity.fixedStart || '',
          fixedEnd: '',
          mustDo: editActivity.mustDo || false,
          pdfs: editActivity.pdfs || [],
          travelerIds: editActivity.travelerIds || [],
        });
      } else {
        const allTravelerIds = (tripTravelers || []).map(t => t.id);
        setForm({ ...blank, travelerIds: allTravelerIds });
        setDest(defaultDayId ? 'day' : 'reserve');
        setSelectedDayId(defaultDayId || days?.[0]?.id || '');
        setRecurring(false);
      }
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 250);
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Les candidats d'un import ambigu passent devant : l'utilisateur vient
  // d'agir dessus, ils répondent à une question posée.
  const resultats = candidates.length ? candidates : candidats;

  const applyResult = (result, rawInput) => {
    setForm(f => {
      const newCat = result.category || f.category;
      const dur = DEFAULT_DURATIONS[newCat];
      return {
        ...f,
        // Le titre est ce qu'on affichera en gros sur la fiche : il porte le
        // nom du lieu, pas l'adresse — qui a sa propre ligne juste dessous.
        title: (result.title ? nomDeLieu(result.title) : '') || f.title,
        address: result.address || f.address,
        category: newCat,
        ...(result.link ? { link: result.link } : {}),
        photoUrl: result.photoUrl || f.photoUrl,
        openingHours: result.openingHours || f.openingHours,
        lat: result.lat ?? f.lat,
        lon: result.lon ?? f.lon,
        ...(result.notes && !f.notes.trim() ? { notes: result.notes } : {}),
        ...(result.price && !f.price ? { price: String(result.price) } : {}),
        ...(dur && isDefaultDuration(f) ? { durationHours: dur.h, durationMinutes: dur.m } : {}),
      };
    });
    setImportUrl('');
    setCandidates([]);
    setCandidats([]);
    setImportMsg('');
  };

  // Le traitement d'une légende, d'où qu'elle vienne : lue sur le téléphone
  // pour un lien TikTok, ou collée à la main. Un seul chemin, donc un seul
  // comportement à vérifier.
  const traiterLegende = async (texteLegende, raw, { lien = '' } = {}) => {
    const lu = await lireLegende(texteLegende);
    if (!lu?.title) return false;
    if (lu.autresLieux?.length) {
      setAutresLieux(lu.autresLieux);
      setLieuxRetenus(new Set(lu.autresLieux.map((_, i) => i)));
    }
    applyResult({ ...lu, ...(lien ? { link: lien } : {}) }, raw);
    // Une légende donne un nom, presque jamais des coordonnées : on situe le
    // lieu sur la destination, comme pour un lien partagé.
    if (lu.lat == null) {
      const q = tripDestination ? `${lu.title}, ${tripDestination}` : lu.title;
      const found = await searchPlaces(q, { lat: tripLat, lon: tripLon });
      if (found.length === 1) {
        applyResult({ ...found[0], title: lu.title, ...(lien ? { link: lien } : {}) }, raw);
      } else if (found.length > 1) {
        setCandidates(found);
        setImportMsg(`« ${lu.title} » lu dans la légende — précise lequel c'est.`);
        return true;
      }
    }
    // Dire d'où vient le nom : que la légende ait été lue sur le téléphone ou
    // collée à la main, la personne doit savoir ce qui a rempli sa fiche.
    setImportMsg(`« ${lu.title} » lu dans la légende ✓`);
    return true;
  };

  // Une adresse n'est pas un commerce : OSM n'a ni horaires ni site dessus.
  // On regarde donc ce qui se trouve à ce point précis, et on le propose.
  const offerPoiAt = async (place) => {
    if (!place || place.openingHours || place.lat == null) return;
    const poi = await poiAtCoords(place.lat, place.lon).catch(() => null);
    if (poi?.title) setPoiHint(poi);
  };

  const usePoiHint = () => {
    if (!poiHint) return;
    setForm(f => ({
      ...f,
      title: poiHint.title,
      category: poiHint.category || f.category,
      openingHours: poiHint.openingHours || f.openingHours,
      ...(poiHint.link && !f.link ? { link: poiHint.link } : {}),
      ...(poiHint.lat != null ? { lat: poiHint.lat, lon: poiHint.lon } : {}),
    }));
    setPoiHint(null);
  };

  // Les lieux retenus rejoignent la Réserve tels qu'ils ont été lus : titre,
  // catégorie, et la localisation comme adresse de départ. Le reste, l'app le
  // cherchera elle-même — c'est déjà ce qu'elle fait pour tout ajout.
  const ajouterLesAutres = () => {
    const choisis = autresLieux.filter((_, i) => lieuxRetenus.has(i));
    if (!choisis.length) return;
    for (const l of choisis) {
      onAddToReserve({ ...blank, title: l.title, category: l.category || 'visite', address: l.location || '' });
    }
    setAutresLieux([]);
    setLieuxRetenus(new Set());
    setImportMsg(`${choisis.length} lieu${choisis.length > 1 ? 'x' : ''} mis en réserve ✓`);
  };

  // Chercher pendant qu'on tape. Le bouton ⬇️ reste — pour les liens, pour
  // valider une adresse complète — mais il n'est plus le seul chemin : sur un
  // téléphone, taper trois lettres et toucher le bon nom est le geste le plus
  // court qui existe pour remplir une fiche.
  //
  // Un lien ne déclenche rien : il se résout en une requête réseau lourde
  // (redirections, extraction), qu'on ne lance pas à chaque caractère.
  useEffect(() => {
    if (isEdit) return undefined;
    const q = importUrl.trim();
    if (q.length < 3 || q.length > 120 || /^https?:\/\//i.test(q) || /\s?\w+\.\w{2,}\//.test(q)) {
      setCandidats([]);
      return undefined;
    }
    let vivant = true;
    const minuteur = setTimeout(async () => {
      setChercheEnCours(true);
      const trouves = await searchPlaces(q, { lat: tripLat, lon: tripLon, limit: 5 }).catch(() => []);
      if (!vivant) return;
      setChercheEnCours(false);
      setCandidats(trouves);
    }, 420);
    return () => { vivant = false; clearTimeout(minuteur); };
  }, [importUrl, isEdit, tripLat, tripLon]);

  const handleImport = async () => {
    const raw = importUrl.trim();
    setImporting(true);
    setError('');
    setImportMsg('');
    setCandidates([]);
    try {
      const isUrl = raw.startsWith('http') || raw.includes('google.com') || raw.includes('goo.gl')
        || raw.includes('maps.app') || raw.includes('share.google') || raw.includes('tiktok.com');

      if (isUrl) {
        const normalized = raw.startsWith('http') ? raw : `https://${raw}`;

        // TikTok d'abord, et depuis le téléphone. Aucun serveur n'obtient plus
        // la légende — mesuré — mais une application installée reçoit la page
        // complète, parce qu'elle sort par la connexion de la personne avec un
        // agent mobile ordinaire. C'est le seul chemin automatique qui marche.
        if (/tiktok\.com/i.test(normalized) && lectureNativePossible()) {
          const nat = await legendeTikTokNative(normalized).catch(() => null);
          if (nat?.legende && await traiterLegende(nat.legende, raw, { lien: normalized })) return;
        }
        // 1) server-side agent (best — resolves short links + classifies + geocodes)
        // 2) robust client extractor (TikTok oEmbed, Maps proxy chain, geocoding)
        let result = await extractViaEdge(normalized);
        if (!result) result = await extractPlaceClient(normalized);

        if (result && (result.title || result.lat != null)) {
          // Retenus par défaut : ils viennent d'être trouvés, et décocher est
          // plus rapide que cocher six fois.
          if (result.autresLieux?.length) {
            setAutresLieux(result.autresLieux);
            setLieuxRetenus(new Set(result.autresLieux.map((_, i) => i)));
          }
          applyResult({ ...result, link: result.link || raw }, raw);

          // Un lien partagé donne presque toujours le NOM du lieu, rarement son
          // adresse : une recherche du nom seul ne donne rien (« Agapii Mou »
          // n'existe pas pour un géocodeur sans ville). On relance donc la
          // recherche en la situant sur la destination du voyage.
          if (result.lat == null && result.title) {
            const q = tripDestination ? `${result.title}, ${tripDestination}` : result.title;
            const found = await searchPlaces(q, { lat: tripLat, lon: tripLon });
            if (found.length === 1) {
              // Le nom du lien fait foi : il vient de la fiche Google.
              applyResult({ ...found[0], title: result.title, link: result.link || raw }, raw);
            } else if (found.length > 1) {
              const net = (found[0]._score ?? 0) - (found[1]._score ?? 0) >= 5;
              if (net) {
                applyResult({ ...found[0], title: result.title, link: result.link || raw }, raw);
              } else {
                setCandidates(found);
                setImportMsg(`« ${result.title} » importé — précise lequel c'est.`);
              }
            } else {
              // Le lieu existe chez Google mais pas dans les données
              // cartographiques ouvertes sur lesquelles l'app s'appuie. Le dire
              // franchement vaut mieux que laisser croire à une panne.
              setImportMsg(`« ${result.title} » importé ✓ — mais ce lieu n'est pas `
                + `répertorié dans la carte ouverte, l'adresse et les horaires `
                + `restent à compléter à la main.`);
            }
            return;
          }

          if (result.source === 'tiktok' && result.lat == null) {
            // TikTok ne rend plus la légende à personne (mesuré : oEmbed mort,
            // page des robots sans description). Quand la couverture n'a pas
            // suffi, la seule chose qui reste est sous les yeux de la personne
            // — et le dire vaut mieux que « vérifie le titre ».
            setImportMsg(result.luSurImage
              ? `« ${result.title} » lu sur l'image ✓ — vérifie, TikTok ne donne plus le texte du post.`
              : "Vidéo importée ✓ — TikTok ne donne plus le texte des posts. "
                + "Copie la légende dans TikTok et colle-la ici : je remplis le reste.");
          }
          return;
        }
        // Le lien n'a rien donné. On le garde quand même dans la fiche — il
        // reste utile — et on dit quoi faire, plutôt qu'un « non reconnu » sec.
        set('link', normalized);
        setImportMsg("Ce lien n'a pas pu être lu — les liens courts Google sont souvent protégés. "
          + "Ouvre-le, copie le nom ou l'adresse du lieu et colle-les ici : le lien, lui, est déjà enregistré.");
        return;
      }

      // Une confirmation collée n'est ni une adresse ni un nom : c'est un
      // courriel entier. Le même champ la reconnaît et la lit — pas de bouton
      // « importer une réservation » à côté, pas d'écran de plus. C'est le
      // travail de saisie le plus ingrat du voyage, et il disparaît.
      if (ressembleAUneReservation(raw)) {
        const r = await lireReservation(raw);
        if (r?.ok) {
          applyResult({
            title: r.titre,
            address: r.adresse || r.lieu,
            category: r.categorie === 'autre' ? 'trajet' : r.categorie,
            notes: r.reference ? `Réf. ${r.reference}` : '',
          }, raw);
          if (r.heure) set('fixedStart', r.heure);
          if (r.fin) set('fixedEnd', r.fin);
          // La date choisit la journée : c'est tout l'intérêt d'une
          // confirmation, elle sait quand ça se passe.
          const jour = (days || []).find(d => d.date === r.date);
          if (jour) { setDest('day'); setSelectedDayId(jour.id); }
          setImportMsg(r.confiance === 'basse'
            ? `Réservation lue — mais j'ai un doute${r.date ? ` sur le ${r.date}` : ''}. Ouvre les détails et vérifie.`
            : `Réservation lue ✓${r.date ? ` — ${r.date}` : ''}${jour ? '' : r.date ? ' (hors des dates du voyage)' : ''}`);
          if (r.confiance === 'basse') setDetailsOuverts(true);
          // Le lieu part quand même en recherche : une confirmation donne
          // rarement des coordonnées, et la fiche doit finir complète.
          if (r.lieu) {
            const trouve = await searchPlaces(
              tripDestination ? `${r.lieu}, ${tripDestination}` : r.lieu,
              { lat: tripLat, lon: tripLon });
            if (trouve.length === 1) {
              setForm(f => ({ ...f, lat: trouve[0].lat, lon: trouve[0].lon,
                address: f.address || trouve[0].address }));
            }
          }
          return;
        }
        setImportMsg(r?.error === 'cle_absente'
          ? "La lecture des réservations n'est pas configurée sur ce compte."
          : "Ce texte n'a pas pu être lu comme une réservation — remplis les détails à la main, rien n'est perdu.");
        setDetailsOuverts(true);
        return;
      }

      // Une légende de réseau social collée à la main. Même champ, même bouton
      // que les liens et les confirmations — c'est la porte de secours depuis
      // que TikTok a fermé la sienne, et elle ne coûte aucun élément d'écran.
      //
      // Elle passe APRÈS la réservation, jamais avant : les deux formes sont
      // du texte long collé, et une confirmation se reconnaît à des indices
      // bien plus précis (dossier, dates, heures). La forme la plus précise
      // tranche d'abord ; la légende ramasse ce qui reste.
      if (ressembleAUneLegende(raw)) {
        if (await traiterLegende(raw, raw)) return;
        // Le texte collé reste dans le champ — rien n'est perdu — et la fiche
        // s'ouvre, comme pour une confirmation illisible : on ne renvoie pas
        // vers « complète à la main » un formulaire qui n'est pas là.
        setImportMsg("Aucun lieu nommé dans ce texte — écris le nom du lieu tout seul, "
          + 'ou complète la fiche à la main.');
        setDetailsOuverts(true);
        return;
      }

      // Texte libre : adresse ou nom de lieu. On propose les correspondances au
      // lieu d'imposer la première — « 12 rue de la Paix » existe partout.
      let found = await searchPlaces(raw, { lat: tripLat, lon: tripLon });
      // Rien trouvé et aucune ville dans la saisie : on retente en ajoutant la
      // destination. « 5 rue Victor Hugo » seul ne dit rien à un géocodeur.
      if (!found.length && tripDestination && !raw.includes(',')) {
        found = await searchPlaces(`${raw}, ${tripDestination}`, { lat: tripLat, lon: tripLon });
      }
      if (found.length === 1) { applyResult(found[0], raw); offerPoiAt(found[0]); return; }
      if (found.length > 1) {
        // Les candidats sont classés. Quand le premier détache nettement les
        // autres, faire choisir n'apporte rien : on remplit, l'utilisateur
        // corrige s'il le faut. On ne fait choisir que sur une vraie ambiguïté.
        const net = (found[0]._score ?? 0) - (found[1]._score ?? 0) >= 5;
        if (net) { applyResult(found[0], raw); offerPoiAt(found[0]); return; }
        setCandidates(found);
        return;
      }
      setImportMsg(tripDestination
        ? `Aucun lieu trouvé, ni à ${tripDestination} ni ailleurs. Précise la ville — `
          + 'ex. « 5 rue Victor Hugo, Biarritz ».'
        : 'Aucun lieu trouvé. Ajoute la ville — ex. « 5 rue Victor Hugo, Biarritz ».');
    } catch {
      setImportMsg('Erreur réseau. Vérifie ta connexion et réessaie.');
    } finally {
      setImporting(false);
    }
  };

  // Un lien arrivé du menu Partager est déjà connu : le chercher tout de suite
  // évite un appui de plus. La ref retient ce qui a déjà été lancé — sans elle,
  // le moindre rendu relancerait la requête. Placé après `handleImport` : une
  // const n'existe pas avant sa déclaration.
  const lienLanceRef = useRef(null);
  useEffect(() => {
    if (!isOpen || !lienInitial || importing) return;
    if (lienLanceRef.current === lienInitial) return;
    if (importUrl.trim() !== lienInitial.trim()) return;
    lienLanceRef.current = lienInitial;
    // Hors de la phase de validation de l'effet : `handleImport` lève tout de
    // suite un drapeau « recherche en cours », et l'enchaîner ici ferait un
    // rendu en cascade.
    queueMicrotask(handleImport);
  }, [isOpen, lienInitial, importUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isOpen) lienLanceRef.current = null; }, [isOpen]);


  const compressImage = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 700;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handleScreenshots = async (e) => {
    const existing = form.screenshots || [];
    const slots = 3 - existing.length;
    if (slots <= 0) return;
    const files = Array.from(e.target.files).slice(0, slots);
    const results = await Promise.all(files.map(compressImage));
    set('screenshots', [...existing, ...results].slice(0, 3));
    e.target.value = '';
  };

  const removeScreenshot = (i) => {
    set('screenshots', (form.screenshots || []).filter((_, idx) => idx !== i));
  };

  const handlePdf = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError('PDF trop volumineux (max 3 Mo).'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      set('pdfs', [...(form.pdfs || []), { name: file.name, data: ev.target.result }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removePdf = (i) => set('pdfs', (form.pdfs || []).filter((_, idx) => idx !== i));

  const toggleTraveler = (id) => {
    const ids = form.travelerIds || [];
    set('travelerIds', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const handleSubmit = async () => {
    if (saving) return;
    const rawTitle = form.title.trim();
    const title = rawTitle || deduceTitle(form.category, form.address, form.notes);
    const { fixedEnd, ...formRest } = form;
    if (!isEdit && dest !== 'reserve' && !recurring && !selectedDayId) {
      setError('Choisis un jour.'); return;
    }

    // Geocode when coordinates are missing OR when the address was edited (stale
    // coords would keep pointing the map at the old place). Capped so saving
    // never hangs if Nominatim is slow.
    let lat = form.lat, lon = form.lon;
    const addressChanged = isEdit && (form.address || '').trim() !== (editActivity?.address || '').trim();
    if (addressChanged) { lat = null; lon = null; }
    if ((lat == null || lon == null) && form.address && form.address.trim()) {
      setSaving(true);
      const place = await Promise.race([
        fetchPlaceData(form.address.trim()).catch(() => null),
        new Promise(r => setTimeout(() => r(null), 4500)),
      ]);
      setSaving(false);
      if (place?.lat != null) { lat = place.lat; lon = place.lon; }
    }

    const activity = {
      ...formRest,
      title,
      lat, lon,
      fixedStart: form.fixedStart || null,
      durationHours: parseInt(form.durationHours) || 0,
      durationMinutes: parseInt(form.durationMinutes) || 0,
      price: parseFloat(form.price) || 0,
      screenshots: form.screenshots || [],
      pdfs: form.pdfs || [],
      mustDo: form.mustDo || false,
      travelerIds: form.travelerIds || [],
    };
    if (isEdit) {
      onEditSave(activity);
    } else if (dest === 'reserve') {
      onAddToReserve(activity);
    } else if (recurring && onAddToAllDays) {
      onAddToAllDays(activity);
    } else {
      onAddToDay(selectedDayId, activity);
    }
    close();
  };

  if (!isOpen && !closing) return null;

  return (
    <div className={`sheet-overlay${closing ? ' closing' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet">
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h2 className="sheet__title">{isEdit ? '✏️ Modifier' : '+ Nouvelle activité'}</h2>
          <button aria-label="Fermer" className="sheet__close" onClick={close}>✕</button>
        </div>

        <div className="sheet__body">
          {/* Meal quick options */}
          {isEdit && editActivity?.isMeal && (
            <div className="meal-quick">
              <div className="form-label">Où mange-t-on ?</div>
              <div className="meal-quick__row">
                {[
                  { label: '🏠 Maison', title: 'Repas maison', price: '5' },
                  { label: '🍽️ Restaurant', title: form.title === 'Repas midi' || form.title === 'Repas soir' || form.title === 'Repas maison' || form.title === 'Pique-nique' ? (editActivity.mealSlot === 'midi' ? 'Repas midi' : 'Repas soir') : form.title, price: '20' },
                  { label: '🧺 Pique-nique', title: 'Pique-nique', price: '10' },
                ].map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`meal-quick__btn${form.title === opt.title ? ' meal-quick__btn--active' : ''}`}
                    onClick={() => { set('title', opt.title); set('price', opt.price); }}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          )}
          {/* Reserve picker (when adding to a specific day) */}
          {!isEdit && defaultDayId && reserveActivities?.length > 0 && (
            <div className="reserve-picker">
              <div className="reserve-picker__title">📦 Depuis la réserve</div>
              {reserveActivities.map(a => {
                const meta = getCategoryMeta(a.category);
                return (
                  <button key={a.id} type="button" className="reserve-picker__item"
                    onClick={() => { onMoveFromReserve?.(a.id); close(); }}>
                    <span className="reserve-picker__emoji">{meta.emoji}</span>
                    <span className="reserve-picker__name">{a.title}</span>
                    <span className="reserve-picker__arrow">→</span>
                  </button>
                );
              })}
              <div className="reserve-picker__divider">— ou créer une nouvelle activité —</div>
            </div>
          )}

          {/* Le premier geste de l'ajout, et le seul dans la plupart des cas :
              on tape un nom, l'app cherche pendant qu'on tape, on touche le
              bon résultat et la fiche est faite. La recherche existait déjà —
              elle attendait qu'on appuie sur un bouton, sous une rangée de
              raccourcis, au milieu d'un formulaire de onze champs. */}
          <div className="form-group import-section">
            <label className="form-label">📍 Cherche un lieu — ou colle un lien, ou une confirmation</label>
            <div className="import-row">
              <input
                className="form-input"
                placeholder="Figlmüller — ou colle un lien"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && importUrl && handleImport()}
                autoFocus={!isEdit}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleImport}
                disabled={!importUrl.trim() || importing}
                aria-label="Chercher ce lieu"
              >
                {importing ? '…' : '⬇️'}
              </button>
            </div>
            {importMsg && <p className="import-msg">{importMsg}</p>}

            {/* Les autres lieux cités par la même légende. Ils partent en
                Réserve — ce sont des idées, pas un programme — et l'app ira
                compléter leurs fiches comme pour n'importe quel ajout. */}
            {autresLieux.length > 0 && (
              <div className="autres-lieux">
                <p className="autres-lieux__titre">
                  Ce lien cite aussi {autresLieux.length} lieu{autresLieux.length > 1 ? 'x' : ''} :
                </p>
                <ul className="autres-lieux__liste">
                  {autresLieux.map((l, i) => (
                    <li key={`${l.title}-${i}`}>
                      <button
                        type="button"
                        className={`autres-lieux__item${lieuxRetenus.has(i) ? ' autres-lieux__item--on' : ''}`}
                        aria-pressed={lieuxRetenus.has(i)}
                        onClick={() => setLieuxRetenus(s => {
                          const n = new Set(s);
                          if (n.has(i)) n.delete(i); else n.add(i);
                          return n;
                        })}
                      >
                        <span className="autres-lieux__coche" aria-hidden="true">
                          {lieuxRetenus.has(i) ? '☑' : '☐'}
                        </span>
                        <span className="autres-lieux__nom">
                          {getCategoryMeta(l.category).emoji} {l.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm autres-lieux__valider"
                  disabled={!lieuxRetenus.size}
                  onClick={ajouterLesAutres}
                >
                  📦 Mettre {lieuxRetenus.size} en réserve
                </button>
              </div>
            )}

            {poiHint && (
              <button type="button" className="poi-hint" onClick={usePoiHint}>
                <span className="poi-hint__icon" aria-hidden="true">💡</span>
                <span className="poi-hint__text">
                  <strong>{poiHint.title}</strong>
                  <small>
                    est à cette adresse
                    {poiHint.openingHours ? ' · horaires connus' : ''} — utiliser ?
                  </small>
                </span>
                <span className="poi-hint__cta">Oui</span>
              </button>
            )}
            {/* Une seule liste de résultats, qu'ils viennent de la frappe ou
                d'un import ambigu : deux listes empilées auraient dit la même
                chose deux fois. Le tap remplit adresse, coordonnées, catégorie
                et horaires. */}
            {chercheEnCours && !candidates.length && !candidats.length && (
              <p className="import-msg">Recherche…</p>
            )}
            {resultats.length > 0 && (
              <div className="place-results">
                {candidates.length > 0 && (
                  <div className="place-results__title">
                    {candidates.length} lieux trouvés — lequel ?
                  </div>
                )}
                {resultats.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className="place-result"
                    onClick={() => { applyResult(c, c.title); offerPoiAt(c); }}
                  >
                    <span className="place-result__emoji">{getCategoryMeta(c.category).emoji}</span>
                    <span className="place-result__text">
                      <span className="place-result__title">{c.title}</span>
                      <span className="place-result__addr">{c.displayName || c.address}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Activity templates */}
          {!isEdit && (
            <div className="templates-row">
              {TEMPLATES.map(t => (
                <button
                  key={t.label}
                  type="button"
                  className="template-pill"
                  onClick={() => setForm(f => ({
                    ...f,
                    category: t.category,
                    durationHours: t.durationHours,
                    durationMinutes: t.durationMinutes,
                  }))}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Nearby place suggestions */}
          {suggestions.length > 0 && !isEdit && (
            <div className="form-group suggestions-row-wrap">
              <label className="form-label">📍 À proximité</label>
              <div className="suggestions-row">
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => {
                      const dur = DEFAULT_DURATIONS[s.category];
                      setForm(f => ({
                        ...f,
                        title: s.title,
                        address: s.address || f.address,
                        lat: s.lat,
                        lon: s.lon,
                        category: s.category,
                        ...(dur && isDefaultDuration(f) ? { durationHours: dur.h, durationMinutes: dur.m } : {}),
                      }));
                    }}
                  >
                    <span>{getCategoryMeta(s.category).emoji}</span>
                    <span>{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Photo preview from import */}
          {form.photoUrl && (
            <div className="form-group">
              <label className="form-label">Photo du lieu</label>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={form.photoUrl} alt="" className="import-photo-preview" />
                <button type="button" className="screenshot-remove"
                  style={{ top: -5, right: -5 }}
                  onClick={() => set('photoUrl', '')}>✕</button>
              </div>
            </div>
          )}

          {/* Tout ce qui suit, l'app le remplit elle-même dès qu'un lieu est
              trouvé : titre, catégorie, durée, horaires, prix, adresse. Le
              formulaire complet s'ouvrait pourtant en grand à chaque ajout —
              onze champs et huit tuiles avant d'avoir rien fait. Il est
              maintenant derrière un pli : présent pour qui en a besoin,
              invisible pour les neuf ajouts sur dix qui n'en ont pas. */}
          <button
            type="button"
            className="details-pli"
            onClick={() => setDetailsOuverts(o => !o)}
            aria-expanded={detailsOuverts}
          >
            <span>{detailsOuverts ? '▴' : '▾'} Détails</span>
            <small>titre, catégorie, durée, horaires, prix, notes</small>
          </button>
          {detailsOuverts && (<>
          <div className="form-group">
            <label className="form-label">Titre <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)' }}>— déduit si vide</span></label>
            <input className="form-input" placeholder="Ex: Déjeuner au marché" value={form.title}
              onChange={e => set('title', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Catégorie</label>
            <div className="category-grid">
              {CATEGORIES.map(cat => (
                <button key={cat.id} type="button"
                  className={`category-btn${form.category === cat.id ? ' category-btn--active' : ''}`}
                  data-cat={cat.id}
                  onClick={() => {
                    const dur = DEFAULT_DURATIONS[cat.id];
                    setForm(f => {
                      const autoFill = dur && isDefaultDuration(f);
                      return { ...f, category: cat.id, ...(autoFill ? { durationHours: dur.h, durationMinutes: dur.m } : {}) };
                    });
                  }}>
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Durée estimée</label>
            <div className="duration-row">
              <input className="form-input" type="number" min="0" max="24" value={form.durationHours}
                onChange={e => set('durationHours', Math.max(0, parseInt(e.target.value) || 0))} />
              <span className="duration-label">h</span>
              <input className="form-input" type="number" min="0" max="59" step="15" value={form.durationMinutes}
                onChange={e => set('durationMinutes', Math.max(0, parseInt(e.target.value) || 0))} />
              <span className="duration-label">min</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Heure prévue <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)' }}>— optionnel</span></label>
            <div className="time-range-row">
              <span>De</span>
              <input
                type="time"
                className="form-input"
                value={form.fixedStart}
                onChange={e => {
                  const val = e.target.value;
                  setForm(f => {
                    const updated = { ...f, fixedStart: val };
                    if (val && f.fixedEnd) {
                      const mins = timeToMin(f.fixedEnd) - timeToMin(val);
                      if (mins > 0) { updated.durationHours = Math.floor(mins / 60); updated.durationMinutes = mins % 60; }
                    }
                    return updated;
                  });
                }}
              />
              <span>à</span>
              <input
                type="time"
                className="form-input"
                value={form.fixedEnd}
                onChange={e => {
                  const val = e.target.value;
                  setForm(f => {
                    const updated = { ...f, fixedEnd: val };
                    if (f.fixedStart && val) {
                      const mins = timeToMin(val) - timeToMin(f.fixedStart);
                      if (mins > 0) { updated.durationHours = Math.floor(mins / 60); updated.durationMinutes = mins % 60; }
                    }
                    return updated;
                  });
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="form-group">
              <label className="form-label">Prix (€)</label>
              <input className="form-input" type="number" min="0" step="0.5" placeholder="0"
                value={form.price} onChange={e => set('price', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Adresse / Lieu</label>
              <input className="form-input" placeholder="Lieu" value={form.address}
                onChange={e => set('address', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Lien (URL)</label>
            <input className="form-input" type="url" placeholder="https://..." value={form.link}
              onChange={e => set('link', e.target.value)} />
          </div>

          {form.openingHours && (
            <div className="form-group">
              <label className="form-label">Horaires</label>
              <input className="form-input" value={form.openingHours}
                onChange={e => set('openingHours', e.target.value)} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" placeholder="Infos, horaires, réservations..." value={form.notes}
              onChange={e => set('notes', e.target.value)} />
          </div>

          {/* Screenshots */}
          <div className="form-group">
            <label className="form-label">
              Photos / captures d'écran
              <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-light)' }}> — max 3</span>
            </label>
            {(form.screenshots || []).length > 0 && (
              <div className="screenshots-preview">
                {form.screenshots.map((src, i) => (
                  <div key={i} className="screenshot-preview-wrap">
                    <img src={src} className="screenshot-preview-img" alt="" />
                    <button type="button" className="screenshot-remove" onClick={() => removeScreenshot(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {(form.screenshots || []).length < 3 && (
              <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer', display: 'inline-flex' }}>
                📷 Ajouter une photo
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleScreenshots} />
              </label>
            )}
            {/* PDF attachments */}
            {(form.pdfs || []).length > 0 && (
              <div className="pdf-list">
                {form.pdfs.map((p, i) => (
                  <div key={i} className="pdf-chip">
                    <span className="pdf-chip__icon">📄</span>
                    <span className="pdf-chip__name">{p.name}</span>
                    <button type="button" className="pdf-chip__remove" onClick={() => removePdf(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {(form.pdfs || []).length < 3 && (
              <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer', display: 'inline-flex', marginTop: 4 }}>
                📎 Joindre un PDF (billet, bon…)
                <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handlePdf} />
              </label>
            )}
          </div>

          {/* Must-do */}
          <div className="form-group">
            <label className="activity-toggle-row">
              <span className="activity-toggle-label">⭐ Incontournable</span>
              <label className="settings-toggle">
                <input type="checkbox" checked={!!form.mustDo} onChange={e => set('mustDo', e.target.checked)} />
                <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
              </label>
            </label>
          </div>

          {/* Travelers assignment */}
          {tripTravelers?.length > 0 && (
            <div className="form-group">
              <label className="form-label">Qui participe ?</label>
              <div className="traveler-assign-row">
                {tripTravelers.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`traveler-assign-chip${(form.travelerIds || []).includes(t.id) ? ' traveler-assign-chip--on' : ''}`}
                    onClick={() => toggleTraveler(t.id)}
                  >
                    {t.emoji} {t.name}
                  </button>
                ))}
              </div>
              {(form.travelerIds || []).length === 0 && (
                <p className="travelers-hint">Tout le monde participe par défaut</p>
              )}
            </div>
          )}

          </>)}

          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Ajouter à</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button type="button"
                  className={`btn btn--sm${dest === 'reserve' ? ' btn--primary' : ' btn--secondary'}`}
                  onClick={() => setDest('reserve')}>📦 Réserve</button>
                <button type="button"
                  className={`btn btn--sm${dest === 'day' ? ' btn--primary' : ' btn--secondary'}`}
                  onClick={() => setDest('day')}>📅 Un jour</button>
              </div>
              {dest === 'day' && (
                <>
                  <select className="form-select" value={selectedDayId} onChange={e => setSelectedDayId(e.target.value)}>
                    {(days || []).map((d, i) => (
                      <option key={d.id} value={d.id}>
                        {getDayLabel(i, days.length)} — {formatDate(d.date)}
                      </option>
                    ))}
                  </select>
                  {onAddToAllDays && (
                    <label className="activity-toggle-row" style={{ marginTop: 8 }}>
                      <span className="activity-toggle-label">🔁 Ajouter à tous les jours</span>
                      <label className="settings-toggle">
                        <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
                        <span className="settings-toggle__track"><span className="settings-toggle__thumb" /></span>
                      </label>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="sheet__footer">
          <button className="btn btn--secondary btn--full" onClick={close}>Annuler</button>
          <button className="btn btn--primary btn--full" onClick={handleSubmit} disabled={saving}>
            {saving ? '📍 Localisation…' : isEdit ? '✅ Enregistrer' : dest === 'reserve' ? '📦 En réserve' : '📅 Assigner'}
          </button>
        </div>
      </div>
    </div>
  );
}
