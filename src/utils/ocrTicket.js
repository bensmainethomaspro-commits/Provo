/**
 * Lire un ticket photographié, sur le téléphone, sans rien payer.
 *
 * Le moteur (Tesseract, en WebAssembly) pèse quelques mégaoctets : il est donc
 * chargé À LA DEMANDE, au premier ticket photographié, et jamais inclus dans le
 * paquet principal. Quelqu'un qui ne photographie jamais de ticket ne le
 * télécharge jamais.
 *
 * IL VIENT DE CHEZ NOUS, pas d'un CDN : `scripts/vendor-tesseract.mjs` le copie
 * dans `public/tesseract/` à la compilation. Servi depuis notre origine, il
 * passe par le service worker et se garde comme le reste de l'app — le deuxième
 * ticket se lit donc sans réseau, y compris dans l'app Android où il n'y a pas
 * d'origine distante du tout.
 *
 * CE QUE ÇA COÛTE, ET QUI EST ASSUMÉ. Le téléchargement se fait une fois
 * (~4,5 Mo), la lecture prend trois à dix secondes sur un téléphone, et sur un
 * ticket froissé ou surexposé le résultat est franchement moins bon qu'une
 * lecture par un modèle. C'est le prix du gratuit, et le formulaire le porte
 * honnêtement : le montant lu est une PROPOSITION, marquée « à vérifier » tant
 * que le ticket ne l'a pas désigné lui-même.
 *
 * L'interprétation — quel nombre est le total — vit dans `ticket.js`, à part :
 * c'est elle qui décide, donc elle doit être vérifiable sans navigateur.
 */
import { lireTicketTexte } from './ticket';

/**
 * Prépare l'image pour l'OCR : niveaux de gris et contraste poussé.
 *
 * Tesseract lit du texte noir sur blanc. Une photo de ticket est grise, penchée
 * et inégalement éclairée : sans cette étape, il rend surtout du bruit. Mesuré
 * sur des tickets thermiques, c'est ce qui fait la différence entre un montant
 * lu et un champ vide.
 */
function preparer(image, largeurCible = 1400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Agrandir n'apporte rien ; réduire une photo de 4000 px, si — le
        // moteur travaille alors sur des glyphes de taille raisonnable.
        const ratio = Math.min(1, largeurCible / img.width);
        const l = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const c = document.createElement('canvas');
        c.width = l; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, l, h);
        const d = ctx.getImageData(0, 0, l, h);
        const px = d.data;
        // Un seuil FIXE couperait tout un ticket sous-exposé. On centre le
        // contraste sur la luminosité moyenne de l'image elle-même.
        let somme = 0;
        for (let i = 0; i < px.length; i += 4) {
          somme += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        }
        const moyenne = somme / (px.length / 4);
        for (let i = 0; i < px.length; i += 4) {
          const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          // Contraste doux autour de la moyenne, pas une binarisation brutale :
          // le seuil dur mange les chiffres fins des tickets thermiques.
          const v = Math.max(0, Math.min(255, (g - moyenne) * 1.8 + 160));
          px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(d, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('image_illisible'));
    img.src = image;
  });
}

/**
 * Photo de ticket → ce qu'on propose de remplir.
 *
 * Ne jette jamais : rend `{ error }` et le formulaire le dit. Un ticket qu'on
 * n'arrive pas à lire ne doit pas empêcher de noter la dépense à la main —
 * c'est le geste principal, la photo n'est qu'un raccourci.
 */
export async function lireTicketImage(imageDataUrl, surAvancement) {
  let worker = null;
  try {
    const prete = await preparer(imageDataUrl).catch(() => imageDataUrl);
    // Chargé ici, et seulement ici : c'est ce qui garde le paquet principal
    // léger pour tous ceux qui ne photographient pas de ticket.
    const { createWorker } = await import('tesseract.js');
    // `1` = OEM LSTM seul, le moteur moderne. C'est aussi ce qui autorise le
    // modèle de langue allégé (0,7 Mo au lieu de 6).
    worker = await createWorker('fra', 1, {
      // Nos propres chemins : sans eux, tesseract.js irait chercher ces trois
      // fichiers sur un CDN public (voir scripts/vendor-tesseract.mjs).
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/core',
      langPath: '/tesseract/lang',
      logger: (m) => {
        if (m?.status === 'recognizing text' && typeof m.progress === 'number') {
          surAvancement?.(m.progress);
        }
      },
    });
    const { data } = await worker.recognize(prete);
    return lireTicketTexte(data?.text || '');
  } catch {
    // Hors ligne au premier usage, mémoire insuffisante, moteur indisponible :
    // une seule réponse, celle que le formulaire sait dire.
    return { error: 'illisible' };
  } finally {
    // Le moteur garde plusieurs dizaines de mégaoctets : sur un téléphone, le
    // laisser ouvert entre deux tickets se paie au ticket suivant.
    await worker?.terminate?.().catch(() => {});
  }
}
