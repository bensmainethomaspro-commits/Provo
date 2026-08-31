/**
 * Exécuter sous Node une fonction écrite en TypeScript pour Deno.
 *
 * Les fonctions Edge sont en TypeScript ; les vérifications tournent sous Node.
 * La règle du dépôt est de DÉCOUPER la fonction dans sa source plutôt que de la
 * recopier — un test qui recopie le code qu'il teste ne teste plus rien — donc
 * il faut retirer les annotations à la volée.
 *
 * Ce fichier existe parce que ce découpage a été réécrit trois fois de suite,
 * avec les mêmes pièges à chaque fois (règle E13 : une règle posée quelque part
 * se cherche partout ailleurs). Les trois pièges, pour qu'ils ne reviennent
 * pas :
 *
 *  1. UN BALAYAGE GLOBAL DÉVORE LES EXPRESSIONS RÉGULIÈRES. Le motif d'un type
 *     de retour — « ) … : … { » — trouve une correspondance à l'intérieur de
 *     `/^(\d{1,2}):(\d{2})/`. D'où un traitement LIGNE PAR LIGNE, appliqué aux
 *     seules lignes de déclaration : les annotations vivent sur les signatures,
 *     les expressions régulières dans les corps.
 *  2. UN TYPE DE RETOUR PEUT CONTENIR DES ACCOLADES (`): { date: string } {`).
 *     Aucun motif simple ne sait où il commence — on découpe donc à la
 *     parenthèse fermante des paramètres, la dernière avant l'accolade.
 *  3. `null as number | null` DOIT ÊTRE AVALÉ AVEC SON UNION. Sans elle il
 *     reste « null | null », un OU binaire qui vaut **0** : le test passe au
 *     vert sur des valeurs fausses, ce qui est pire qu'un test rouge.
 *
 * Ne prétend pas être un compilateur : il couvre ce que ce dépôt écrit.
 * Une signature doit tenir sur UNE ligne pour être reconnue.
 */

const DECLARATION = /^\s*(export\s+)?(async\s+)?(function\b|const\s+\w+\s*[:=])/;

export function sansTypes(source) {
  return source.split('\n').map((ligne) => {
    if (!DECLARATION.test(ligne)) return ligne;
    const iAccolade = ligne.lastIndexOf('{');
    const iParen = iAccolade < 0 ? -1 : ligne.lastIndexOf(')', iAccolade);
    // Une fonction fléchée garde sa flèche : elle vit entre la parenthèse et
    // l'accolade, exactement là où passe la découpe.
    const fleche = iParen > 0 && ligne.slice(iParen + 1, iAccolade).includes('=>')
      ? ' =>' : '';
    // Sans parenthèse avant l'accolade, ce n'est pas une signature mais une
    // constante typée (`const JOURS: Record<…> = {`) : on ne découpe rien.
    const nette = ligne.trimEnd().endsWith('{') && iParen > 0
      ? `${ligne.slice(0, iParen + 1)}${fleche} {`
      : ligne;
    return nette
      .replace(/:\s*Record<[^>]*>(\[\])?/g, '')
      .replace(/:\s*\[[^\]]*\]\[\]/g, '')
      .replace(/:\s*(unknown|string|number|boolean|any|Date|URL)(\[\])?/g, '');
  }).join('\n')
    // Les assertions vivent dans les corps, mais leur forme ne ressemble à
    // rien d'autre.
    .replace(/\s+as\s+[A-Za-z0-9_$]+(<[^>]*>)?(\[\])?(\s*\|\s*[A-Za-z0-9_$]+)*/g, '')
    // `m.index!` : le « ! » d'assertion suit un mot ou une parenthèse. Celui de
    // `!==` suit une espace, et celui de `!x` n'en suit aucun — ils restent.
    .replace(/([\w)])!(?!=)/g, '$1')
    .replace(/export /g, '');
}

/** Découpe un bloc entre deux repères de la source, types retirés. */
export function decouper(source, debut, fin) {
  const i = source.indexOf(debut);
  if (i < 0) throw new Error(`repère introuvable : ${debut}`);
  const j = fin ? source.indexOf(fin, i) : source.length;
  if (j < 0) throw new Error(`repère de fin introuvable : ${fin}`);
  return sansTypes(source.slice(i, j));
}
