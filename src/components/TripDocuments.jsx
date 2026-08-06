import { useRef, useState } from 'react';
import { reduireImage } from '../utils/helpers';

/**
 * Les papiers du voyage : billets, réservations, attestations.
 *
 * Une pièce jointe existe déjà **par activité** — mais un billet de train
 * n'appartient à aucune activité, et c'est justement celui qu'on cherche en
 * courant dans une gare. Il vit donc ici, avec les notes du voyage : le même
 * onglet, la même intention (« ce qu'il me faut sous la main »), aucune
 * navigation nouvelle à apprendre.
 *
 * Tout est stocké dans le voyage, donc **hors ligne par construction** — c'est
 * tout l'intérêt : le réseau d'un aéroport étranger n'est pas une hypothèse.
 * En contrepartie, le voyage entier tient dans un seul enregistrement local :
 * les images sont réduites, les PDF au-delà d'une limite sont refusés avec la
 * raison, jamais avalés silencieusement.
 */

const MAX_PDF = 1_500_000;         // ~1,5 Mo : au-delà, le voyage ne tient plus

// Le stockage local d'un navigateur tient **5,1 Mo** — mesuré, pas supposé, et
// c'est une limite dure que `navigator.storage.estimate()` ne dit pas (il
// annonce 1 Go, qui vaut pour d'autres stockages). Tout le voyage y vit :
// activités, photos de couverture, captures, et ces documents. Un plafond fixe
// à 6 Mo, comme celui écrit ici d'abord, dépassait donc à lui seul le budget
// total — et une écriture qui échoue fait perdre en silence tout ce qui n'était
// pas encore parti chez Supabase.
//
// On mesure donc ce qui est réellement occupé, et on garde une réserve.
const PLAFOND_STOCKAGE = 5_100_000;
const RESERVE = 700_000;           // de quoi continuer à travailler après coup

function placeRestante() {
  let occupe = 0;
  try {
    for (const cle of Object.keys(localStorage)) {
      occupe += cle.length + (localStorage.getItem(cle)?.length || 0);
    }
  } catch { return 0; }
  return Math.max(0, PLAFOND_STOCKAGE - RESERVE - occupe);
}

const poids = (docs) => (docs || []).reduce((n, d) => n + (d.data?.length || 0), 0);

const lisible = (o) => o > 900_000 ? `${(o / 1_000_000).toFixed(1)} Mo` : `${Math.round(o / 1000)} ko`;

export default function TripDocuments({ documents, onChange }) {
  const champ = useRef(null);
  const [erreur, setErreur] = useState('');
  const [apercu, setApercu] = useState(null);
  const docs = documents || [];

  const ajouter = async (e) => {
    const fichiers = [...(e.target.files || [])];
    e.target.value = '';
    if (!fichiers.length) return;
    setErreur('');
    const nouveaux = [];
    for (const f of fichiers) {
      const image = f.type.startsWith('image/');
      if (!image && f.type !== 'application/pdf') {
        setErreur(`« ${f.name} » n'est ni une image ni un PDF.`);
        continue;
      }
      try {
        const data = image
          ? await reduireImage(f, 1400, 0.72)
          : await new Promise((ok, ko) => {
              if (f.size > MAX_PDF) { ko(new Error(`trop lourd (${lisible(f.size)}, maximum ${lisible(MAX_PDF)})`)); return; }
              const l = new FileReader();
              l.onerror = () => ko(new Error('lecture impossible'));
              l.onload = ev => ok(ev.target.result);
              l.readAsDataURL(f);
            });
        nouveaux.push({ id: `doc${Date.now()}${nouveaux.length}`, nom: f.name, image, data });
      } catch (err) {
        setErreur(`« ${f.name} » : ${err.message}.`);
      }
    }
    if (!nouveaux.length) return;
    const libre = placeRestante();
    const ajoute = poids(nouveaux);
    if (ajoute > libre) {
      setErreur(`Il reste ${lisible(libre)} de place sur ce téléphone, et ça en demande ${lisible(ajoute)}. `
        + `Retire des papiers ou des photos avant d'en ajouter — sinon c'est tout le voyage qui ne s'enregistrerait plus.`);
      return;
    }
    onChange([...docs, ...nouveaux]);
  };

  const ouvrir = (d) => {
    if (d.image) { setApercu(d); return; }
    // Un PDF s'ouvre dans le lecteur du téléphone. `data:` ne peut pas être
    // navigué directement sur certains navigateurs : on passe par un blob.
    try {
      const [entete, base64] = d.data.split(',');
      const type = /:(.*?);/.exec(entete)?.[1] || 'application/pdf';
      const bin = atob(base64);
      const tab = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) tab[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([tab], { type }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setErreur(`« ${d.nom} » n'a pas pu être ouvert.`);
    }
  };

  return (
    <div className="trip-docs">
      <div className="trip-docs__titre">
        📎 Billets et réservations
        {docs.length > 0 && <span className="trip-docs__poids">{lisible(poids(docs))}</span>}
      </div>

      {docs.length > 0 && (
        <ul className="trip-docs__liste">
          {docs.map(d => (
            <li key={d.id} className="trip-doc">
              <button type="button" className="trip-doc__ouvrir" onClick={() => ouvrir(d)}>
                <span className="trip-doc__icone" aria-hidden="true">{d.image ? '🖼️' : '📄'}</span>
                <span className="trip-doc__nom">{d.nom}</span>
              </button>
              <button
                type="button"
                className="trip-doc__retirer"
                onClick={() => onChange(docs.filter(x => x.id !== d.id))}
                aria-label={`Retirer ${d.nom}`}
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="trip-docs__ajout" onClick={() => champ.current?.click()}>
        ＋ Ajouter un billet, une réservation…
      </button>
      <input
        ref={champ}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={ajouter}
        style={{ display: 'none' }}
      />
      {erreur && <p className="trip-docs__erreur">{erreur}</p>}
      {!docs.length && !erreur && (
        <p className="trip-docs__vide">Ils resteront lisibles sans réseau.</p>
      )}

      {apercu && (
        <div className="lightbox" onClick={() => setApercu(null)}>
          <img src={apercu.data} alt={apercu.nom} className="lightbox__img" />
        </div>
      )}
    </div>
  );
}
