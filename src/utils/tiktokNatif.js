import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * Lire un post TikTok depuis le téléphone, et non depuis le serveur.
 *
 * Pourquoi ce fichier existe. Mesuré le 9 août 2026, échelon par échelon :
 * TikTok ne donne plus rien à un serveur. L'oEmbed rend 400 partout, la page
 * complète rend un captcha aux adresses de centre de données, et la vignette
 * servie aux robots est une image 600 × 828 de qualité 20 avec un bouton
 * « play » incrusté — illisible, et son URL signée interdit d'en obtenir une
 * meilleure (403 sur les cinq variantes essayées).
 *
 * Mais TikTok sert la vraie page aux vrais navigateurs. Une application
 * INSTALLÉE sort par la connexion de la personne, avec un agent mobile
 * ordinaire : elle reçoit la page complète, légende comprise. C'est la seule
 * différence entre « ça ne marche pas » et « ça marche », et c'est ainsi que
 * fonctionnent les applications qui y arrivent.
 *
 * Deux conditions, donc :
 *   1. tourner en application installée (Capacitor), pas dans un onglet ;
 *   2. passer par `CapacitorHttp`, qui n'est pas soumis aux restrictions
 *      d'origine du navigateur — `fetch` échouerait ici.
 *
 * Dans le navigateur, cette voie n'existe pas : on rend `null` sans bruit et
 * l'app retombe sur la légende collée à la main.
 */

// Un navigateur mobile ordinaire. C'est à lui que TikTok sert la page ; à
// « Provo-Travel-App » il sert un captcha.
const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** L'app tourne-t-elle installée, où la lecture directe est possible ? */
export function lectureNativePossible() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Extraire la légende du bloc de données que la page embarque pour s'hydrater.
 * Séparé de la requête réseau : c'est la partie qu'on peut vérifier hors ligne,
 * dans les parcours, sans téléphone ni Capacitor.
 */
export function legendeDansPage(html) {
  if (!html) return null;
  // Un captcha ne porte pas de bloc de données : inutile d'y chercher.
  if (!html.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__')
      && !html.includes('SIGI_STATE')) return null;

  const bloc =
    (html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/) || [])[1]
    || (html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
  if (!bloc) return null;

  let d;
  try { d = JSON.parse(bloc); } catch { return null; }

  const item = d?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct
    || Object.values(d?.ItemModule || {})[0];
  if (!item) return null;

  const legende = (item.desc || '').trim();
  if (!legende) return null;
  return {
    legende,
    compte: item.author?.uniqueId || (typeof item.author === 'string' ? item.author : ''),
    couverture: item.video?.cover || item.video?.originCover || '',
  };
}

/**
 * Aller chercher la page depuis le téléphone. Rend `null` dès que quoi que ce
 * soit manque — c'est un raccourci, jamais un passage obligé.
 */
export async function legendeTikTokNative(url) {
  if (!lectureNativePossible() || !url) return null;
  try {
    const r = await CapacitorHttp.request({
      method: 'GET',
      url,
      headers: {
        'User-Agent': UA_MOBILE,
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      responseType: 'text',
      connectTimeout: 15000,
      readTimeout: 15000,
    });
    const html = typeof r?.data === 'string' ? r.data : '';
    return legendeDansPage(html);
  } catch {
    return null;
  }
}
