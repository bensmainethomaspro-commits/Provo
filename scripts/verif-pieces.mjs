/**
 * Les pièces jointes sortent du voyage : ce qui en sort, ce qui y reste, et
 * ce que devient une copie envoyée à quelqu'un.
 *
 * `src/utils/pieces.js` est importé tel quel (aucun import de son côté).
 * IndexedDB n'existe pas sous Node : son usage est vérifié en vrai navigateur
 * par `verif-synchro-demarrage.mjs` (cas F à J).
 *
 * Usage :  node scripts/verif-pieces.mjs
 */
import { readFileSync } from 'node:fs';
import {
  extrairePieces, enReferences, aDesDonnees, refsDe, estRef, pourUneCopie, transformerChaines, PREFIXE,
} from '../src/utils/pieces.js';

const src = readFileSync(new URL('../src/utils/helpers.js', import.meta.url), 'utf8');
const bloc = src.slice(src.indexOf('// ── Fusion de deux versions')).replace(/export /g, '');
const { fusionnerVoyages } = new Function(`${bloc}; return { fusionnerVoyages };`)();

let casses = 0;
const verifier = (nom, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : `  (${detail})`}`);
  if (!ok) casses++;
};

const b64 = (n, graine) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + graine) % 256)).toString('base64');
const JPEG = `data:image/jpeg;base64,${b64(3000, 1)}`;
const JPEG2 = `data:image/jpeg;base64,${b64(3000, 2)}`;
const PDF = `data:application/pdf;base64,${b64(4000, 3)}`;
const PETITE = `data:image/png;base64,${b64(60, 4)}`;
const SVG = `data:image/svg+xml;base64,${b64(3000, 5)}`;

const voyage = () => ({
  id: 'v1', name: 'Vienne', coverPhoto: JPEG,
  documents: [{ id: 'doc1', nom: 'Billet.pdf', image: false, data: PDF }],
  days: [
    { id: 'd1', activities: [{ id: 'a1', title: 'Musée', screenshots: [JPEG2, PETITE], pdfs: [{ name: 'Résa.pdf', data: PDF }] }] },
    { id: 'd2', activities: [{ id: 'a2', title: 'Café', photoUrl: SVG }] },
  ],
  reserve: [{ id: 'r1', title: 'Parc', screenshots: [JPEG] }],
  expenses: [{ id: 'e1', amount: 10 }],
});

// ── Extraction ──────────────────────────────────────────────────────────────
const v = voyage();
const { voyage: allege, pieces } = await extrairePieces(v);
const texte = JSON.stringify(allege);
verifier('plus aucune donnée lourde dans le voyage', !aDesDonnees(allege));
verifier('une pièce par contenu distinct (JPEG ×2, PDF ×1)', pieces.length === 3, pieces.length);
verifier('le même contenu donne la même référence partout',
  allege.coverPhoto === allege.reserve[0].screenshots[0]
  && allege.documents[0].data === allege.days[0].activities[0].pdfs[0].data);
verifier('les références ont la forme attendue', estRef(allege.coverPhoto) && allege.coverPhoto.startsWith(PREFIXE));
verifier('une vignette de quelques octets reste dans le voyage', allege.days[0].activities[0].screenshots[1] === PETITE);
verifier('un SVG reste dans le voyage (le dossier du nuage ne le prend pas)', allege.days[1].activities[0].photoUrl === SVG);
verifier('le voyage allégé pèse une fraction de l’original',
  texte.length < JSON.stringify(v).length / 5, `${texte.length} contre ${JSON.stringify(v).length}`);
verifier('ce qui ne contenait rien garde son identité (la synchro compare les objets)',
  allege.expenses === v.expenses && allege.days[1] === v.days[1]);
verifier('refsDe retrouve les trois pièces', refsDe(allege).size === 3);
{
  const deux = await extrairePieces(voyage());
  verifier('deux téléphones qui sortent les mêmes pièces écrivent les mêmes références',
    JSON.stringify(deux.voyage) === texte);
  const rien = await extrairePieces(allege);
  verifier('un voyage déjà allégé ressort identique (même objet)', rien.voyage === allege && !rien.pieces.length);
}

// ── Avec la fusion à trois voies ─────────────────────────────────────────────
{
  const base = voyage();
  const { voyage: ici } = await extrairePieces(voyage());
  const { voyage: labas } = await extrairePieces({ ...voyage(), name: 'Vienne en hiver' });
  const conflits = [];
  const r = fusionnerVoyages(base, ici, labas, conflits);
  verifier('deux téléphones qui migrent chacun de leur côté : aucun conflit', conflits.length === 0, JSON.stringify(conflits).slice(0, 120));
  verifier('et la fusion garde les références et le nouveau nom', r.name === 'Vienne en hiver' && estRef(r.coverPhoto));
}

// ── Copie envoyée à quelqu'un ────────────────────────────────────────────────
{
  const contenus = new Map(pieces.map(p => [p.id, p.data]));
  // Une capture absente de ce téléphone : elle disparaît, pas de cadre vide.
  const absente = pieces.find(p => p.data === JPEG2).id;
  const lire = async (id) => (id === absente ? undefined : contenus.get(id));
  const copie = await pourUneCopie(allege, lire);
  verifier('la copie ne transporte aucun billet ni PDF',
    copie.documents.length === 0 && copie.days[0].activities[0].pdfs.length === 0);
  verifier('la photo de couverture y est remise en clair', copie.coverPhoto === JPEG);
  verifier('aucune référence ne reste dans la copie', refsDe(copie).size === 0);
  verifier('une capture introuvable ne laisse pas de cadre vide',
    JSON.stringify(copie.days[0].activities[0].screenshots) === JSON.stringify([PETITE]));
}

// ── Sortir une partie seulement (audit A-061) ──────────────────────────────
// Un voyage que le nuage porte ne perd une donnée qu'une fois la pièce dans
// son dossier : les autres restent en clair, jusqu'à leur dépôt.
{
  const photo = pieces.find(p => p.data === JPEG);
  const partiel = enReferences(v, [photo]);
  verifier('seule la pièce déposée cède sa place : le billet reste en clair',
    partiel.coverPhoto === PREFIXE + photo.id && partiel.reserve[0].screenshots[0] === PREFIXE + photo.id
    && partiel.documents[0].data === PDF && partiel.days[0].activities[0].screenshots[0] === JPEG2);
  verifier('aucune pièce à sortir : le même objet', enReferences(v, []) === v);
}

// ── L'outil de parcours lui-même ─────────────────────────────────────────────
{
  const o = { a: [1, 'x'], b: { c: 'y' } };
  verifier('transformerChaines sans changement rend le même objet', transformerChaines(o, s => s) === o);
}

console.log(casses ? `\n${casses} cas cassé(s)` : '\nles 20 cas passent');
process.exit(casses ? 1 : 0);
