import { useCallback, useEffect, useRef } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_CLE } from '../lib/supabase';
import { avecDelai } from '../utils/reseau';
import {
  aDesDonnees, extrairePieces, enReferences, stockerPieces, refsDe, etatPiece, marquerEnvoyee,
  versBlob, depuisBlob, signalerPieces, oublierPiecesOrphelines,
} from '../utils/pieces';

// Un billet de 3 Mo sur une 3G d'aéroport : le délai des autres requêtes
// (12 s) le couperait à coup sûr.
const DELAI_PIECE_MS = 45000;
const DOSSIER = `${SUPABASE_URL}/storage/v1/object/pieces`;
// Ce qui n'a pas pu être échangé est retenté seul, de plus en plus loin, puis
// toutes les cinq minutes tant que l'app est ouverte (audit A-062). Le billet
// que l'autre téléphone est encore en train de déposer arrive ainsi sans que
// personne ait à toucher au voyage.
const RECULS_MS = [5000, 15000, 45000, 120000, 300000];

async function deposer(jeton, idVoyage, id, data) {
  const blob = versBlob(data);
  const r = await avecDelai(`${DOSSIER}/${encodeURIComponent(idVoyage)}/${id}`, DELAI_PIECE_MS, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jeton}`, apikey: SUPABASE_CLE,
      'content-type': blob.type, 'x-upsert': 'false', 'cache-control': '31536000',
    },
    body: blob,
  });
  if (r.ok || r.status === 409) return true;
  // Selon la version du service, « existe déjà » revient en 400 avec le code
  // dans le corps. L'empreinte dit que c'est le même contenu : c'est réussi.
  const corps = await r.text().catch(() => '');
  return /already exists|Duplicate|"409"/i.test(corps);
}

async function rapatrier(jeton, idVoyage, id) {
  const r = await avecDelai(`${DOSSIER}/${encodeURIComponent(idVoyage)}/${id}`, DELAI_PIECE_MS, {
    headers: { Authorization: `Bearer ${jeton}`, apikey: SUPABASE_CLE },
  });
  if (!r.ok) return null;
  return depuisBlob(await r.blob());
}

/**
 * Les pièces jointes, à côté des voyages (voir utils/pieces.js) :
 *  1. sortir des voyages toute donnée lourde qui y entre (formulaires, anciens
 *     voyages, copie reçue), APRÈS l'avoir rangée et relue ;
 *  2. déposer au nuage ce qui ne l'est pas encore, dossier du voyage ;
 *  3. rapatrier ce qui manque sur ce téléphone — tout, et tout de suite :
 *     un billet doit être là AVANT d'arriver dans l'aéroport sans réseau.
 *
 * Un ordre à tenir entre 1 et 2 (audit A-061) : un voyage que le nuage porte
 * peut-être, base64 compris, ne perd une donnée qu'une fois la pièce déposée
 * dans son dossier. Sortir d'abord faisait partir le voyage allégé à 700 ms
 * (useTrips.js, `planifier`), avant le dépôt : le nuage perdait la seule copie
 * partagée, et la gardait perdue tant que le dépôt échouait.
 */
export function usePiecesSync({ trips, setTrips, tripsRef, userId, authLoading, remoteIdsRef, pretRef }) {
  const propres = useRef(new WeakSet());
  // Rangées sur ce téléphone, encore en clair dans un voyage du nuage, pas
  // encore déposées : identifiant de pièce → voyages. Le dépôt les cherche
  // ici, puisqu'aucune référence ne les désigne encore.
  const enClair = useRef(new Map());
  const rangement = useRef({ enCours: false, encore: false });
  const enCours = useRef(false);
  // Appelé pendant un échange : on repasse à la fin, sinon une pièce ajoutée
  // à ce moment-là attendrait la modification suivante.
  const encore = useRef(false);
  const menage = useRef(false);
  const relance = useRef({ minuteur: null, rang: 0 });
  const rangerRef = useRef(null);
  const echangerRef = useRef(null);

  // 1 · Sortir les données lourdes. Le voyage n'est remplacé que s'il n'a pas
  // bougé entre-temps ; sinon, le prochain passage s'en charge.
  const ranger = useCallback(async () => {
    if (rangement.current.enCours) { rangement.current.encore = true; return; }
    rangement.current = { enCours: true, encore: false };
    // Le nuage a-t-il peut-être ce voyage, données comprises ? Tant que la
    // session ou le nuage n'ont pas répondu, on ne le sait pas : on le suppose.
    const nuagePorte = (idVoyage) => authLoading
      || (Boolean(userId) && (!pretRef.current || remoteIdsRef.current.has(idVoyage)));
    try {
      let sorties = false;
      const attente = new Map();
      for (const voyage of tripsRef.current) {
        if (propres.current.has(voyage)) continue;
        if (!aDesDonnees(voyage)) { propres.current.add(voyage); continue; }
        try {
          const { pieces } = await extrairePieces(voyage);
          if (!(await stockerPieces(pieces))) continue;
          const porte = nuagePorte(voyage.id);
          const libres = [];
          for (const p of pieces) {
            if (!porte || (await etatPiece(p.id))?.envoyee?.includes(voyage.id)) libres.push(p);
            else attente.set(p.id, new Set([...(attente.get(p.id) || []), voyage.id]));
          }
          if (!libres.length) continue;
          const allege = enReferences(voyage, libres);
          if (libres.length === pieces.length) propres.current.add(allege);
          setTrips(prev => prev.map(x => (x === voyage ? allege : x)));
          sorties = true;
        } catch {
          // IndexedDB indisponible : les données restent dans le voyage, comme avant.
          propres.current.add(voyage);
        }
      }
      // Déposer tout de suite ce qui vient de se mettre à attendre. Ce qui
      // attendait déjà suit le recul : un dépôt qui échoue ne repart pas à
      // chaque lettre tapée dans le voyage.
      const nouvelle = [...attente].some(([id, voyages]) => [...voyages].some(v => !enClair.current.get(id)?.has(v)));
      enClair.current = attente;
      if (sorties) signalerPieces();
      if (nouvelle) echangerRef.current?.();
    } finally {
      const rejouer = rangement.current.encore;
      rangement.current = { enCours: false, encore: false };
      if (rejouer) setTimeout(() => rangerRef.current?.(), 0);
    }
  }, [authLoading, userId, tripsRef, setTrips, remoteIdsRef, pretRef]);

  // 2 et 3 · Échanger avec le nuage.
  const echanger = useCallback(async () => {
    if (!userId || !navigator.onLine) return;
    if (enCours.current) { encore.current = true; return; }
    enCours.current = true;
    encore.current = false;
    clearTimeout(relance.current.minuteur);
    // `reste` : quelque chose n'a pas pu être échangé (à retenter) ;
    // `progres` : quelque chose est passé (le recul repart de zéro).
    let reste = false;
    let progres = false;
    try {
      const { data } = await supabase.auth.getSession();
      const jeton = data?.session?.access_token;
      if (!jeton) return;
      const voyagesDe = new Map();
      const ajouter = (id, idVoyage) => {
        const liste = voyagesDe.get(id) || [];
        if (!liste.includes(idVoyage)) voyagesDe.set(id, [...liste, idVoyage]);
      };
      for (const v of tripsRef.current) for (const id of refsDe(v)) ajouter(id, v.id);
      for (const [id, voyages] of enClair.current) for (const idVoyage of voyages) ajouter(id, idVoyage);
      let arrivees = false;
      // Une pièce déposée qui est encore en clair dans un voyage : il peut
      // maintenant la sortir.
      let aSortir = false;
      for (const [id, voyages] of voyagesDe) {
        if (!navigator.onLine) { reste = true; break; }
        const etat = await etatPiece(id).catch(() => undefined);
        if (etat?.data) {
          for (const idVoyage of voyages) {
            const retenue = enClair.current.get(id)?.has(idVoyage);
            if (etat.envoyee?.includes(idVoyage)) { if (retenue) aSortir = true; continue; }
            // Le dossier d'un voyage n'accepte un dépôt qu'une fois le voyage
            // lui-même dans le nuage : on repasse.
            if (!remoteIdsRef.current.has(idVoyage)) { reste = true; continue; }
            if (await deposer(jeton, idVoyage, id, etat.data).catch(() => false)) {
              await marquerEnvoyee(id, idVoyage);
              progres = true;
              if (retenue) aSortir = true;
            } else reste = true;
          }
        } else {
          // Un voyage dupliqué référence les pièces de l'original : on essaie
          // chaque dossier qui peut l'avoir.
          let arrivee = false;
          for (const idVoyage of voyages) {
            const contenu = await rapatrier(jeton, idVoyage, id).catch(() => null);
            if (contenu && (await stockerPieces([{ id, data: contenu }], [idVoyage]).catch(() => false))) {
              arrivee = true;
              break;
            }
          }
          if (arrivee) { arrivees = true; progres = true; } else reste = true;
        }
      }
      if (arrivees) signalerPieces();
      if (aSortir) rangerRef.current?.();
      // Une fois par session, et seulement quand le nuage a été lu : ce que
      // plus aucun voyage ne référence, et que le nuage garde, s'efface d'ici.
      if (!menage.current && pretRef.current) {
        menage.current = true;
        await oublierPiecesOrphelines(new Set(voyagesDe.keys())).catch(() => {});
      }
    } finally {
      enCours.current = false;
      if (encore.current) setTimeout(() => echangerRef.current?.(), 500);
      const r = relance.current;
      if (!reste) r.rang = 0;
      else {
        if (progres) r.rang = 0;
        r.minuteur = setTimeout(() => echangerRef.current?.(), RECULS_MS[Math.min(r.rang, RECULS_MS.length - 1)]);
        r.rang++;
      }
    }
  }, [userId, tripsRef, remoteIdsRef, pretRef]);

  useEffect(() => { rangerRef.current = ranger; }, [ranger]);
  useEffect(() => { echangerRef.current = echanger; }, [echanger]);

  useEffect(() => {
    const t = setTimeout(ranger, 600);
    return () => clearTimeout(t);
  }, [trips, ranger]);

  useEffect(() => {
    const t = setTimeout(echanger, 2500);
    return () => clearTimeout(t);
  }, [trips, echanger]);

  // Le réseau qui revient, l'app qui repasse au premier plan : on réessaie
  // tout de suite, et le recul repart de zéro.
  useEffect(() => {
    const maintenant = () => { relance.current.rang = 0; echanger(); };
    const auRetour = () => { if (document.visibilityState === 'visible') maintenant(); };
    const r = relance.current;
    window.addEventListener('online', maintenant);
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      window.removeEventListener('online', maintenant);
      document.removeEventListener('visibilitychange', auRetour);
      clearTimeout(r.minuteur);
    };
  }, [echanger]);
}
