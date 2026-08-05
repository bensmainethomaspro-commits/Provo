---
name: parcours
description: Parcourt toutes les fonctionnalités de l'app en les utilisant vraiment, et rapporte ce qui est cassé et ce qui coûte à l'utilisateur. Utiliser avant une livraison importante, après une modification qui touche plusieurs écrans, quand l'utilisateur demande de « tester l'app », « chercher des bugs », « vérifier que tout marche », ou invoque /parcours. Complète /verif-ui (qui mesure la présentation) et /audit (qui juge la conception).
---

# Parcours fonctionnel

Trois outils, trois questions différentes. Aucun ne remplace les autres :

| | Question | Ce qu'il rate |
|---|---|---|
| `/audit` | *Est-ce bien conçu ?* | Une fonction qui ne marche pas |
| `/verif-ui` | *Est-ce lisible et atteignable ?* | Un bouton parfait qui n'enregistre rien |
| **`/parcours`** | **Est-ce que ça marche ?** | Le goût, l'élégance, le contraste |

Celui-ci appuie sur les boutons. Il rejoue des intentions d'utilisateur —
« j'ajoute une dépense et je vois qui doit quoi » — et vérifie **deux** choses :
ce qui s'affiche, et ce qui est réellement enregistré. Les deux, parce qu'un
écran peut avoir l'air juste pendant que les données s'abîment derrière.

## Lancer

```bash
npm run build
(setsid npx vite preview --port 4173 --strictPort &) ; sleep 3
node scripts/parcours.mjs
```

`--seul <motif>` pour rejouer un seul parcours, `--json` pour exploiter la
sortie, `--url` pour viser un autre serveur. Code de sortie 0 = rien de cassé.
Les captures des écrans fautifs vont dans `/tmp/provo-parcours`.

Deux familles, jouées ensemble par défaut :

| | Le monde extérieur | Ce que ça prouve |
|---|---|---|
| `--hors-ligne` | coupé net | l'app tient sa promesse sans réseau |
| `--reseau` | rejoué, panne au choix | elle lit bien les réponses, et encaisse les pannes |

Chaque parcours part d'un contexte neuf : un échec n'en contamine jamais un
autre, et l'ordre n'a pas d'importance.

## Ce que l'app est censée faire

C'est ce qu'il faut connaître pour juger un écran. Le principe directeur est
dans `CLAUDE.md` ; voici sa traduction écran par écran.

**Le produit.** On remplit un vivier d'idées avant de partir ; sur place on y
pioche au lieu de chercher. Ce n'est pas « tout planifier » : le programme d'une
journée peut se composer le jour même. Ce qu'on supprime, c'est de *chercher*
(un resto, un horaire, un prix) et de *réfléchir* à l'optimisation.

**Accueil** — la liste des voyages. Créer, rouvrir, retrouver. Un voyage en
cours doit se distinguer et s'ouvrir en un geste.

**Aujourd'hui** — répond à « qu'est-ce que je fais maintenant ? » sans lecture
ni réflexion. Peu d'informations, gros caractères, action évidente.

**Planning** — le programme jour par jour. Trois vues (frise, jour, agenda).
Les fiches d'activité vivent dans le **détail du jour** : c'est là qu'on
modifie, supprime, réordonne. Le jour J est au centre, les jours passés restent
accessibles à gauche, grisés.

**Réserve** — *le cœur du produit.* Le vivier d'idées. Avant le départ on
l'accumule, sur place on y pioche (« Assigner » → un jour). Tout ce qui aide à
remplir puis à piocher vite a de la valeur : filtres, groupement par catégorie,
recherche, réordonnancement au doigt.

**Dépenses** — se notent en un geste. L'app calcule le partage et qui doit à
qui ; l'utilisateur ne calcule jamais. Trois vues : liste, catégories, par
personne. Une catégorie « Verre » existe parce que c'est la dépense la plus
fréquente en voyage.

**Carte** — où sont les choses, et où je suis. « Me situer » affiche la position
en direct et le lieu le plus proche. Depuis une épingle on ouvre la fiche ou on
pioche l'idée.

**Menu ⋯** — le secondaire : recherche dans le voyage, thème, notes, valise,
comparaison d'activités, complétion automatique des fiches, vérification des
lieux, partage, bilan, paramètres, suppression.

**Deux promesses transverses**, à vérifier comme le reste :
tout fonctionne **hors ligne**, et **rien ne se perd** — au rechargement comme
après n'importe quelle manipulation.

**Aucune fiche ne doit être incomplète** : l'app complète elle-même horaires,
prix, adresse en cherchant en ligne. Elle est force de proposition **en pop-up
uniquement** — elle ne réorganise jamais d'office et ne bloque rien.

## Lire le résultat

Trois catégories, jamais mélangées :

- **✗ CASSÉ** — la fonction ne fait pas ce qu'elle promet, ou abîme les données.
  Un plantage (écran de secours) en fait toujours partie.
- **⚠ FRICTION** — ça marche, mais ça coûte. À traiter par `/audit`, pas ici.
- **· NON JOUÉ** — le parcours n'a pas pu aller au bout. **Ni réussite ni
  échec.** Presque toujours un sélecteur périmé dans le script, pas un bug.

## La règle qui fait tenir cet outil

**Un constat n'est pas un bug tant que la cause n'est pas vérifiée.**

Ce n'est pas une précaution théorique. À la mise au point de ce script, **sept
constats sur huit venaient du script lui-même**, pas de l'application :

- la modale de création est `.modal`, pas `.sheet` ;
- le premier champ de la feuille d'ajout est « adresse ou lien », pas le titre ;
- « Modifier » et « Supprimer » sont dans le menu ⋯ de la fiche ;
- la destination par défaut d'un ajout est la Réserve, pas le jour ;
- le bouton `.btn--full` le plus proche est « Annuler » ;
- l'objet de valise porte le champ `text` ;
- la confirmation de suppression est `.confirm-box`.

Annoncer ces sept-là comme des bugs aurait fait perdre du temps et détruit la
confiance dans l'outil. Devant un ✗ : **aller regarder le DOM réel** avant de
toucher au code de l'app (playbook E2, F4).

## Vérifier que l'outil voit encore quelque chose

Un parcours tout vert ne prouve rien s'il ne sait plus détecter une panne.
De temps en temps — et après toute réécriture du script — **casser volontairement
une fonction** dans le code de l'app, vérifier que le parcours l'attrape, puis
**tout restaurer**. Ne jamais laisser de crochet d'injection dans le code livré.

Deux pannes de référence, déjà éprouvées :

| Panne injectée | Ce que le parcours doit dire |
|---|---|
| `addExpense` ne persiste plus | ✗ « la dépense est enregistrée » **et** « elle apparaît dans la liste » |
| le réordonnancement vide la journée | ✗ « l'ordre a effectivement changé » **et** « l'application est tombée » |
| la météo est reçue mais jamais affichée | ✗ « une température est affichée » — et le jumeau « météo indisponible » reste vert |

La seconde a appris quelque chose : quand l'app plante, l'état fautif **n'est
jamais enregistré**, donc le contrôle d'intégrité ne peut pas le voir. C'est la
détection du plantage qui l'attrape. Sans elle, la pire des pannes passait
inaperçue.

## Les parcours réseau

`scripts/reseau-stubs.mjs` rejoue chaque service — Nominatim, Overpass,
Open-Meteo, Frankfurter, Wikipédia, et les fonctions Edge `extract-place` et
`enrich-place` — avec des réponses de la forme exacte que l'app attend.

Ce n'est pas un pis-aller. **On ne peut pas demander à un vrai service de tomber
en panne**, et c'est là que sont les bugs : un service qui renvoie 500, un
Nominatim qui répond du HTML au-delà d'une requête par seconde, un 200 avec du
JSON tronqué, une réponse vide qu'il ne faut surtout pas confondre avec une
coupure.

Un parcours déclare son plan, une ligne par service :

```js
reseau: { enrichPlace: 'ok' }          // la réponse de référence
reseau: { meteo: 'err500' }            // le service tombe
reseau: { nominatim: 'err429' }        // trop de requêtes → du HTML, pas du JSON
reseau: { extractPlace: 'malforme' }   // 200, mais le corps est tronqué
reseau: { enrichPlace: 'coupe' }       // injoignable
reseau: { enrichPlace: 'vide' }        // il a répondu, il n'a rien trouvé
```

`vide` et `aucun` sont des **variantes**, pas des pannes : le service a
répondu. La distinction compte — « rien trouvé » se mémorise pour ne pas
redépenser, « pas joignable » se réessaie.

`t.appels()` donne le nombre d'appels reçus par service. C'est ce qui répond à
« ce rouage a-t-il seulement tourné ? » : une chaîne qui n'appelle jamais son
service échoue en silence, et l'écran n'en dit rien.

**Chaque parcours réseau a un jumeau à l'attente inverse** — météo qui s'affiche
/ météo qui ne ment pas quand le service tombe. Les deux au vert prouvent que
le stub pilote vraiment le comportement. Si les stubs cessaient d'agir, un des
deux tomberait.

## Ce qui n'est pas couvert, et pourquoi

**La disponibilité réelle des services**, et la forme actuelle de leurs
réponses. Les stubs figent ce que l'app attend ; ils ne diront jamais qu'un
service a changé son format ou a disparu. C'est l'autre question, et elle se
pose ailleurs : `scripts/diag-*.mjs`, sur un réseau réel (GitHub Actions).

La carte a son propre outil : `scripts/verif-carte.mjs`.

Ne pas conclure « tout marche » à partir d'un parcours vert : dire « les N
parcours passent, réseau simulé compris », et nommer ce qui reste à vérifier
sur le terrain.

## Ajouter un parcours

Un parcours = une **intention d'utilisateur**, pas un test unitaire. Le tableau
`PARCOURS` dans `scripts/parcours.mjs` en donne le format : `groupe`, `nom`,
`intention`, `depart`, `faire(t)`, et `reseau` pour les chaînes distantes.

`depart` vaut `'vierge'` (aucun voyage), `'voyage'` (le voyage de référence),
ou **un voyage sur mesure**. Les états rares sont les plus révélateurs : voyage
vide, pas encore parti, terminé, voyageur seul, conflit horaire, titre à
rallonge — tous déjà construits en tête de fichier.

Dans `faire`, `t.verifier(quoi, ok, detail)` tranche, `t.friction(...)` observe,
`t.injouable(...)` déclare que le chemin n'existe pas. Le jeu de données est
`scripts/ui-fixture.mjs`, partagé avec `/verif-ui` pour que deux mesures faites
à deux semaines d'écart restent comparables.

Vérifier systématiquement **ce qui est enregistré** (`t.voyage()`), pas seulement
ce qui s'affiche.

## Après

Consigner dans `.claude/project-notes.md` ce qui a été corrigé et ce qui a été
sciemment laissé. Si un bug révèle une faute de méthode répétable, passer par
`/lecon`.
