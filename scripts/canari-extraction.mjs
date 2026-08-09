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
 * Trois états :
 *   vert   — les échelons de tête répondent, la chaîne a de la marge.
 *   orange — on ne tient plus que sur les échelons de secours. Rien n'est
 *            cassé pour l'utilisateur, mais la prochaine panne sera visible.
 *   rouge  — plus aucun échelon ne nomme le lieu : l'app est cassée.
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
    const r = await fetch(url, { headers: { 'User-Agent': ua }, signal, redirect });
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
];

/**
 * La couverture n'est pas un échelon comme les autres : elle ne rend pas de
 * texte, elle rend une IMAGE que le modèle lira. Le canari vérifie seulement
 * qu'elle est là et téléchargeable — le reste dépend d'une clé payante, et
 * une alarme ne doit pas coûter à chaque passage.
 */
async function couvertureUtilisable(url) {
  if (!url) return { ok: false, pourquoi: 'aucune image de couverture' };
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
    if (!buf.length || buf.length > 1_500_000) {
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

  const image = resultats.map(x => x.couverture).find(Boolean) || '';
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
 * Le verdict. Ce qui compte n'est pas « combien d'échelons marchent » mais
 * « reste-t-il de quoi NOMMER un lieu ». Une légende nomme ; une couverture se
 * fait lire ; un compte, jamais — « Idée de @avery » n'est pas un lieu.
 */
function juger(mesures, modele) {
  const vivantes = mesures.filter(m => !m.absent);
  if (!vivantes.length) {
    return { etat: 'orange', resume: 'tous les liens témoins ont disparu — à remplacer' };
  }
  const soucis = [];
  let pire = 'vert';
  for (const m of vivantes) {
    const avecLegende = m.echelons.filter(e => e.legende && !e.echec);
    const teteVivante = avecLegende.some(e => !e.secours);
    if (avecLegende.length) {
      if (!teteVivante) {
        pire = pire === 'rouge' ? 'rouge' : 'orange';
        soucis.push(`« ${m.temoin} » : plus que des échelons de secours pour la légende`);
      }
      continue;
    }
    // Aucune légende nulle part : il ne reste que la couverture à faire lire.
    if (m.couverture.ok) {
      // …encore faut-il que le modèle soit configuré pour la lire. Sinon ce
      // dernier échelon n'existe que sur le papier, et l'app est cassée.
      if (modele?.connu && !modele.ok) {
        pire = 'rouge';
        soucis.push(`« ${m.temoin} » : aucune légende, et la clé du modèle n'est pas `
          + `posée — la lecture de couverture ne peut pas prendre le relais`);
      } else {
        pire = pire === 'rouge' ? 'rouge' : 'orange';
        soucis.push(`« ${m.temoin} » : aucune légende, l'app ne tient que sur la lecture d'image`);
      }
    } else {
      pire = 'rouge';
      soucis.push(`« ${m.temoin} » : aucune légende ET pas de couverture lisible `
        + `(${m.couverture.pourquoi}) — plus rien ne nomme le lieu`);
    }
  }
  const morts = mesures.filter(m => m.absent).map(m => m.temoin);
  if (morts.length) soucis.push(`liens témoins disparus, à remplacer : ${morts.join(', ')}`);
  return { etat: pire, resume: soucis.join(' · ') || 'la chaîne a de la marge' };
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
