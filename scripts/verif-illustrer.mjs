/**
 * La photo et la présentation d'un lieu, depuis Wikidata, Wikipédia et
 * Wikimedia Commons (`src/utils/illustrer.js`). Réseau simulé : aucun appel.
 *
 * Ce qui compte :
 *   1. une photo libre arrive avec son auteur, sa licence et sa page ;
 *   2. la présentation est en français, ou il n'y en a pas ;
 *   3. un service muet ne casse rien, et ne fabrique rien.
 *
 * Usage :  node scripts/verif-illustrer.mjs
 */
let reponses = {};
const appels = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  appels.push(u);
  const cle = Object.keys(reponses).find(k => u.includes(k));
  const r = cle ? reponses[cle] : undefined;
  if (r === 'coupure') throw new Error('réseau coupé');
  if (r === undefined) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => r };
};

const { illustrer, deuxPhrases, fichierDe } = await import('../src/utils/illustrer.js');

let ok = 0, ko = 0;
const v = (nom, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nom}`); } else { ko++; console.log(`  ✗ ${nom} — ${detail}`); }
};
const J = JSON.stringify;

const ENTITE = (image, fr) => ({ entities: { Q172988: {
  claims: image ? { P18: [{ mainsnak: { datavalue: { value: image } } }] } : {},
  sitelinks: fr ? { frwiki: { title: fr } } : {},
} } });
const IMAGE = (artiste, licence) => ({ query: { pages: { 1: { imageinfo: [{
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Basilica_di_San_Marco.jpg',
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Basilica_di_San_Marco.jpg/900px-Basilica_di_San_Marco.jpg',
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Basilica_di_San_Marco.jpg',
  extmetadata: { Artist: { value: artiste }, LicenseShortName: { value: licence } },
}] } } } });
const RESUME = {
  extract: 'La basilique Saint-Marc (en italien : Basilica di San Marco) est la plus importante basilique de Venise. '
    + 'Construite en 828, elle fut reconstruite après un incendie en 976. Elle est la cathédrale de la ville depuis 1807.',
  originalimage: { source: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Venezia_Basilica.jpg' },
};

console.log('\n1 · Un monument relié à Wikidata : photo créditée et deux phrases');
reponses = {
  'wikidata.org': ENTITE('Basilica di San Marco.jpg', 'Basilique Saint-Marc'),
  'fr.wikipedia.org/api/rest_v1': RESUME,
  'commons.wikimedia.org': IMAGE('<a href="//commons.wikimedia.org/wiki/User:Zairon">Zairon</a>', 'CC BY-SA 4.0'),
};
let r = await illustrer({ wikidata: 'Q172988' });
v('la photo, à la taille d’un écran', /900px-Basilica/.test(r?.photoUrl || ''), J(r));
v('son auteur, sans balises, et sa licence', r?.photoCredit === 'Zairon · CC BY-SA 4.0 · Wikimedia Commons', r?.photoCredit);
v('le lien vers la page de l’image', r?.photoPage === 'https://commons.wikimedia.org/wiki/File:Basilica_di_San_Marco.jpg');
v('deux phrases en français, sans la parenthèse d’encyclopédie',
  r?.description === 'La basilique Saint-Marc est la plus importante basilique de Venise. Construite en 828, elle fut reconstruite après un incendie en 976.', r?.description);
v('les trois services sont appelés avec `origin=*` (lecture depuis le téléphone)',
  appels.filter(a => a.includes('/w/api.php')).every(a => a.includes('origin=*')), J(appels));

console.log('\n2 · Pas d’article en français : pas de texte d’une autre langue');
reponses = {
  'wikidata.org': ENTITE('Basilica di San Marco.jpg', null),
  'commons.wikimedia.org': IMAGE('Zairon', 'CC BY-SA 4.0'),
};
appels.length = 0;
r = await illustrer({ wikidata: 'Q172988' });
v('la photo vient quand même', Boolean(r?.photoUrl));
v('aucune présentation', r?.description === undefined, J(r));
v('aucun appel à un Wikipédia d’une autre langue', !appels.some(a => /\/\/(en|it)\.wikipedia/.test(a)), J(appels));

console.log('\n3 · Pas de photo choisie sur Wikidata : celle qui ouvre l’article');
reponses = {
  'wikidata.org': ENTITE(null, 'Basilique Saint-Marc'),
  'fr.wikipedia.org/api/rest_v1': RESUME,
  'commons.wikimedia.org': IMAGE('Didier Descouens', 'CC BY-SA 4.0'),
};
appels.length = 0;
r = await illustrer({ wikidata: 'Q172988' });
v('le fichier de l’article est demandé à Commons', appels.some(a => a.includes('File%3AVenezia+Basilica.jpg') || a.includes('File:Venezia Basilica.jpg') || a.includes('Venezia')), J(appels.slice(-1)));
v('photo et crédit', Boolean(r?.photoUrl) && r.photoCredit.startsWith('Didier Descouens'), J(r));

console.log('\n4 · Seulement l’étiquette `wikipedia=it:…` : l’identifiant se retrouve');
reponses = {
  'it.wikipedia.org': { query: { pages: { 9: { pageprops: { wikibase_item: 'Q172988' } } } } },
  'wikidata.org': ENTITE('Basilica di San Marco.jpg', 'Basilique Saint-Marc'),
  'fr.wikipedia.org/api/rest_v1': RESUME,
  'commons.wikimedia.org': IMAGE('Zairon', 'CC BY-SA 4.0'),
};
r = await illustrer({ wikipedia: 'it:Basilica di San Marco' });
v('photo et présentation, comme avec l’identifiant', Boolean(r?.photoUrl) && r.description?.startsWith('La basilique'), J(r));

console.log('\n5 · La fiche a déjà sa photo Wikipédia : on n’apporte que le crédit');
reponses = {
  'wikidata.org': ENTITE('Une autre image.jpg', 'Basilique Saint-Marc'),
  'fr.wikipedia.org/api/rest_v1': RESUME,
  'commons.wikimedia.org': IMAGE('Zairon', 'CC BY-SA 4.0'),
};
appels.length = 0;
r = await illustrer({ wikidata: 'Q172988',
  photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Basilica_di_San_Marco.jpg/600px-Basilica_di_San_Marco.jpg' });
v('la photo de la fiche n’est pas remplacée', r?.photoUrl === undefined, J(r));
v('son crédit est retrouvé par le nom de SON fichier', r?.photoCredit?.startsWith('Zairon')
  && appels.some(a => a.includes('Basilica+di+San+Marco.jpg') || a.includes('Basilica%20di%20San%20Marco.jpg')), J(appels));
r = await illustrer({ photoUrl: 'https://exemple.fr/ma-photo.jpg' });
v('une photo d’ailleurs : rien à créditer, rien à chercher', r === null, J(r));

console.log('\n6 · Un service muet ne casse rien et n’invente rien');
reponses = { 'wikidata.org': 'coupure' };
r = await illustrer({ wikidata: 'Q172988' });
v('réseau coupé : rien', r === null, J(r));
reponses = {};
r = await illustrer({ wikidata: 'Q172988' });
v('service en erreur : rien', r === null, J(r));
appels.length = 0;
r = await illustrer({});
v('un lieu que rien ne relie à Wikidata : aucun appel', r === null && appels.length === 0, `${appels.length} appel(s)`);
r = await illustrer({ wikidata: 'pas-un-identifiant' });
v('un identifiant mal formé n’est pas envoyé', r === null && appels.length === 0);
reponses = {
  'wikidata.org': ENTITE('Basilica di San Marco.jpg', 'Basilique Saint-Marc'),
  'fr.wikipedia.org/api/rest_v1': { extract: 'Église.' },
  'commons.wikimedia.org': IMAGE('', ''),
};
r = await illustrer({ wikidata: 'Q172988' });
v('un résumé d’un mot n’est pas une présentation', r?.description === undefined, J(r));
v('sans auteur ni licence connus, la source reste dite', r?.photoCredit === 'Wikimedia Commons', r?.photoCredit);

console.log('\n7 · Deux phrases, pas un article');
v('la prononciation disparaît',
  deuxPhrases('Schönbrunn (prononcé [ʃøːnˈbʁʊn]) est un château de Vienne. Il fut la résidence d’été des Habsbourg.')
    === 'Schönbrunn est un château de Vienne. Il fut la résidence d’été des Habsbourg.');
v('une parenthèse qui dit quelque chose reste',
  deuxPhrases('Le pont du Rialto (1591) franchit le Grand Canal.') === 'Le pont du Rialto (1591) franchit le Grand Canal.');
v('une seconde phrase trop longue n’est pas prise',
  deuxPhrases(`Courte phrase. ${'Très longue suite de mots '.repeat(20)}fin.`) === 'Courte phrase.');
{
  const long = deuxPhrases(`${'Une phrase interminable, pleine de virgules, '.repeat(12)}fin.`);
  v('une seule phrase trop longue se coupe à un mot, avec « … »', long.length <= 262 && long.endsWith('…') && !/[,;:\s]…$/.test(long), `${long.length} c`);
}
v('une abréviation ne coupe pas la phrase',
  deuxPhrases('La basilique St. Marc domine la place. Elle date du XIe siècle.') === 'La basilique St. Marc domine la place. Elle date du XIe siècle.');
v('rien à dire : rien', deuxPhrases('') === '' && deuxPhrases(null) === '');

console.log('\n8 · Le fichier d’une image de Wikimedia');
v('vignette', fichierDe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Basilica_di_San_Marco.jpg/600px-Basilica_di_San_Marco.jpg') === 'Basilica di San Marco.jpg');
v('original, avec accents', fichierDe('https://upload.wikimedia.org/wikipedia/commons/c/cd/Th%C3%A9%C3%A2tre.jpg') === 'Théâtre.jpg');
v('une autre adresse', fichierDe('https://exemple.fr/x.jpg') === '' && fichierDe('') === '');

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
