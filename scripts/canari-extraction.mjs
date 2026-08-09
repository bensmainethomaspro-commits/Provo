#!/usr/bin/env node
/**
 * Canari de la chaîne d'extraction de liens.
 *
 * Pourquoi ce script existe : en août 2026, l'oEmbed de TikTok s'est éteint
 * sans prévenir. Toute la chaîne reposait dessus, et personne ne l'a su avant
 * qu'un utilisateur ne signale des fiches vides. Une seule source, aucune
 * alarme — deux fautes, pas une.
 *
 * Le canari mesure donc CHAQUE échelon SÉPARÉMENT, au lieu de constater
 * « ça marche / ça ne marche plus ». C'est la différence utile : le jour où
 * l'échelon 1 meurt, l'app tient encore sur les suivants, mais on veut le
 * savoir CE JOUR-LÀ, pas quand le dernier lâche.
 *
 * Il compare ce qu'il mesure à ce qu'on ATTEND (voir `ATTENDU` plus bas), et
 * n'alerte que sur l'écart. Depuis le 9 août 2026, un serveur n'obtient plus
 * rien de TikTok : juger « la chaîne serveur est morte » ferait sonner une
 * alarme chaque matin pour une situation connue, sur laquelle personne
 * n'agirait — et une alarme qui sonne toujours ne se lit plus.
 *
 * Trois états :
 *   vert   — conforme à l'attendu, rien à dire.
 *   orange — mieux que prévu : un échelon a ressuscité. Bonne nouvelle, elle
 *            rouvrirait un chemin automatique sans application installée.
 *   rouge  — moins bien que prévu : quelque chose qui marchait s'est éteint.
 *
 * Orange et rouge sortent en code d'erreur : le workflow ouvre alors une
 * alerte. Voir `.github/workflows/canari-extraction.yml`.
 *
 * Usage :  node scripts/canari-extraction.mjs [--json]
 */

const JSON_SEUL = process.argv.includes('--json');

const UA_NAVIGATEUR =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_ROBOT_SOCIAL =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

// La fonction déployée, et la clé PUBLIABLE — celle que le navigateur porte
// déjà. Aucun secret n'a sa place dans un script qui tourne en clair.
const FONCTION = 'https://usztistixgzdrvjzplqx.supabase.co/functions/v1/extract-place';
const CLE_PUBLIABLE = 'sb_publishable_yaO8Y2s2j2WspT4gYsRmlw_SO7m92nD';

/**
 * Les liens de contrôle. Deux exigences contradictoires : ils doivent rester
 * en ligne longtemps (donc des comptes institutionnels), et ressembler à ce
 * que les gens collent vraiment (donc un carrousel de restaurant).
 *
 * Un lien supprimé n'est PAS une panne de la chaîne : le canari le détecte et
 * l'écarte du verdict, en le signalant pour qu'on le remplace.
 */
const TEMOINS = [
  { nom: 'compte institutionnel', url: 'https://www.tiktok.com/@nasa/video/7255829231477624107' },
  { nom: 'carrousel de lieu', url: 'https://vm.tiktok.com/ZGdxABaKs/' },
];

const delai = (ms) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
};

async function texte(url, ua, { redirect = 'follow' } = {}) {
  const { signal, clear } = delai(15000);
  try {
    // `ua` nul = ne rien annoncer de particulier. Tous les interlocuteurs ne
    // veulent pas d'un navigateur : le lecteur tiers refuse justement ceux-là.
    const r = await fetch(url, {
      headers: ua ? { 'User-Agent': ua } : {}, signal, redirect,
    });
    const corps = await r.text();
    clear();
    return { statut: r.status, url: r.url, corps };
  } catch (e) {
    clear();
    return { statut: 0, url, corps: '', erreur: String(e.message || e) };
  }
}

const baliseMeta = (html, prop) => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i');
  const m = html.match(re) || html.match(new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') : '';
};

const idVideo = (url) => (url.match(/\/(?:video|photo)\/(\d{6,})/) || [])[1] || '';

/**
 * Le remplissage que TikTok sert à la place d'une légende — « TikTok | Make
 * Your Day », « Watch, follow, and discover more trending content. » Identique
 * pour tout le catalogue, donc sans valeur.
 *
 * Le canari doit l'écarter pour la même raison que la fonction Edge : compter
 * ces phrases comme des légendes ferait passer la chaîne pour vivante alors
 * qu'aucun échelon ne nomme plus rien. Une alarme qui rassure à tort est pire
 * que pas d'alarme. Garder cette liste alignée sur `LEGENDES_GENERIQUES` dans
 * `supabase/functions/extract-place/index.ts`.
 */
const GENERIQUES = [
  /^\s*tiktok\s*(?:[|·\-–—]\s*make your day\s*)?$/i,
  /make your day/i,
  /watch,? follow,? and discover more trending content/i,
  /regardez,? suivez et découvrez/i,
  /^\s*(?:log ?in|sign ?up|connexion|s'inscrire)\b/i,
];
const legendeGenerique = (t) => {
  const s = (t || '').trim();
  return !s || GENERIQUES.some(re => re.test(s));
};

/**
 * La légende telle qu'un lecteur tiers la rend : pas en clair, mais dans le
 * TEXTE ALTERNATIF des images. Jumelle de `legendeDansTexteAlternatif` dans
 * `supabase/functions/extract-place/index.ts` — `scripts/verif-legende-alt.mjs`
 * passe les mêmes cas dans les deux et casse si elles divergent.
 */
function legendeDansTexteAlternatif(markdown) {
  for (const m of markdown.matchAll(/!\[([^\]]{10,900})\]\(([^)\s]*)\)/g)) {
    const [, alt, image] = m;
    let t = (alt.match(/[“"]([\s\S]{3,600}?)[”"]\s*\.?\s*$/) || [])[1] || '';
    if (!t) {
      const apres = alt.replace(/^[\s\S]*?(?:Comments?|commentaires?)\s*[.:]\s*/i, '');
      if (apres !== alt) {
        t = apres
          .replace(/^(?:image|video|vidéo)?\s*posted by[^:]{0,90}:\s*/i, '')
          .replace(/^TikTok (?:video|photo) (?:from|de)[^.]{0,90}\.\s*/i, '');
      }
    }
    t = t.trim();
    if (t.length >= 8 && !legendeGenerique(t)) return { caption: t, image };
  }
  return null;
}

/**
 * Les échelons, du plus souhaitable au dernier recours. L'ordre EST la
 * politique : chacun ne sert que si les précédents se taisent.
 *
 * `secours: true` marque les échelons qui ne devraient pas porter la chaîne
 * tout seuls — s'il ne reste qu'eux, on passe en orange.
 */
const ECHELONS = [
  {
    nom: 'oembed',
    quoi: "l'API publique d'intégration",
    async lire({ canonique }) {
      const r = await texte(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonique)}`, UA_NAVIGATEUR);
      if (r.statut !== 200) return { echec: `HTTP ${r.statut || r.erreur}` };
      let d; try { d = JSON.parse(r.corps); } catch { return { echec: 'réponse non JSON' }; }
      return { legende: d.title || '', compte: d.author_name || '', couverture: d.thumbnail_url || '' };
    },
  },
  {
    nom: 'page-embed',
    quoi: 'la page d’intégration /embed/v2',
    async lire({ id }) {
      if (!id) return { echec: 'identifiant de vidéo introuvable' };
      const r = await texte(`https://www.tiktok.com/embed/v2/${id}`, UA_NAVIGATEUR);
      if (r.statut !== 200) return { echec: `HTTP ${r.statut || r.erreur}` };
      const desc = (r.corps.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
      const auteur = (r.corps.match(/"uniqueId"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
      const legende = desc ? JSON.parse(`"${desc}"`) : '';
      if (!legende && !auteur) return { echec: 'page servie, mais sans légende' };
      return { legende, compte: auteur, couverture: '' };
    },
  },
  {
    nom: 'donnees-page',
    quoi: 'le bloc de données inline de la page complète',
    async lire({ canonique }) {
      const r = await texte(canonique, UA_NAVIGATEUR);
      if (r.statut !== 200) return { echec: `HTTP ${r.statut || r.erreur}` };
      if (/captcha|verify_?page|security check/i.test(r.corps)) {
        return { echec: 'page de vérification (captcha)' };
      }
      const bloc = (r.corps.match(
        /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/) || [])[1]
        || (r.corps.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
      if (!bloc) return { echec: 'aucun bloc de données dans la page' };
      let d; try { d = JSON.parse(bloc); } catch { return { echec: 'bloc de données illisible' }; }
      const item = d?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct
        || Object.values(d?.ItemModule || {})[0];
      if (!item) return { echec: 'bloc présent, mais sans la vidéo' };
      return {
        legende: item.desc || '',
        compte: item.author?.uniqueId || item.author || '',
        couverture: item.video?.cover || item.video?.originCover || '',
      };
    },
  },
  {
    nom: 'robot-social',
    quoi: 'la page servie aux robots des messageries',
    secours: true,
    async lire({ canonique }) {
      const r = await texte(canonique, UA_ROBOT_SOCIAL);
      if (r.statut !== 200) return { echec: `HTTP ${r.statut || r.erreur}` };
      const titre = baliseMeta(r.corps, 'og:title');
      const compte = titre.replace(/^\s*TikTok\s*[·|\-–—]\s*/i, '').trim();
      const legende = baliseMeta(r.corps, 'og:description');
      const couverture = baliseMeta(r.corps, 'og:image');
      if (!compte && !legende && !couverture) return { echec: 'aucune balise og:' };
      return { legende, compte: /^tiktok$/i.test(compte) ? '' : compte, couverture };
    },
  },
  {
    nom: 'lecteur-tiers',
    quoi: 'un lecteur tiers qui rend la page à notre place',
    secours: true,
    async lire({ canonique }) {
      // Sans agent annoncé, comme la fonction Edge. Mesuré le 9 août 2026 : ce
      // lecteur refuse les navigateurs (403 en 14 ms sur un agent Safari, 200
      // sans agent et 200 sur un agent Deno). Le canari s'était déguisé en
      // iPhone et avait déclaré morte une chaîne qui marchait — une alarme
      // doit mesurer avec l'identité du code qu'elle surveille, pas la sienne.
      const r = await texte(`https://r.jina.ai/${canonique}`, null);
      if (r.statut !== 200) return { echec: `HTTP ${r.statut || r.erreur}` };
      if (/captcha|verify_?page|security check/i.test(r.corps)) {
        return { echec: 'le lecteur reçoit lui aussi un captcha' };
      }
      const lu = legendeDansTexteAlternatif(r.corps);
      const compte = (r.corps.match(/tiktok\.com\/@([\w.\-]+)/) || [])[1] || '';
      if (!lu && !compte) return { echec: 'page rendue, mais sans texte alternatif exploitable' };
      return { legende: lu?.caption || '', compte, couverture: lu?.image || '' };
    },
  },
];

/**
 * La couverture n'est pas un échelon comme les autres : elle ne rend pas de
 * texte, elle rend une IMAGE que le modèle lira. Le canari vérifie seulement
 * qu'elle est là et téléchargeable — le reste dépend d'une clé payante, et
 * une alarme ne doit pas coûter à chaque passage.
 */
// La vignette servie aux robots porte un bouton « play » incrusté, fait
// 600 x 828 en qualité 20, et son URL est signée — toute variante rend 403
// (mesuré : sans-bouton, haute-def, gabarit-image, brut). Le modèle n'y lit
// aucun nom. La compter comme exploitable faisait afficher « orange » à une
// chaîne où plus rien ne nomme un lieu automatiquement.
const VIGNETTE_INUTILISABLE = /smartui\/button\/play-icon/i;

async function couvertureUtilisable(url) {
  if (!url) return { ok: false, pourquoi: 'aucune image de couverture' };
  if (VIGNETTE_INUTILISABLE.test(url)) {
    return { ok: false, pourquoi: 'vignette au bouton play — illisible, et l\'URL signée interdit mieux' };
  }
  const { signal, clear } = delai(15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA_ROBOT_SOCIAL }, signal });
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    const buf = new Uint8Array(await r.arrayBuffer());
    clear();
    if (!r.ok) return { ok: false, pourquoi: `HTTP ${r.status}` };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      return { ok: false, pourquoi: `type inattendu (${type || 'inconnu'})` };
    }
    // 5 Mo, comme `COUVERTURE_MAX` dans la fonction Edge. Le plafond valait
    // 1,5 Mo du temps des vignettes de partage : depuis que le lecteur tiers
    // rend les vraies photos, il écartait justement la bonne image.
    if (!buf.length || buf.length > 5_000_000) {
      return { ok: false, pourquoi: `${Math.round(buf.length / 1024)} ko hors bornes` };
    }
    return { ok: true, pourquoi: `${type}, ${Math.round(buf.length / 1024)} ko` };
  } catch (e) {
    clear();
    return { ok: false, pourquoi: String(e.message || e) };
  }
}

async function mesurer(temoin) {
  // Le lien court doit être résolu avant tout : l'identifiant de la vidéo n'y
  // est pas, et l'oEmbed n'aime pas les paramètres de suivi.
  const r = await texte(temoin.url, UA_NAVIGATEUR);
  const finale = r.url || temoin.url;
  const canonique = finale.split('?')[0];
  const id = idVideo(canonique);
  const absent = r.statut === 404
    || /Video currently unavailable|page n’est pas disponible|couldn't find this account/i.test(r.corps);

  const resultats = [];
  for (const e of ECHELONS) {
    const t0 = Date.now();
    let out;
    try { out = await e.lire({ canonique, id, brut: temoin.url }); }
    catch (err) { out = { echec: String(err.message || err) }; }
    const generique = legendeGenerique(out.legende);
    resultats.push({
      echelon: e.nom, quoi: e.quoi, secours: !!e.secours, ms: Date.now() - t0,
      // Une phrase générique n'est pas une légende : on la montre pour qu'on
      // sache ce qui a été servi, sans la compter comme un échelon vivant.
      legende: generique ? '' : (out.legende || '').slice(0, 120),
      remplissage: generique && out.legende ? out.legende.slice(0, 60) : '',
      compte: out.compte || '', couverture: out.couverture || '', echec: out.echec || '',
    });
  }

  // La chaîne retient la MEILLEURE couverture, pas la première : le lecteur
  // tiers rend la vraie photo là où la page des robots ne rend qu'une vignette
  // barrée du bouton ▶. Juger sur la première mesurerait ce que l'app n'affiche
  // pas — et une alarme qui mesure autre chose que la réalité ne sert à rien.
  const images = resultats.map(x => x.couverture).filter(Boolean);
  const image = images.find(u => !VIGNETTE_INUTILISABLE.test(u)) || images[0] || '';
  return {
    temoin: temoin.nom, url: temoin.url, resolu: canonique, id,
    // Un captcha n'est PAS une disparition : la page des robots répond 200 et
    // porte les balises. Tant qu'elle donne une couverture ou un compte, la
    // vidéo existe — confondre les deux ferait crier « témoins disparus »
    // chaque fois que TikTok se méfie d'une adresse de centre de données.
    absent: absent && !resultats.some(r => r.couverture || r.compte),
    echelons: resultats,
    couverture: await couvertureUtilisable(image),
  };
}

/**
 * Le verdict — et ce qu'il compare.
 *
 * Depuis le 9 août 2026, la réponse à « un serveur peut-il nommer le lieu d'un
 * post TikTok ? » est NON, définitivement : oEmbed éteint, page complète en
 * captcha depuis toute adresse de centre de données, vignette de couverture
 * illisible et son URL signée interdisant mieux. Le chemin automatique passe
 * désormais par l'application installée, qui sort par la connexion de la
 * personne — et qu'aucun exécuteur ne peut imiter.
 *
 * Un canari qui jugerait « la chaîne serveur est morte » crierait donc ROUGE
 * chaque matin, pour une situation connue et sur laquelle personne n'agira.
 * Une alarme qui sonne toujours ne se lit plus : c'est l'inverse du but.
 *
 * Il compare donc la réalité à ce qu'on ATTEND, et n'alerte que sur l'écart —
 * dans les deux sens. Un échelon qui ressuscite est une bonne nouvelle qui
 * vaut d'être sue : elle rouvrirait un chemin sans application installée.
 */
/**
 * L'attendu est PAR TÉMOIN : un post photo et une vidéo ne rendent pas la même
 * chose au lecteur tiers, et une attente commune ferait sonner l'alarme tous
 * les matins sur celui des deux qui ne la remplit pas.
 *
 * Chaque valeur ici a été MESURÉE, jamais supposée. Une attente devinée qui se
 * révèle fausse produit exactement l'alarme permanente qu'on cherche à éviter.
 */
const ATTENDU_PAR_DEFAUT = {
  echelonsVivants: [],      // aucun échelon ne rend de légende
  couvertureLisible: false, // la vignette porte un bouton play incrusté
};
const ATTENDU = {
  // Mesuré le 9 août 2026 : le lecteur tiers rend la page que TikTok nous
  // refuse, et la légende s'y trouve dans le texte alternatif des images.
  'carrousel de lieu': { echelonsVivants: ['lecteur-tiers'], couvertureLisible: true },
  // Compte institutionnel : à mesurer avant d'affirmer quoi que ce soit.
  'compte institutionnel': ATTENDU_PAR_DEFAUT,
};
const attenduDe = (nom) => ATTENDU[nom] || ATTENDU_PAR_DEFAUT;

function juger(mesures, modele) {
  const vivantes = mesures.filter(m => !m.absent);
  const soucis = [];
  const bonnesNouvelles = [];

  if (!vivantes.length) {
    return { etat: 'orange', resume: 'tous les liens témoins ont disparu — à remplacer' };
  }

  for (const m of vivantes) {
    const attendu = attenduDe(m.temoin);
    const nomme = m.echelons.filter(e => e.legende && !e.echec).map(e => e.echelon);
    const inattendus = nomme.filter(n => !attendu.echelonsVivants.includes(n));
    const disparus = attendu.echelonsVivants.filter(n => !nomme.includes(n));

    if (inattendus.length) {
      bonnesNouvelles.push(
        `« ${m.temoin} » : ${inattendus.join(', ')} rend de nouveau une légende `
        + `— un chemin automatique sans application installée redevient possible`);
    }
    if (disparus.length) {
      soucis.push(`« ${m.temoin} » : ${disparus.join(', ')} ne rend plus de légende`);
    }
    if (m.couverture.ok && !attendu.couvertureLisible) {
      bonnesNouvelles.push(`« ${m.temoin} » : la couverture est redevenue exploitable`);
    }
    if (!m.couverture.ok && attendu.couvertureLisible) {
      soucis.push(`« ${m.temoin} » : la couverture n'est plus exploitable (${m.couverture.pourquoi})`);
    }
  }

  // La clé du modèle, elle, doit rester posée : les lectures de réservation,
  // de ticket et de légende collée en dépendent toutes.
  if (modele?.connu && !modele.ok) {
    soucis.push("la clé du modèle n'est plus posée — lecture de légende, de "
      + 'réservation et de ticket à l\'arrêt');
  }

  const morts = mesures.filter(m => m.absent).map(m => m.temoin);
  if (morts.length) soucis.push(`liens témoins disparus, à remplacer : ${morts.join(', ')}`);

  if (soucis.length) return { etat: 'rouge', resume: soucis.join(' · ') };
  if (bonnesNouvelles.length) return { etat: 'orange', resume: bonnesNouvelles.join(' · ') };
  return { etat: 'vert', resume: 'conforme à ce qu\'on attend d\'un serveur depuis le 9 août 2026' };
}

/**
 * La clé du modèle est-elle posée sur la fonction déployée ?
 *
 * Ce n'est pas un détail d'exploitation : depuis que TikTok ne rend plus de
 * légende, lire le nom sur la couverture est le SEUL échelon qui nomme encore
 * un lieu — et il ne fonctionne pas sans clé. Une clé absente, révoquée ou
 * expirée casse donc l'ajout par lien en silence. La sonde ne consomme rien :
 * elle regarde la variable, elle n'appelle pas le modèle.
 */
async function modeleConfigure() {
  const { signal, clear } = delai(15000);
  try {
    const r = await fetch(FONCTION, {
      method: 'POST', signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CLE_PUBLIABLE}`, apikey: CLE_PUBLIABLE,
      },
      body: JSON.stringify({ sante: true }),
    });
    clear();
    if (!r.ok) return { connu: false, pourquoi: `HTTP ${r.status}` };
    const d = await r.json();
    // Une fonction pas encore redéployée ne connaît pas la sonde : elle répond
    // autre chose. On ne conclut alors rien, plutôt que de crier au loup.
    if (typeof d?.modele !== 'boolean') return { connu: false, pourquoi: 'sonde non déployée' };
    return { connu: true, ok: d.modele };
  } catch (e) {
    clear();
    return { connu: false, pourquoi: String(e.message || e) };
  }
}

const mesures = [];
for (const t of TEMOINS) mesures.push(await mesurer(t));
const modele = await modeleConfigure();
const verdict = juger(mesures, modele);

if (JSON_SEUL) {
  console.log(JSON.stringify({ verdict, modele, mesures }, null, 2));
} else {
  for (const m of mesures) {
    console.log(`\n■ ${m.temoin}${m.absent ? '  (LIEN DISPARU)' : ''}`);
    console.log(`  ${m.url}\n  → ${m.resolu}${m.id ? `  (id ${m.id})` : ''}`);
    for (const e of m.echelons) {
      const etat = e.echec ? '✗' : (e.legende ? '✓' : '~');
      const dit = e.echec ? e.echec
        : e.legende ? `« ${e.legende} »`
        : e.remplissage ? `remplissage générique : « ${e.remplissage} »`
        : e.compte ? `compte seul : ${e.compte}` : 'rien';
      console.log(`  ${etat} ${e.echelon.padEnd(14)}${String(e.ms).padStart(5)} ms  ${dit}`);
    }
    console.log(`  ${m.couverture.ok ? '✓' : '✗'} couverture      ${m.couverture.pourquoi}`);
  }
  console.log(`\n■ lecture de couverture (dernier échelon)`);
  console.log(`  ${modele.connu ? (modele.ok ? '✓' : '✗') : '~'} clé du modèle   `
    + `${modele.connu ? (modele.ok ? 'posée sur la fonction déployée'
      : 'ABSENTE — cet échelon ne peut pas fonctionner')
      : `état inconnu (${modele.pourquoi})`}`);

  const sceau = { vert: '🟢', orange: '🟠', rouge: '🔴' }[verdict.etat];
  console.log(`\n${sceau} ${verdict.etat.toUpperCase()} — ${verdict.resume}\n`);
}

// Vert = 0. Orange = 1 (préviens-moi, rien n'est cassé). Rouge = 2 (cassé).
process.exit(verdict.etat === 'vert' ? 0 : verdict.etat === 'orange' ? 1 : 2);
