import { useCallback, useEffect, useRef } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_CLE } from '../lib/supabase';
import { avecDelai } from '../utils/reseau';
import {
  aDesDonnees, extrairePieces, stockerPieces, refsDe, etatPiece, marquerEnvoyee,
  versBlob, depuisBlob, signalerPieces, oublierPiecesOrphelines,
} from '../utils/pieces';

// Un billet de 3 Mo sur une 3G d'aéroport : le délai des autres requêtes
// (12 s) le couperait à coup sûr.
const DELAI_PIECE_MS = 45000;
const DOSSIER = `${SUPABASE_URL}/storage/v1/object/pieces`;

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
 */
export function usePiecesSync({ trips, setTrips, tripsRef, userId, remoteIdsRef, pretRef }) {
  const propres = useRef(new WeakSet());
  const enCours = useRef(false);
  // Appelé pendant un échange : on repasse à la fin, sinon une pièce ajoutée
  // à ce moment-là attendrait la modification suivante.
  const encore = useRef(false);
  const menage = useRef(false);

  // 1 · Sortir les données lourdes. Le voyage n'est remplacé que s'il n'a pas
  // bougé entre-temps ; sinon, le prochain passage s'en charge.
  useEffect(() => {
    const t = setTimeout(async () => {
      let sorties = false;
      for (const voyage of tripsRef.current) {
        if (propres.current.has(voyage)) continue;
        if (!aDesDonnees(voyage)) { propres.current.add(voyage); continue; }
        try {
          const { voyage: allege, pieces } = await extrairePieces(voyage);
          if (!(await stockerPieces(pieces))) continue;
          propres.current.add(allege);
          setTrips(prev => prev.map(x => (x === voyage ? allege : x)));
          sorties = true;
        } catch {
          // IndexedDB indisponible : les données restent dans le voyage, comme avant.
          propres.current.add(voyage);
        }
      }
      if (sorties) signalerPieces();
    }, 600);
    return () => clearTimeout(t);
  }, [trips, tripsRef, setTrips]);

  // 2 et 3 · Échanger avec le nuage.
  const echanger = useCallback(async () => {
    if (!userId || !navigator.onLine) return;
    if (enCours.current) { encore.current = true; return; }
    enCours.current = true;
    encore.current = false;
    try {
      const { data } = await supabase.auth.getSession();
      const jeton = data?.session?.access_token;
      if (!jeton) return;
      const voyagesDe = new Map();
      for (const v of tripsRef.current) {
        for (const id of refsDe(v)) voyagesDe.set(id, [...(voyagesDe.get(id) || []), v.id]);
      }
      let arrivees = false;
      for (const [id, voyages] of voyagesDe) {
        if (!navigator.onLine) break;
        const etat = await etatPiece(id).catch(() => undefined);
        if (etat?.data) {
          // Le dossier d'un voyage n'accepte un dépôt qu'une fois le voyage
          // lui-même dans le nuage : les autres attendent le passage suivant.
          for (const idVoyage of voyages) {
            if (etat.envoyee?.includes(idVoyage) || !remoteIdsRef.current.has(idVoyage)) continue;
            if (await deposer(jeton, idVoyage, id, etat.data).catch(() => false)) await marquerEnvoyee(id, idVoyage);
          }
        } else {
          // Un voyage dupliqué référence les pièces de l'original : on essaie
          // chaque dossier qui peut l'avoir.
          for (const idVoyage of voyages) {
            const contenu = await rapatrier(jeton, idVoyage, id).catch(() => null);
            if (contenu && (await stockerPieces([{ id, data: contenu }], [idVoyage]).catch(() => false))) {
              arrivees = true;
              break;
            }
          }
        }
      }
      if (arrivees) signalerPieces();
      // Une fois par session, et seulement quand le nuage a été lu : ce que
      // plus aucun voyage ne référence, et que le nuage garde, s'efface d'ici.
      if (!menage.current && pretRef.current) {
        menage.current = true;
        await oublierPiecesOrphelines(new Set(voyagesDe.keys())).catch(() => {});
      }
    } finally {
      enCours.current = false;
      if (encore.current) setTimeout(() => echangerRef.current?.(), 500);
    }
  }, [userId, tripsRef, remoteIdsRef, pretRef]);
  const echangerRef = useRef(null);
  useEffect(() => { echangerRef.current = echanger; }, [echanger]);

  useEffect(() => {
    const t = setTimeout(echanger, 2500);
    return () => clearTimeout(t);
  }, [trips, echanger]);

  useEffect(() => {
    window.addEventListener('online', echanger);
    return () => window.removeEventListener('online', echanger);
  }, [echanger]);
}
