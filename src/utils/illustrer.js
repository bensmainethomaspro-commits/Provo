/**
 * La photo et la présentation d'un lieu, depuis les sources libres.
 *
 * Mesuré le 14 novembre 2026 sur les 28 lieux d'un carnet de Venise
 * (`scripts/diag-carnet.mjs`) : dès que la carte ouverte relie un lieu à
 * Wikidata, il a sa photo et deux phrases en français — 9 monuments sur 10.
 * Les restaurants, eux, n'y sont presque jamais (1 sur 15) : cette voie ne
 * les concerne pas, et elle ne rend alors rien plutôt qu'une image d'à-côté.
 *
 * Trois règles :
 *  · une photo libre se CRÉDITE — auteur et licence, avec le lien de sa page ;
 *  · la présentation est en français ou n'est pas : jamais le texte d'une
 *    autre langue glissé dans une fiche française ;
 *  · tout est facultatif. Un service qui se tait ne casse rien, la fiche reste
 *    ce qu'elle était.
 */
import { avecDelai } from './reseau.js';

const DELAI_MS = 9000;
const api = (hote, params) => `https://${hote}/w/api.php?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;

async function lire(url) {
  try {
    const r = await avecDelai(url, DELAI_MS);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const sansBalises = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/**
 * Deux phrases, pas un article. Et sans la parenthèse d'ouverture des
 * encyclopédies (« (en italien : Basilica di San Marco) », la prononciation) :
 * elle prend la moitié de la première ligne pour ne rien apprendre sur place.
 */
export function deuxPhrases(extrait, max = 260) {
  const propre = String(extrait || '')
    .replace(/\s*\((?:en |prononc|\/|\[|API)[^)]*\)/gi, '')
    .replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
  if (!propre) return '';
  // Une phrase finit par un point suivi d'une majuscule — sauf après une
  // abréviation (« St. Marc », « av. J.-C. ») ou une initiale (« J. Sansovino »).
  const phrases = [];
  for (const bout of propre.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«])/)) {
    const avant = phrases[phrases.length - 1];
    if (avant && /(?:\b(?:St|Ste|Sts|Dr|Mgr|Mme|Mlle|av|apr|env|cf|vol|éd|J\.-C)|\b[A-ZÀ-Þ])\.$/.test(avant)) {
      phrases[phrases.length - 1] = `${avant} ${bout}`;
    } else {
      phrases.push(bout);
    }
  }
  let texte = phrases[0];
  if (phrases[1] && (texte.length + 1 + phrases[1].length) <= max) texte += ` ${phrases[1]}`;
  if (texte.length <= max) return texte;
  // Trop longue : couper à la dernière virgule ou au dernier mot, sans tronquer un mot.
  const coupe = texte.slice(0, max);
  const ou = Math.max(coupe.lastIndexOf(', '), coupe.lastIndexOf(' '));
  return `${coupe.slice(0, ou > 80 ? ou : max).replace(/[,;:\s]+$/, '')}…`;
}

const REVENIR_MS = 7 * 24 * 3600 * 1000;

/**
 * Les fiches d'un voyage qui restent à chercher, dans l'ordre où on les lit :
 * la Réserve d'abord — c'est là qu'on pioche —, puis les jours.
 * @returns {Array<{activite: object, emplacement: object}>}
 */
export function aIllustrer(trip, maintenant = Date.now()) {
  const out = [];
  (trip?.reserve || []).forEach(a => { if (resteAIllustrer(a, maintenant)) out.push({ activite: a, emplacement: { type: 'reserve' } }); });
  (trip?.days || []).forEach(d => (d.activities || []).forEach(a => {
    if (resteAIllustrer(a, maintenant)) out.push({ activite: a, emplacement: { type: 'day', dayId: d.id } });
  }));
  return out;
}

/**
 * L'empreinte d'une fiche : son nom et son point. Elle change si la fiche
 * change, et c'est ce qui fait rouvrir la recherche.
 */
export function empreinte(a) {
  const c = (v) => (Number.isFinite(v) ? v.toFixed(4) : '-');
  return `${String(a?.title || '').trim().toLowerCase()}|${c(a?.lat)}|${c(a?.lon)}`;
}

/**
 * Cette fiche gagnerait-elle à être cherchée dans les sources libres ?
 * Il lui manque une photo, une présentation, son quartier ou le crédit de sa
 * photo — et on ne l'a pas déjà cherchée telle qu'elle est. Aucune requête.
 */
export function resteAIllustrer(a, maintenant = Date.now()) {
  if (!a || a.isMeal || String(a.title || '').trim().length < 3) return false;
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return false;
  if (a.illustreSig === empreinte(a)) {
    // Cherchée, et la carte ouverte ne connaissait pas ce lieu : elle peut
    // l'apprendre. On y revient au bout d'une semaine, pas à chaque ouverture.
    const t = Date.parse(a.illustreAt || '');
    if (!a.illustreVide || !Number.isFinite(t) || (maintenant - t) < REVENIR_MS) return false;
  }
  return !a.photoUrl || !String(a.description || '').trim() || (!a.quartier && !a.secteurs)
    || (!a.photoCredit && Boolean(fichierDe(a.photoUrl)));
}

/** Le nom du fichier dans une adresse d'image de Wikimedia, ou ''. */
export function fichierDe(adresse) {
  const m = /upload\.wikimedia\.org\/wikipedia\/[^/]+\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(String(adresse || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]).replace(/_/g, ' '); } catch { return ''; }
}

/** L'image à la bonne taille, son auteur, sa licence et sa page. */
async function photoDe(fichier) {
  if (!fichier) return null;
  const d = await lire(api('commons.wikimedia.org', {
    action: 'query', titles: `File:${fichier}`, prop: 'imageinfo',
    iiprop: 'url|extmetadata', iiurlwidth: '900',
  }));
  const info = Object.values(d?.query?.pages || {})[0]?.imageinfo?.[0];
  if (!info?.thumburl && !info?.url) return null;
  const meta = info.extmetadata || {};
  const auteur = sansBalises(meta.Artist?.value).slice(0, 48);
  const licence = sansBalises(meta.LicenseShortName?.value);
  return {
    photoUrl: info.thumburl || info.url,
    photoCredit: [auteur, licence, 'Wikimedia Commons'].filter(Boolean).join(' · '),
    ...(info.descriptionurl ? { photoPage: info.descriptionurl } : {}),
  };
}

/**
 * @param {{wikidata?: string, wikipedia?: string, photoUrl?: string}} lieu
 *   ce que la carte ouverte dit du lieu (`wikidata=Q…`, `wikipedia=it:…`), et
 *   la photo que la fiche porte déjà, s'il ne manque que son crédit.
 * @returns {Promise<{photoUrl?, photoCredit?, photoPage?, description?}|null>}
 */
export async function illustrer({ wikidata = '', wikipedia = '', photoUrl = '' } = {}) {
  let q = /^Q\d+$/.test(wikidata) ? wikidata : '';
  if (!q && wikipedia.includes(':')) {
    const [lg, ...reste] = wikipedia.split(':');
    if (/^[a-z-]{2,12}$/.test(lg)) {
      const w = await lire(api(`${lg}.wikipedia.org`, {
        action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: reste.join(':'),
      }));
      q = Object.values(w?.query?.pages || {})[0]?.pageprops?.wikibase_item || '';
    }
  }

  const out = {};
  let fichier = fichierDe(photoUrl);

  if (q) {
    const d = await lire(api('www.wikidata.org', {
      action: 'wbgetentities', ids: q, props: 'claims|sitelinks', sitefilter: 'frwiki',
    }));
    const e = d?.entities?.[q];
    const image = e?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    const fr = e?.sitelinks?.frwiki?.title;
    if (fr) {
      try {
        const r = await avecDelai(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(fr.replace(/ /g, '_'))}`, DELAI_MS);
        const s = r.ok ? await r.json() : null;
        const texte = deuxPhrases(s?.extract);
        if (texte.length >= 40) out.description = texte;
        // Sans photo choisie sur Wikidata, celle qui ouvre l'article.
        if (!photoUrl && !image) fichier = fichierDe(s?.originalimage?.source || s?.thumbnail?.source);
      } catch { /* le texte attendra */ }
    }
    if (!photoUrl && image) fichier = String(image);
  }

  if (fichier) {
    const p = await photoDe(fichier);
    if (p) {
      // Une fiche qui a déjà sa photo ne la change pas : on n'apporte que le crédit.
      if (photoUrl) Object.assign(out, { photoCredit: p.photoCredit, ...(p.photoPage ? { photoPage: p.photoPage } : {}) });
      else Object.assign(out, p);
    }
  }
  return Object.keys(out).length ? out : null;
}
