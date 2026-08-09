# Playbook UX/UI — mémoire partagée entre projets

**Ce fichier est identique dans tous mes projets.** Il accumule ce que
l'utilisateur m'a appris, généralisé pour s'appliquer à n'importe quelle
application — Provo (voyage), JobWatch (recherche d'emploi) ou une future.

- **Alimenté par** `/lecon` : après chaque retour, on en extrait la règle
  durable et on l'ajoute ici.
- **Consommé par** `/audit` : audite le projet courant contre ces règles et
  propose des améliorations classées.

Chaque règle cite l'incident qui l'a produite. C'est volontaire : une règle sans
son origine devient un conseil creux qu'on applique de travers.

> **Portabilité.** Pour l'ajouter à un projet : copier tout le dossier
> `.claude/` (playbook + compétences), puis vider `project-notes.md` et le
> remplir pour le nouveau projet. Quand `/lecon` ajoute une règle ici, la
> reporter dans les autres dépôts — la compétence le rappelle.
>
> **Se remettre à jour depuis la source, en une commande.** Provo est le dépôt
> de référence et il est public : depuis n'importe quel autre projet,
>
> ```bash
> curl -fsSL -o .claude/ux-playbook.md \
>   https://raw.githubusercontent.com/bensmainethomaspro-commits/Provo/main/.claude/ux-playbook.md
> ```
>
> Le fichier n'a aucune dépendance au projet : il s'écrase sans rien perdre.
> Seul `project-notes.md`, lui, est propre à chaque dépôt — ne jamais le
> recopier.

---

## A · Densité et hiérarchie

**A1. Cinq onglets maximum dans la barre du bas.** Le reste va dans un menu `⋯`.
Un onglet rarement ouvert vole de la place à ceux qu'on ouvre tout le temps.
*Origine : la barre était passée à 7 onglets, deux devenaient illisibles et
défilaient hors écran.*

**A2. Fusionner les actions rarement utilisées.** Un bouton visible en
permanence doit servir à presque chaque session. Sinon : menu `⋯`, ou supprimé.
*Origine : « quand on peut fusionner des boutons qui ne sont pas souvent amenés
à être utilisés, il faut le faire ». Quatre entrées de menu jamais utilisées ont
été retirées — avec 129 lignes de code mort.*

**A3. Replié par défaut.** Une carte montre l'essentiel (l'identité de l'objet
et l'information qui décide) ; le reste se déroule au tap.
*Origine : « on doit pouvoir cliquer sur les activités et les infos se
déroulent, pas besoin de tout afficher directement ».*

**A4. Le chiffre qui répond à la question de l'écran est le plus gros
élément.** Les autres tailles restent proportionnelles à lui.
*Origine : « les chiffres doivent être plus gros en restant proportionnel ».*

**A5. Le contenu principal occupe l'espace libre.** Ce qui rétrécit en premier,
c'est le chrome : titres, dates, métadonnées, compteurs.
*Origine : « il y a trop d'espace entre les jours et les dates du voyage, il
faut que les jours soient plus grands » — puis la suppression pure et simple des
dates de l'en-tête.*

**A6. Ne pas dupliquer un contenu entre deux écrans.** Si un bloc reprend ce
qu'un onglet montre déjà, il encombre.
*Origine : le bloc « Réserve d'idées » du Planning doublonnait l'onglet
Réserve.*

**A7. Une fonctionnalité nouvelle est portée par un élément qui existe déjà.**
Avant de créer un bouton, une bannière ou un champ, chercher à l'écran ce qui
peut recevoir l'action : une adresse affichée devient le lien vers l'itinéraire,
un compteur devient le bouton qui lance le calcul. On ne crée un élément que si
aucun ne convient — et on annonce alors ce qu'on retire en échange. **Le solde
d'éléments visibles ne doit pas monter à chaque livraison.**
*Origine : « souvent tu ajoutes toutes les fonctionnalités, mais juste pour
qu'elles y soient. À chaque ajout ou modification, il faut penser UX/UI pour que
cela s'inclue bien dans ce qui est déjà en place ». Cinquième retour consécutif
sur la densité.*

**A8. Une capacité indisponible ne se déguise pas en contrôle.** Pas
d'interrupteur grisé, pas de bouton inerte : à sa place, la raison et le geste
qui débloque. Un contrôle qui ne réagit pas se lit comme une panne, et on perd
du temps à chercher ce qu'on fait de travers.
*Origine : « je ne peux pas cocher comme si le bouton n'en était pas ». Un
interrupteur de notifications était affiché désactivé là où le système ne les
permet pas — avec l'explication en petit dessous, que personne ne lit avant
d'avoir essayé de cliquer.*

---

## B · Visibilité et alignement

**B1. Vérifier le contraste de chaque élément interactif sur son fond réel,
dans les deux thèmes.** Un jeton de couleur juste dans l'absolu peut être
invisible sur le fond où il atterrit.
*Origine : « il y a des boutons qui ne se voient pas » — un badge horaire en
couleur d'accent posé sur un fond de la même couleur d'accent.*

**B2. Une seule grille d'alignement par écran.** Une rangée de contrôles est un
conteneur unique avec des espaceurs explicites, pas des éléments posés côte à
côte au jugé.
*Origine : « la position des boutons n'est pas symétrique, ni parallèle et
ordonnée, cela fait brouillon ».*

**B3. Les cartes doivent se détacher du fond dans les deux thèmes, par des
moyens opposés.** Sombre : contour clair + fond légèrement plus clair. Clair :
ombre douce + fond plus blanc que la page.
*Origine : « un peu plus de contraste concernant les jours » en sombre, puis
« le même genre de contraste pour le mode clair mais dans l'autre sens ».*

**B4. En mode clair, la couleur de marque est un accent, pas un mur.** Fond
neutre clair, couleur réservée aux éléments actifs.
*Origine : « saut quantique sur les couleurs de la vue claire qui sont trop
agressives », avec Apple / App Store comme référence.*

**B5. Un jeton de couleur peut être redéfini plus bas dans la feuille.** Après
un changement de palette, balayer le CSS à la recherche des anciennes teintes
en dur et des redéfinitions du même jeton.
*Origine : une seconde déclaration `--orange` dans un calque inférieur écrasait
silencieusement la nouvelle palette ; la moitié de l'interface restait orange.*

---

## C · Charge mentale

**C1. L'app calcule, l'utilisateur lit une phrase.** Donner la conclusion en
langage naturel, pas les données brutes à interpréter.
*Origine : « Sam → 60 € → Alex » ne disait pas qui devait à qui. Devenu « Sam
doit 60 € à Alex ».*

**C2. Ne jamais forcer à passer par un objet sans rapport.** Chaque tâche doit
avoir un chemin direct.
*Origine : ajouter le prix d'un hôtel obligeait à créer une fausse activité.*

**C3. Compléter automatiquement ce qui est trouvable publiquement.** Ne demander
que ce que l'app ne peut pas trouver.
*Origine : « il faut que toutes les informations soient présentes même si je ne
les ai pas mises, il faudra rechercher sur internet ».*

**C4. Se placer du point de vue du compte connecté.** Un écran partagé doit
répondre « et moi, où j'en suis ? », pas seulement afficher l'état global.
*Origine : « ok pour qui suis-je, mais attention à ce que cela s'adapte pour
chaque participant connecté ».*

**C5. Un geste, pas un formulaire, pour ce qui se fait souvent et vite.**
*Origine : les dépenses se notent sur le moment ; un formulaire complet à chaque
fois est un abandon garanti.*

---

## D · Initiative de l'application

**D1. Proposer, ne jamais agir d'office.** Une suggestion s'affiche en pop-up,
se refuse d'un tap, ne bloque rien et ne réorganise rien toute seule.
*Origine : « ok pour itinéraire optimisé, mais seulement le proposer comme un
pop-up » ; puis « l'app doit être force de suggestion seulement en popup ».*

**D2. Chiffrer le bénéfice dans la proposition.** « Tu économises 1,8 km »
plutôt que « veux-tu optimiser ? ». Sans chiffre, on ne peut pas décider.

**D3. Ne rien proposer quand il n'y a rien à signaler.** Une pop-up qui apparaît
toujours devient un clic réflexe et perd tout son sens.

**D4. Toute action destructive ou réorganisante est annulable.** Une mécanique
unique — instantané avant l'action, restauration au tap — vaut mieux que dix
confirmations.
*Origine : seule la suppression était annulable ; les déplacements, balayages et
réorganisations ne l'étaient pas.*

**D5. Confirmer qu'une action a eu lieu.** Une barre qui disparaît sans mot ne
dit pas si l'annulation a marché.

---

## E · Méthode de travail

**E1. Vérifier au rendu, jamais au raisonnement.** Capture d'écran réelle, les
deux thèmes, sur le plus petit écran cible, avant de dire que c'est fait.

**E2. Quand un correctif ne marche pas, mesurer au lieu de re-deviner.**
Interroger le DOM : positions réelles, `elementFromPoint`, dimensions calculées.
**Corollaire : si l'environnement de travail ne peut pas atteindre ce qu'il faut
mesurer, en fabriquer un qui le peut** — un exécuteur d'intégration continue, un
script déployé — plutôt que de raisonner à l'aveugle. Et ne jamais imputer un
échec à une cause externe supposée sans l'avoir vérifiée.
*Origines : (1) un bouton inatteignable a résisté à un premier correctif
« logique » ; la mesure a révélé une superposition de 784 px dans un écran de
667 px, causée par un ancêtre transformé qui redéfinissait le référentiel du
`position: fixed` — deux autres composants avaient le même défaut. (2) un lien
partagé « toujours pas extrait » après deux correctifs annoncés sans mesure : le
bac à sable ne joignait ni le service de liens ni le serveur de fonctions, et
j'avais accusé un déploiement supposé non passé. Mesuré depuis un exécuteur
d'intégration continue, tout ce que j'accusais marchait déjà — la cause était
ailleurs.*

**E3. Tester le geste réel, pas seulement l'état final.** Vérifier que le
déplacement est enregistré ne dit pas qu'il est atteignable au doigt.
*Origine : la cible de dépôt du jour voisin mesurait 6 px de large sur un écran
de 390 px. Le code « marchait ».*

**E4. Un test qui échoue n'est pas toujours un bug produit.** Distinguer le
défaut réel du sélecteur mal choisi avant de modifier le code.

**E5. Chercher la cause en amont d'un symptôme qui revient.** Deux correctifs
successifs qui ne tiennent pas = mauvaise cause.

**E6. Un contrôle automatisé doit prouver qu'il est arrivé sur l'écran qu'il
prétend mesurer.** Chaque étape affirme un repère qui n'existe que là. Sans
cette assertion, un sélecteur périmé fait remesurer l'écran précédent sous un
autre nom : tout passe au vert, et la couverture annoncée est fausse.
*Origine : un parcours « Fiche activité » cherchait une classe absente de
l'écran depuis une refonte. Il ne cliquait sur rien, mesurait l'écran d'avant,
et n'a jamais rien signalé — pendant que la vraie fiche accumulait trois cibles
sous 44 px et l'écran voisin sept autres. Corollaire : une sonde neuve se
prouve contre le code d'avant. Si elle ne rougit pas là où le défaut existait,
elle ne mesure rien.*

**E8. Un calque plein écran se pose sur le document, pas dans le composant qui
l'ouvre.** `position: fixed` cesse de viser l'écran dès qu'un ancêtre établit un
bloc conteneur — et aucune des propriétés qui le font ne ressemble à du
positionnement : `transform` (même `translateX(0)`), `filter`,
`backdrop-filter`, `perspective`, `contain`, `will-change`, et
`content-visibility: auto`. Un menu, une modale, une lightbox passent par un
portail vers `body`.
*Origine : le menu ⋯ d'une activité mesurait 358 × 174 px au lieu de
390 × 844, enfermé par la carte qui portait `content-visibility: auto` — posée
pour la fluidité d'une longue liste. L'`overflow: hidden` de la carte découpait
le reste, si bien que « Modifier » n'était dessiné nulle part : plus personne
ne pouvait modifier une activité. Troisième fois que ce piège frappe (voir
aussi E2), et la seule des trois qu'un commentaire du code annonçait déjà
comme réglée — « rendered outside overflow:hidden container » — alors qu'elle
ne l'était pas.*

**E7. Une échelle qu'on ne peut pas réciter n'est pas une échelle.** Tailles de
texte, graisses, rayons, espacements : chaque famille tient en une poignée de
valeurs nommées, déclarées une seule fois. Au-delà, ce n'est plus une
hiérarchie, c'est du désordre — et c'est ce qui fait dire « ça fait brouillon »
sans que personne sache désigner quoi.
*Origine : 32 tailles, 9 graisses et 23 rayons coexistaient, avec des valeurs
comme 9,75 px ou 12,5 px qui sont des résultats de multiplication et non des
décisions. Jusqu'à 31 couples taille/graisse sur un seul écran. Les jetons de
rayon étaient en plus redéclarés quatre fois — le thème sombre arrondissait
tout davantage que le clair, sans que personne l'ait voulu (voir B5).*

---

## F · Livraison

**F1. PWA : HTML et service worker sans cache, assets hachés immuables.** Sinon
le réseau de diffusion sert une version périmée et le bouton « rafraîchir » ne
rafraîchit rien.
*Origine : « chaque fois que je rafraîchisse, ce soit mis à jour, sinon je dois
recréer un lien sur l'écran d'accueil à chaque fois ».*

**F2. Vérifier depuis là où ce sera consommé, pas depuis là où on l'a produit.**
« Poussé » n'est pas « livré ». Ouvrir le lien sans être connecté ; lire le
fichier depuis le dépôt tel qu'un autre le verra ; installer ce qu'on vient de
publier. **Corollaire :** ce qui est destiné à être partagé entre projets vit
sur la **branche par défaut** — une branche de travail ou une PR en brouillon
n'existe pour personne d'autre.
*Origines : (1) « quand je lui donne ce lien il doit se connecter à Vercel, je
ne veux pas » ; (2) une mémoire écrite pour tous les projets, laissée sur une
branche non fusionnée — une autre session n'a rien trouvé et a dû demander où
chercher.*

**F3. Aucune API payante, ni compte de facturation, sans accord explicite.**
Vérifier aussi les conditions d'utilisation, pas seulement le prix.
*Origine : Google Places écarté — carte bancaire obligatoire depuis mars 2025,
et CGU interdisant d'afficher ces données sur une carte non-Google.*

**F4. Dire ce qui n'a pas pu être vérifié.** Une limite annoncée vaut mieux
qu'une confiance démentie à l'usage. Ne jamais présenter comme corrigé ce qui
n'a pas été mesuré : une hypothèse s'annonce comme une hypothèse.

---

## Journal analytique

Trace brute → règle générale. Sert à repérer les récidives : un thème qui
revient trois fois est un problème structurel, pas un détail.

| Date | Retour (verbatim abrégé) | Généralisé en |
|---|---|---|
| 2026-07 | « beaucoup de boutons un peu partout, pas très UX » | A1, A2 |
| 2026-07 | « il y a des boutons qui ne se voient pas » | B1 |
| 2026-07 | « pas symétrique ni parallèle, cela fait brouillon » | B2 |
| 2026-07 | « les couleurs de la vue claire sont trop agressives » | B4 |
| 2026-07 | « trop d'informations et de boutons partout » | A3, A4 |
| 2026-07 | « j'ai dû créer une activité, ce que je ne veux pas faire » | C2 |
| 2026-07 | « ce que chacun doit à chacun, c'est pas clair » | C1 |
| 2026-07 | « seulement le proposer comme un pop-up » | D1, D3 |
| 2026-07 | « toutes les informations présentes même si je ne les ai pas mises » | C3 |
| 2026-07 | « toujours un bug sur la roue, le bouton est sous un autre » (2ᵉ fois) | E2, E5 |
| 2026-07 | « il faut que ce soit mis à jour quand je rafraîchis » | F1 |
| 2026-07 | « il doit se connecter à Vercel, je ne veux pas » | F2 |
| 2026-07 | « je ne veux rien dépenser » | F3 |
| 2026-07 | mémoire partagée introuvable depuis un autre projet | F2 (affinée) |
| 2026-07 | « ça ne fonctionne toujours pas […] une solution dont tu es sûre ! » (3ᵉ fois) | E2 (affinée), F4 |
| 2026-08 | « tu ajoutes toutes les fonctionnalités, juste pour qu'elles y soient » (5ᵉ sur la densité) | A7 |
| 2026-08 | « je ne peux pas cocher comme si le bouton n'en était pas » | A8 |
| 2026-08 | un parcours de vérification qui ne cliquait sur rien passait au vert | E6 |
| 2026-08 | « fluidifier et améliorer l'UX/UI », pas « aller plus vite » | E7 |
| 2026-08 | « on ne peut plus modifier les activités » + « c'est une question d'ordre de calque » | E8 |

### Récidives repérées

- **Densité de l'interface** : signalée **5 fois** (boutons partout → haut de
  l'écran → fusionner → trop d'informations → « ajoutées juste pour qu'elles y
  soient »). C'est le thème le plus récurrent du playbook. Les quatre premiers
  retours demandaient de *retirer* ; le cinquième dit d'où vient le problème :
  chaque fonctionnalité est arrivée **à côté** de l'existant au lieu d'être
  **fondue dedans**. → A7 s'applique au moment de concevoir, A1–A6 au moment de
  nettoyer. Si A7 est tenue, les autres n'ont plus grand-chose à faire.
- **Un correctif superficiel a été livré trois fois** avant la vraie cause (roue,
  dépôt sur la timeline, puis extraction d'un lien partagé). C'est le thème le
  plus coûteux du playbook : à chaque fois l'utilisateur a dû revenir dire « ça
  ne marche toujours pas », et à chaque fois la mesure a désigné une cause que
  le raisonnement n'avait pas envisagée. → **ne rien annoncer comme corrigé sans
  une mesure** ; quand l'environnement empêche de mesurer, c'est l'environnement
  qu'il faut changer, pas la mesure qu'il faut sauter (E2, F4).
- **Un écran qu'aucun outil n'ouvre accumule des défauts invisibles** : deux
  fois en une semaine (formulaire de dépense, puis jour ouvert et fiche
  d'activité). À chaque fois la sonde annonçait « rien à signaler » sur un
  écran qu'elle ne regardait pas — et la troisième fois, sur un écran qu'elle
  croyait regarder. → E6, et vérifier qu'un écran exerce chaque sonde avant de
  l'ajouter.
- **Un `position: fixed` enfermé par un ancêtre** : trois fois — la roue,
  la barre d'onglets sur les dépôts, puis le menu ⋯ d'une activité. À chaque
  fois le calque semblait correct dans le code et se dessinait au mauvais
  endroit ; à chaque fois la cause était une propriété sans rapport apparent
  avec le positionnement, sur un ancêtre lointain. → E8, et le portail plutôt
  que l'espoir.
- **« Poussé » confondu avec « livré »** : trois fois — cache Vercel qui servait
  une version périmée, preview inaccessible sans compte, mémoire partagée
  laissée sur une branche. À chaque fois le travail était fait *et* hors de
  portée de son destinataire. → vérifier depuis le poste du destinataire fait
  partie de la livraison, pas de l'après (F2).
