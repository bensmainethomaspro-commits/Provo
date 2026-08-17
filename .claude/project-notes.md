# Notes projet — Provo

**Propre à ce dépôt.** Contrairement à `ux-playbook.md`, ce fichier ne se copie
pas d'un projet à l'autre : il est vidé et réécrit dans chaque nouveau projet.

Sert à `/audit` pour ne pas reproposer ce qui est déjà fait, et pour garder la
trace de ce qu'on a sciemment écarté.

---

## Contexte

- PWA de planification de voyage, en français, mobile d'abord (max 480 px).
- React + Vite, Supabase, hors ligne, déployé sur Vercel.
- Écran de référence pour les vérifications : **390 × 844** (et 375 × 667 pour
  le cas le plus défavorable).
- Le principe produit directeur est dans `CLAUDE.md` à la racine.

## Règles du playbook déjà appliquées

| Règle | Où |
|---|---|
| A1 · 5 onglets max | Barre du bas ; Notes et Valise dans le menu `⋯` |
| A2 · Fusionner le rare | Menu `⋯` ; 4 entrées inutilisées supprimées |
| A3 · Replié par défaut | `TlActivity` : heure + titre, détail au tap |
| A4 · Chiffre principal | Budget, soldes, compte à rebours ; titre d'activité > date du jour |
| A5 · Contenu qui remplit | Dates d'en-tête retirées ; la carte de jour prend la hauteur de son contenu |
| A6 · Pas de doublon | Bloc « Réserve d'idées » retiré du Planning |
| B1 · Contraste réel | Badge horaire corrigé (accent sur accent) |
| B2 · Grille unique | `.trip-controls` : une rangée, espaceurs explicites |
| B3 · Cartes détachées | Contraste inversé entre thème clair et sombre |
| B4 · Accent, pas mur | Palette bleu clair `--accent: #35A7DD` |
| C1 · Phrase, pas données | « Sam doit 60 € à Alex » ; « la journée finirait à 23:30 » |
| C2 · Chemin direct | Dépense sans activité associée |
| C3 · Complétion auto | `enrich.js` ; jours fériés (Nager.Date) ; lecture de ticket |
| C4 · Point de vue connecté | Solde personnel via `profileId` |
| D1 · Proposer en pop-up | Piochage, itinéraire ; `PropositionSheet` (fermé, férié, déborde, loin) |
| D2 · Bénéfice chiffré | « tu économises 1,8 km » |
| D3 · Rien à signaler | Aucune pop-up si le piochage ne pose pas de problème |
| D4 · Annulable | `withUndo` dans `TripView` |
| D5 · Confirmer | « ↩ Action annulée » |
| E2 · Mesurer, pas deviner | `.github/workflows/diagnose-link.yml` |
| E6 · Prouver qu'on est arrivé | Champ `repere` de chaque écran dans `verif-ui.mjs` |
| E7 · Une échelle récitable | `--t-xs…--t-3xl`, 3 graisses, `--radius-xs…lg` + `pill` |
| F1 · Cache PWA | `vercel.json` |

## Détection de lieux — ce qui a été mesuré

Bancs dans `scripts/diag-*.mjs`, lancés par
`.github/workflows/diagnose-places.yml`. Ne pas refaire ces mesures sans raison.

| Question | Réponse mesurée |
|---|---|
| Nominatim est-il le maillon faible ? | **Non** — 24 lieux trouvés sur 27 (Photon : 25/27) |
| Comment remplir une fiche depuis un lien Maps ? | **Nom + ville déduite des coordonnées** (64 pts) ≫ nom seul (57) ≫ géocodage inverse (28) |
| Chercher le nom sans ville ? | **Dangereux** — « Da Enzo al 29 » ramène une rue au Brésil |
| Overpass par nom en repli ? | **Écarté** — 504 sur deux requêtes sur trois, 9 s de latence |
| Une page `share.google` porte-t-elle des coordonnées ? | **Non** — ni `@lat,lon`, ni JSON-LD, ni adresse. Le paramètre `q=` est le seul signal |
| TikTok depuis un serveur ? | **Captcha** sur le HTML ; seul l'oEmbed répond |
| Instagram depuis un serveur ? | **Fermé** — page sans balises `og:`, oEmbed 404/400 sans jeton Facebook, proxys 403/521. Abandonné sciemment |

Conséquence tenue dans le code : les coordonnées d'un lien servent à *situer et
vérifier* une recherche par nom, jamais à interroger la carte à l'aveugle.

**Limite assumée :** un lieu absent d'OpenStreetMap ne sera jamais complété
(vérifié sur « Agapii Mou », Athènes). L'app garde le titre et le lien, et le
dit franchement plutôt que de laisser croire à une panne.

### Lecture des légendes par un modèle

Aucune règle ne transforme « Perfect restaurant for Gen-Zs » en nom de lieu ;
un modèle, si.

> **Correction (9 août 2026).** Cette section disait « inspiré de Punkt AI, qui
> fait lire la vidéo par une IA ». C'est une lecture fausse de ce qui fait
> marcher Punkt, et elle a coûté une journée : elle a fait chercher un meilleur
> modèle côté serveur, là où le problème n'est pas.
> Précisé par l'utilisateur : Punkt est une **application installée**, et on lui
> envoie le post par le menu *Partager*. Son avantage n'est pas l'IA — c'est que
> sa requête part du téléphone de la personne, à qui TikTok sert la vraie page.
> Le modèle ne fait que lire la légende **une fois qu'on l'a obtenue**. Voir
> « TikTok : c'est le téléphone qui lit la page » plus bas, et E10 du playbook.

`classifyWithLLM` s'active dès que le secret **`ANTHROPIC_API_KEY`** est posé
dans Supabase › Edge Functions › Secrets. Trois garde-fous, parce que la clé
est payante et que la clé publique Supabase est lisible dans le bundle :

1. Seules les origines de l'app déclenchent l'appel (`origineAutorisee`).
   **Ce garde-fou vit dans `supabase/functions/_shared/origine.ts`, importé par
   les quatre fonctions.** Écrit une seule fois dans `extract-place`, il n'avait
   pas suivi les trois ajoutées ensuite — `read-booking`, `read-receipt` et
   `enrich-place` appelaient toutes le modèle payant sans aucun contrôle. Toute
   nouvelle fonction qui dépense l'importe. Le dossier `_shared` n'a pas
   d'`index.ts` : la boucle de déploiement l'ignore comme fonction, et le CLI
   l'embarque dans chaque paquet qui l'importe.
   Ce que ce contrôle **ne** fait pas : l'en-tête `Origin` n'est imposé que par
   les navigateurs. Il ferme l'abus depuis un autre site — le vecteur réaliste
   d'une dépense massive — pas l'appel forgé en ligne de commande.
2. Le modèle n'est appelé que si les règles ont échoué — une légende contenant
   déjà « 📍 Bouillon Chartier, Paris » se lit sans lui.
3. Sa réponse repasse par le géocodeur, qui refuse ce qui ne correspond à rien,
   et une réponse marquée `confiance: "basse"` ne peut ni nommer ni situer.

Modèle : `claude-haiku-4-5-20251001`, environ 0,001 € par lien.

## Décisions récentes

- **Le formulaire de dépense EST celui de Tricount** (17 août 2026). Demandé
  mot pour mot, capture à l'appui : « fais exactement la même interface que
  Tricount pour l'ajout des dépenses, avec toutes les fonctionnalités que cela
  implique comme par exemple les calculs dès l'ajout de la dépense ». Ce qui
  renverse le « écarté » de l'entrée suivante : le sélecteur à quatre modes,
  jugé trop lourd deux jours plus tôt, est maintenant explicitement demandé.
  Une préférence produit énoncée par moi ne survit pas à une demande directe.

  Ce que le formulaire fait désormais :
  · en-tête `Annuler · titre`, et trois segments `Dépense · Revenu · Transfert` ;
  · titre AVANT montant (la tâche #34 avait choisi l'inverse — assumé, c'est ce
    que fait Tricount et c'est ce qui est demandé) ;
  · le choix d'icône EST le choix de catégorie : une seule décision, une seule
    commande ;
  · la date devient saisissable — le champ existait dans les données depuis
    toujours, aucun écran ne le proposait ;
  · `Payé par` (`Reçu par` pour un revenu, `De` pour un transfert) et `Quand`
    côte à côte ;
  · quatre modes de partage, et **les euros de chacun s'affichent PENDANT la
    saisie** — c'est le « calcul dès l'ajout » demandé ;
  · ce qui ne tombe pas juste se dit avant d'enregistrer (« Il reste 20 € à
    répartir ») et refuse la validation, au lieu de se découvrir dans les
    dettes à la fin du voyage.

  Trois choix de structure, pris pour que le tout tienne à l'écran :
  1. **Le bouton de validation est collant** (`position: sticky`), pas
     simplement suivi de creux. C'est la troisième fois que ce bouton repasse
     sous la barre d'onglets (#33, puis les parts inégales, puis ici) : chaque
     correctif par le creux ne tenait que jusqu'au champ suivant. Collant, la
     question ne se repose plus. `bottom: 4px` et non 108 : les décalages d'un
     élément collant se comptent depuis la boîte de CONTENU du conteneur
     défilant, et `.tab-content` réserve déjà 104 px.
  2. **La palette d'icônes se pose par-dessus le formulaire**, elle ne l'écarte
     pas. Dépliée dans le flux elle ajoutait 250 px, et le bouton collant se
     retrouvait au milieu de la liste des personnes. Un choix d'icône ne doit
     pas déplacer le montant qu'on vient de taper.
  3. **Le formulaire ouvert passe en TÊTE de l'onglet.** Il était rendu après
     la liste : en remontant, on voyait le bouton collant flotter au-dessus de
     l'en-tête du formulaire, borné par sa boîte. Un élément collant ne peut
     pas sortir de son parent — si le parent commence sous l'écran, le bouton
     se colle en haut de ce parent, pas en bas de l'écran.

  Le formulaire a maigri de 69 px (interlignes, intitulés, rembourrage des
  champs, intitulé du dernier champ fondu dans sa liste) : le cas courant —
  deux voyageurs, parts égales — tient entièrement à l'écran, bouton compris,
  sans avoir à défiler pour valider. Mesuré : 627 px de formulaire pour 639 px
  disponibles. `/verif-ui` est vert sur les trois écrans du formulaire, dans
  les deux thèmes, y compris les trois cibles sous 44 px signalées « non
  traitées » l'avant-veille : les pastilles de catégorie ont disparu avec le
  pli « Détails ».

- **Un seul dessin de fiche, et la Réserve s'ouvre sur des idées** (17 août
  2026, tâches #39 et #44). Deux dettes anciennes, sur l'écran qui EST le
  produit. Tout est mesuré sur le même voyage de référence, écran de 844 px.

  **La fiche.** Trois dessins cohabitaient : frise 278×32, jour 358×66,
  Réserve 358×**174**. Les 108 px d'écart tenaient dans deux rangées à moitié
  vides que la Réserve empilait autour de la fiche commune — la ligne d'état
  (« Ouvert · 1,2 km · 2 infos à compléter ») au-dessus, le bouton
  « Assigner » en dessous, avec 250 px de vide à sa gauche. Elles rentrent
  toutes les deux dans la fiche, par deux fentes ouvertes dans `ActivityCard` :
  · `etat` se range dans la ligne de méta, avec durée, prix et adresse — une
    seule ligne de faits, comme sur la fiche d'un jour ;
  · `action` se range dans la rangée du haut, à côté du ⋯ : cette rangée fait
    déjà 52 px de haut à cause de la vignette, le bouton n'y coûte rien.
  Résultat : **174 → 118 px**, soit la fiche d'un jour plus sa vignette. Le
  choix du jour passe par un calque — la fiche porte `content-visibility:
  auto`, qui découpe tout ce qu'on dessine dedans (quatrième fois que ce piège
  frappe ici).
  Le bouton d'assignation porte un **＋ typographique et pas un émoji de
  calendrier** : tous en portent un quantième, et une fiche pas encore assignée
  qui affiche « 17 » se lit comme une fiche déjà posée.

  **L'écran.** 182 px de commandes avant la première idée : un champ de
  recherche pleine largeur, puis une rangée tri + filtres, puis une bande de
  dépôt invisible de 18 px. Deux idées visibles. Maintenant **114 px** et
  quatre idées, par trois gestes :
  · la recherche se replie derrière son 🔍 et reprend toute la largeur quand on
    la demande (règle A5 : ce qui rétrécit en premier, c'est le chrome) ;
  · « coller », « ouvert », « grouper » et le tri tiennent sur la même ligne ;
    « Tout (8) » ne sert qu'à revenir, il est muet tant qu'on n'est parti
    nulle part ;
  · la zone de dépôt, c'est la liste elle-même.

  **Deux pièges rencontrés, à ne pas refaire.**
  1. J'ai donné la classe `reserve-filter__pill` au bouton « Chercher une
     idée ». Le parcours qui filtre par catégorie vise
     `.reserve-filter__pill[aria-label*="idée"]` — il a cliqué sur la
     recherche. Une commande n'est pas un filtre : `.reserve-cmd` porte le même
     dessin sans le même sens.
  2. Les pastilles de catégorie avaient rejoint la rangée des commandes. À cinq
     contrôles devant elles, il fallait faire défiler la rangée pour en
     atteindre une — et le défilement décalait la cible sous le doigt. Elles
     ont retrouvé leur propre rangée, qui n'existe qu'en vue liste.

  **Ce que les deux nouveaux écrans de `/verif-ui` ont trouvé aussitôt** (règle
  E6 : une sonde ne trouve que sur les écrans qu'on lui montre) : « J1 » à
  « J6 » du choix de jour à 2,6:1, et la poignée de réordonnancement à 22 px de
  large — alors que la tâche #21 avait posé 44 px comme règle. Les deux
  préexistaient et n'avaient jamais été mesurés. Pour la poignée, le
  pseudo-élément qui étend les autres cibles ne peut rien : elle est collée au
  bord gauche d'une fiche qui découpe ce qui dépasse. Elle s'élargit donc pour
  de bon, et la gouttière avec elle.

- **Parts inégales, à la manière de Provo** (août 2026) — ⚠️ **en partie
  dépassé par l'entrée ci-dessus** : le pli « Détails » et les pastilles
  `Thomas ×2` n'existent plus, remplacés par le sélecteur de mode et les
  colonnes de valeurs. Ce qui reste vrai et ne doit pas être défait : la règle
  de partage vit dans `helpers.js` seule, et une dépense n'est stockée qu'en
  PARTS. Demandé : « inspire-toi de Tricount ». Provo avait déjà le règlement minimal, les soldes, le
  multi-devise, la lecture de ticket et les catégories ; ce qui manquait, c'est
  que le partage était TOUJOURS égal. Une chambre partagée, un menu que
  quelqu'un n'a pas pris, un billet gratuit : le seul contournement était de
  couper la dépense en deux — c'est-à-dire de faire le calcul soi-même, ce que
  le principe produit interdit explicitement.
  Écarté : la façon de faire de Tricount, un sélecteur à quatre modes (égal /
  parts / montants / pourcentages) sur son propre écran. Trop lourd ici, et il
  fait payer au cas courant une exception que peu utilisent.
  Retenu : le cas courant ne bouge pas d'un pixel — un tap sur la pastille, et
  parts égales. Le réglage n'apparaît qu'à partir de deux personnes, replié,
  DANS le pli « Détails » qui existait déjà. La part se lit sur la pastille de
  la personne (`Thomas ×2`) : il n'y a pas d'autre endroit où l'on cherche
  « combien compte Thomas ». Et chaque ligne montre le résultat EN EUROS —
  c'est lui qu'on vérifie, pas le nombre de parts.
  **La règle de partage vit dans `helpers.js` seule** (`partEnEuros`) : elle
  était écrite trois fois — dettes, soldes, feuille par voyageur — et trois
  copies d'un calcul d'argent finissent par ne plus dire la même chose.
  Compatible en arrière : sans `parts`, ou à parts toutes égales, le calcul est
  exactement l'ancien. Une part absente, nulle ou aberrante vaut 1 — dans un
  carnet de comptes, un partage égal vaut mieux qu'une division par zéro.
  Deux défauts trouvés par `/verif-ui`, que l'œil avait laissés passer :
  `--green` en texte donnait 1,97:1 en thème clair (le jeton `--green-texte`
  existait déjà), et le formulaire rallongé faisait repasser « ✅ Ajouter » sous
  la barre d'onglets — le bug de la tâche #33, revenu parce que son correctif
  reposait sur la position de défilement et ne tenait que tant que le
  formulaire tenait à l'écran. La marge est désormais sur le CONTENEUR :
  mesuré, le bouton dégage la barre de 155 px une fois défilé.
  L'écran « Dépense (parts) » entre dans `/verif-ui` : replié, la moitié des
  contrôles du formulaire échappait à la mesure.
  **Non traité, signalé** : ce même écran révèle trois cibles sous 44 px qui
  préexistaient (pastilles de catégorie à 25 px, « Tout décocher » à 12 px) —
  les agrandir change la densité de tout le formulaire, c'est une décision de
  conception à part.


- **TikTok : un lecteur tiers rend la page, et la légende est dans le texte
  alternatif des images** (9 août 2026). **La conclusion qui tient, et elle
  remplace les deux précédentes.** Coller un lien remplit de nouveau la fiche —
  sur iPhone, sans raccourci ni application installée, et sans rien payer.
  Un service de lecture va chercher la page depuis SON infrastructure, que
  TikTok ne traite pas en centre de données : là où notre serveur reçoit un
  captcha, lui reçoit la page et nous la rend rendue. La légende n'y est pas en
  clair — elle est dans le texte alternatif des images :
  `![Image 1: 835 Likes, 6 Comments. image posted by () on : “📍DEOUN | …”](…)`.
  Mesuré sur la fonction déployée : titre « DEOUN », échelon `lecteur-tiers`,
  adresse « Rue Harispe, Biarritz ». En prime, les images rendues sont les
  vraies photos du post, sans l'incrustation du bouton ▶ — elles remplacent
  donc la vignette de partage, même venant d'un échelon plus bas.
  **Deux pièges, refermés et commentés dans le code :** lui demander le HTML
  brut (`x-return-format: html`) ramène le captcha — c'est le RENDU qui passe,
  pas la récupération ; et il **refuse les navigateurs** (403 en 14 ms sur un
  agent Safari, 200 sans agent). Le canari s'était déguisé en iPhone et avait
  déclaré ROUGE une chaîne qui marchait.
  **Nommer et situer sont séparés** : `extractLocationHint` dit comment ça
  s'appelle, `extractGeoHint` dit où c'est (adresse écrite d'abord, puis
  l'épingle complète avec sa ville). Une seule fonction pour les deux avait
  nommé « DEOUN » et situé la fiche à 30 km.
  L'agent chercheur reste derrière, pour les posts sans légende — sur le modèle
  bon marché, trois recherches au plus, 25 s : un recours devenu rare ne
  justifie plus le modèle le plus cher.
  `scripts/verif-legende-alt.mjs` passe les mêmes cas dans les **deux**
  exemplaires de la lecture — celui de l'app, celui du canari : si l'une est
  corrigée sans l'autre, il casse.

- **TikTok : c'est le téléphone qui lit la page, pas le serveur** (août 2026).
  ⚠️ **Dépassé par l'entrée ci-dessus** — un serveur y arrive, via un lecteur
  tiers. Ce qui reste vrai : la voie native existe et fonctionne. Ce qui est
  faux : « seul un téléphone tranche ».
  La conclusion de la journée, et elle invalide la précédente. Tout ce qui a été
  mesuré depuis un exécuteur — oEmbed 400, captcha sur la page complète,
  vignette de couverture illisible, URL signée refusant toute variante (403 sur
  `sans-bouton`, `haute-def`, `gabarit-image`, `brut`) — était **exact et
  trompeur** : vrai pour un serveur, pour rien d'autre.
  L'utilisateur a signalé une application concurrente qui y arrive. Elle est
  **installée** : elle sort par sa connexion, avec un agent mobile ordinaire, et
  TikTok lui sert la page complète, légende comprise. L'écart n'est pas dans
  l'extracteur, il est dans **qui pose la question** (règle E10 du playbook).
  `src/utils/tiktokNatif.js` : `legendeTikTokNative()` passe par
  `CapacitorHttp`, non soumis aux restrictions d'origine du navigateur — un
  `fetch` échouerait. `legendeDansPage()` est séparée de la requête pour rester
  vérifiable sans téléphone. Dans un onglet, la voie n'existe pas : `null` sans
  bruit, et le collage de la légende reste le recours (iOS reste dans ce cas —
  Provo y est un site installé, pas une application native).
  Un seul `traiterLegende()` sert les deux origines.
  **Non vérifié, et ça ne peut pas l'être depuis ici** : ni le bac à sable ni un
  exécuteur ne peuvent exercer cette voie, ce sont justement les adresses à qui
  TikTok sert un captcha. Seul un téléphone tranche. Le workflow *Build Android
  APK* est **désactivé** sur le dépôt : il faut le réactiver pour produire
  l'application à tester.
  La lecture de couverture est court-circuitée sur la vignette au bouton play
  (motif `vignette_bouton_play`) : elle consommait un appel payant par import
  pour un échec certain.
  Chaque échec de lecture d'image porte désormais son motif, remonté dans la
  réponse sous `couverture`. Deux diagnostics de suite ont été perdus parce que
  la fonction rendait `null` sur sept chemins, puis parce que l'afficheur du
  diagnostic ne montrait pas le champ ajouté pour trouver la cause — d'où la
  règle : **un diagnostic montre la réponse entière, jamais une sélection**.

- **Une échelle d'échelons, et un canari qui prévient** (août 2026). Demandé
  après le premier correctif TikTok : « trouve plutôt des solutions à long
  terme […] des plans B ou plan C. Aussi je veux être prévenu dans ce genre de
  situation. » Le reproche était juste : le correctif réparait le jour même,
  sans rien changer à ce qui avait permis la panne.
  L'extraction TikTok est devenue une **liste ordonnée d'échelons
  indépendants** — `oembed`, `page-embed`, `donnees-page`, `robot-social`, puis
  la lecture de couverture, puis la légende collée. Celui qui tombe ne fait
  plus tomber les suivants, et la réponse porte `etape`, l'échelon qui a
  répondu.
  `scripts/canari-extraction.mjs` mesure ces mêmes échelons **séparément**,
  tous les jours (`.github/workflows/canari-extraction.yml`), et ouvre une
  **alerte GitHub** — une seule à la fois, refermée au retour au vert. Trois
  états : vert (de la marge), **orange (on ne tient plus que sur les échelons
  de secours)**, rouge (plus rien ne nomme le lieu). L'alarme sonne à l'orange :
  c'est le seul moment où il est encore confortable d'agir.
  Mesuré le 9 août 2026 sur un exécuteur, échelon par échelon :
  `oembed` 400 · `page-embed` rend le compte, pas la légende · `donnees-page`
  captcha depuis un centre de données · `robot-social` « TikTok | Make Your
  Day » · couverture JPEG 82 ko. Verdict : **orange**, l'app ne tient que sur
  la lecture d'image.
  Ce que la mesure a rattrapé : le premier correctif était mort-né. La page de
  secours renvoie « TikTok | Make Your Day », que le code prenait pour une
  vraie légende — un titre, même faux, faisait sauter la lecture de couverture,
  qui ne se déclenche que sur un manque. **Le repli existait, il n'était jamais
  atteint.** Filtre du remplissage générique posé au seul endroit qu'aucun
  échelon ne contourne, des deux côtés (fonction Edge et canari) : une alarme
  qui rassure à tort est pire que pas d'alarme.
  La fonction expose enfin une **sonde de santé** (`{ sante: true }`) qui dit
  seulement si la clé du modèle est posée — sans rien consommer. Le canari
  passe au **rouge** si la chaîne dépend de la couverture alors que la clé
  manque : une clé révoquée ou expirée casserait l'ajout par lien en silence,
  exactement comme l'oEmbed.
  **Corrigé le soir même** : le canari ne juge plus « la chaîne serveur est
  morte » — ce serait rouge chaque matin pour une situation connue et assumée.
  Il compare à `ATTENDU` (aucun échelon serveur vivant, couverture illisible) et
  n'alerte que sur l'écart, dans les deux sens : un échelon qui ressuscite
  rouvrirait un chemin sans application installée, et mérite d'être su.
  À faire : remplacer les liens témoins s'ils disparaissent (le canari le
  signale au lieu de crier à la panne), et étendre la même surveillance aux
  autres fournisseurs uniques — Nominatim, Overpass, Open-Meteo, proxys CORS.

- **TikTok ne rend plus la légende à personne — la couverture, puis le
  presse-papier** (août 2026). Signalé par l'utilisateur : « les ajouts TikTok
  (qui sont majoritaires) ne fonctionnent quasiment pas […] cela met "activité
  TikTok" et juste le lien ». Mesuré sur un exécuteur GitHub, pas deviné :
  l'**oEmbed renvoie 400 sur toutes les vidéos**, y compris des comptes publics
  célèbres — ce n'est donc pas une régression de Provo, c'est TikTok qui a
  fermé la porte. La page servie aux robots des messageries
  (`facebookexternalhit`) rend encore `og:title` et `og:image`, mais **plus
  aucune description**. Toute la chaîne reposait sur la légende.
  Reste ce qu'on voit : **la vignette de couverture**. Un carrousel de
  restaurant affiche presque toujours le nom en surimpression.
  `lireCouverture()` la télécharge (≤ 1,5 Mo, JPEG/PNG/WebP seulement) et la
  fait lire par le modèle. Trois garde-fous repris de la légende : origines de
  l'app uniquement, appel en dernier recours seulement, et
  **`confiance: "basse"` ne nomme rien** — une fiche qui porte un faux nom est
  pire qu'une fiche à compléter, parce qu'on ne la vérifie plus.
  Le serveur ne géocode que `vu.location`, **jamais `vu.title` seul** : il
  ignore la destination du voyage, et « Deoun » sans ville ramène n'importe
  quel homonyme du monde. Le client, lui, la connaît et refait la recherche
  située — c'est déjà ce qu'il fait pour un lien partagé.
  Quand la couverture ne suffit pas, la porte de secours est **le texte que la
  personne a sous les yeux** : elle le colle dans le **même champ** que les
  liens et les confirmations (aucun écran, aucun bouton de plus — règle A7), et
  `extract-place` accepte désormais un corps `{ texte }`. Le message le dit au
  lieu du vieux « vérifie le titre ».
  Ordre des branches : **réservation d'abord, légende ensuite**. Les deux sont
  du texte long collé ; la forme la plus précise (dossier, dates, heures)
  tranche, la légende ramasse le reste. Parcours dédié pour l'interdire de
  régresser — il vérifie que le lecteur de légendes n'est *pas* appelé.
  Au passage : `classifyWithLLM` ne part plus sur une **légende vide**, ce qui
  était devenu le cas courant — un appel payant pour classer une chaîne vide.
  Non fait à dessein : lire la vidéo elle-même (coût sans rapport), et
  transformer le champ en `<textarea>` (il reste le champ de recherche
  principal ; les retours à la ligne collés y sont de toute façon aplatis).

- **Le menu ⋯ d'une activité était prisonnier de sa carte** (août 2026).
  Signalé par un enregistrement d'écran : au tap sur ⋯, la fiche disparaissait
  et il ne restait que « Supprimer » et « Annuler ». Diagnostic de
  l'utilisateur — « c'est une question d'ordre de calque » — exact.
  Mesuré : `.act-sheet-overlay` est `position: fixed; inset: 0` mais faisait
  **358 × 174 px au lieu de 390 × 844**. Cause : `.reserve-card` porte
  `content-visibility: auto` (posé pour la fluidité des longues listes), ce qui
  implique le **confinement de peinture** — la carte devient donc le bloc
  conteneur de tout `position: fixed` situé dedans, et son `overflow: hidden`
  découpe le reste. « ✏️ Modifier », dessiné à y201 alors que la boîte commence
  à y314, n'existait tout simplement pas à l'écran.
  Un commentaire du code annonçait pourtant « rendered outside overflow:hidden
  container » : sortir du `<div>` de la fiche ne suffisait pas.
  Corrigé par `createPortal` vers `document.body` (menu + lightbox ;
  `ConfirmDialog` le faisait déjà). **Toute nouvelle modale doit passer par un
  portail** — règle E8 du playbook.
  Sonde ajoutée à `/verif-ui` : tout `position: fixed` dont un ancêtre établit
  un bloc conteneur est signalé, avec le nom du geôlier et la raison. Éprouvée
  contre le code d'avant : elle sort `[act-sheet-overlay] fait 358×174 au lieu
  de 390×844 — enfermé par [reserve-card] (content-visibility: auto)`.
  Écran `Menu d'activité` ajouté — il a aussi révélé le rouge d'iOS (#FF3B30)
  à 3,39:1 sur « Supprimer », invisible depuis toujours.

- **On ne pouvait pas corriger une activité depuis le Planning** (août 2026).
  Signalé à l'usage. La frise n'a **jamais** porté de chemin vers
  « Modifier » (`git log -S onEdit` sur `TimelineView.jsx` : vide) : une
  activité dépliée n'offrait que durée, prix, itinéraire et pastilles de
  déplacement. Corriger une heure fausse demandait d'ouvrir le jour par son
  chevron, taper la fiche, ouvrir le menu ⋯, puis l'entrée — quatre gestes,
  depuis l'écran où l'on passe son temps. L'action rare (déplacer) était là,
  l'action courante ailleurs.
  Règle A7 tenue : aucun élément créé. La ligne « DÉPLACER VERS » existait
  déjà et n'occupait que son libellé ; elle reçoit `✏️ Modifier` à droite.

- **Le soir, la pioche proposait une randonnée de neuf heures** (août 2026).
  `tempsRestant()` rend `0` quand il ne reste plus rien — mais `piocheGuidee`
  lisait ce zéro comme « je ne sais pas » (`if (minutes > 0 && duree >
  minutes)`) et **sautait le filtre de durée précisément au moment où il
  compte**. Zéro minute disponible vaut zéro idée, et le dire est la bonne
  réponse. C'était aussi la dernière « dépendance à l'heure » de `/parcours` :
  ce n'était pas un parcours fragile, c'était un vrai bug qui ne se voyait
  qu'en fin de journée.

- **« Estimé » comptait trois choses qui n'ont rien à y faire** (août 2026).
  Constaté sur un vrai voyage, le dernier soir : **1 111 € dépensés et
  « 1 461 € estimé »** alors qu'il ne restait rien à faire. Le calcul
  additionnait le prix de *toutes* les activités connues plus *toutes* les
  dépenses :
  1. **la Réserve** — un vivier d'idées, pas un programme ; dix-huit idées
     gardées « au cas où » entraient dans le budget ;
  2. **les activités annulées** (`status: 'nogo'`), que `budgetStats()` prend
     pourtant soin d'écarter — deux calculs du même chiffre, deux règles ;
  3. **les activités déjà réglées**, comptées deux fois : leur prix prévu *et*
     la dépense saisie pour elles.

  Et une quatrième, trouvée en mesurant : **l'app insère deux repas par jour à
  20 €**, et ils étaient comptés « à venir » même sur des journées écoulées —
  120 € fantômes sur trois jours passés.

  Règle tenue désormais : `estimé = déjà dépensé + ce qui reste au programme
  des jours qui n'ont pas encore eu lieu`. Une journée passée ne peut plus
  rien coûter : ses activités non cochées ne comptent **ni** comme dépensé
  **ni** comme à venir — ce qui a réellement été payé est dans l'onglet
  Dépenses, et c'est lui qui fait foi. **Quand la dernière activité est
  cochée, l'estimé rejoint le dépensé** — verrouillé par le parcours
  « Le dernier soir, l'estimé rejoint le dépensé ».

- **Une échelle, pas un empilement de décisions ponctuelles** (août 2026).
  Mesuré avant : **32 tailles de texte, 9 graisses, 23 rayons**, avec des
  valeurs comme 9,75 px, 12,5 px ou 16,5 px — des résultats de multiplication,
  pas des choix. Jusqu'à **31 couples taille/graisse sur le seul jour ouvert**.
  Après : sept pas (`--t-xs` … `--t-3xl`, rapport ≈ 1,2), trois graisses
  (400 / 600 / 800), quatre rayons (`--radius-xs/sm/md/lg` + `pill`).
  **Aucune taille ni aucun rayon en dur ne doit réapparaître dans `index.css`.**
  700 a rejoint 600 : la hiérarchie se porte par la taille.

- **Le thème sombre arrondissait plus que le clair, sans que personne l'ait
  décidé** (août 2026). Les jetons `--radius-*` étaient déclarés **quatre
  fois** ; les blocs `[data-theme="dark"]` posaient 12/18/26 là où le clair
  avait 10/14/20. Cinquième occurrence de B5 dans ce fichier. Une seule
  déclaration désormais, en haut, identique pour les deux thèmes.

- **La carte du jour hurlait la date et chuchotait le programme** (août 2026).
  Date à 16,5/800, titre d'activité à 13,5/600. Inversé : titre à 15/600, date
  à 13/600, heure passée de 800 à 600. Et la carte tenait **530 px pour 150 px
  de contenu** — 315 px de blanc, 59 % — parce qu'elle était étirée à toute la
  hauteur disponible. Elle prend maintenant la hauteur de son contenu, entre un
  plancher de 232 px et un plafond de `100dvh - 300px`.

- **Un titre est un nom, jamais une adresse** (août 2026). `nomDeLieu()`
  existait mais n'était appliqué qu'**à l'import** : les fiches déjà
  enregistrées gardaient « Café bel étage, Kärntner Straße 38, 1010 Vienna
  Austria » sur trois lignes, avec la même adresse répétée juste dessous. Le
  nettoyage se fait maintenant **à l'affichage** (`ActivityCard`,
  `TimelineView`) : il répare aussi l'existant, sans réécrire une donnée.

- **Le jour ouvert et la fiche d'activité n'étaient mesurés nulle part**
  (août 2026). Sept cibles sous 44 px y vivaient, dont la pastille « fait » à
  **27 × 27** — l'action la plus répétée du voyage. Pire : le parcours
  « Fiche activité » de `/verif-ui` cherchait `.activity-card` sur le Planning,
  qui n'en contient aucune (la frise est faite de `.tl-activity`) — il cliquait
  dans le vide et remesurait le Planning sous un faux nom. **Neuf écrans
  annoncés, sept distincts.** D'où le champ `repere` : chaque écran affirme
  désormais un sélecteur qui n'existe que là, et l'outil crie quand il n'y est
  pas (règle E6 du playbook). Dix écrans réels aujourd'hui.

- **Un outil ne trouve que sur les écrans qu'on lui montre** (août 2026).
  `/verif-ui` déclarait « rien à signaler » alors que « ✅ Ajouter » passait
  sous la barre d'onglets sur ses 29 derniers pixels : le formulaire d'ajout
  d'une dépense n'était tout simplement jamais ouvert par la sonde. L'écran
  `Dépense (ajout)` a été ajouté — il a immédiatement sorti un contraste à
  3,39:1 sur les pastilles de voyageur en thème sombre, invisible depuis
  toujours. **Avant d'ajouter une sonde, vérifier qu'un écran l'exerce.**

- **Trois nouvelles sondes, nées de trois erreurs de mesure** (août 2026) :
  1. *Recouvert par un calque du bas* — un bouton dans le cadre mais caché
     derrière la barre flottante. Restreinte aux actions principales : passée
     sur tous les éléments cliquables, elle signalait chaque carte qui longe
     la barre au fil du défilement.
  2. *« Ancré en bas » se juge sur le haut du calque* — la barre d'onglets de
     Provo est une pastille flottante dont le bas est à 834 px pour un écran
     de 844. Un test `bottom >= innerHeight` ne l'aurait jamais reconnue.
  3. *Un conteneur qui défile découpe ce qui en sort* — et
     `getBoundingClientRect` l'ignore. « ✓ Remboursé » sortait comme cible
     inatteignable de 105 × 28 px alors qu'il était remonté derrière
     l'en-tête, donc absent de l'écran.

- **Une sonde neuve se prouve contre le code d'avant** (août 2026). La
  première version de la sonde « recouvert » ne trouvait rien — parce que la
  correction livrée dans le même lot avait déjà raccourci le formulaire. Il a
  fallu remiser les changements applicatifs (`git stash`) et rejouer la sonde
  seule sur le code d'origine pour voir qu'elle était muette, puis qu'elle
  parlait. **Une sonde qui n'a jamais rougi n'est pas une sonde vérifiée.**

- **Un glissement de suppression armait aussi la navigation entre onglets**
  (août 2026). `onTabTouchStart` excluait `.activity-card-swipe` mais pas
  `.expense-item-swipe` : parti du bord droit — exactement là où le pouce le
  commence — le glissement supprimait la dépense **et** basculait sur l'onglet
  Carte. Mesuré, pas supposé : `Dépenses` → `Carte`. Toute nouvelle rangée
  glissable doit s'ajouter à cette liste d'exclusion.

- **La ligne EST le bouton** (août 2026, règle A7). Chaque dépense portait un
  crayon et une corbeille, tous deux forcés à 44 × 44 px parce que leurs halos
  se seraient recouverts. Le glissement supprimait déjà, le tap ouvrait déjà.
  Les deux icônes sont parties ; supprimer vit dans la fiche qu'on vient
  d'ouvrir. Une cible qu'on n'a pas à agrandir vaut mieux qu'une cible
  agrandie.

- **Le formulaire de dépense s'ouvre sur le montant** (août 2026). C'est ce
  qu'on a sous les yeux, écrit sur le ticket qu'on tient. Catégorie, partage
  et activité liée sont derrière le même pli « Détails » que la fiche
  d'activité — dont le résumé annonce le contenu, donc rien n'est caché.
  Mesuré : 653 → 432 px de haut, 9 → 6 blocs, 14 → 5 boutons.

- **La feuille Compte est l'angle mort des outils** (août 2026). Ni
  `/verif-ui` ni `/parcours` ne savent l'ouvrir : elle demande une session
  authentifiée. Deux défauts y ont donc échappé et n'ont été vus que sur une
  capture d'iPhone — un interrupteur grisé, puis deux rangées de réglages qui
  se chevauchaient (`display: inline-flex` les posait côte à côte ; sur 390 px
  l'interrupteur des vibrations passait par-dessus le mot « Mode clair »).
  Chaque réglage prend maintenant sa ligne : libellé à gauche, interrupteur à
  droite, 48 px — mesuré dans les deux thèmes.
  **À vérifier à l'œil après toute modification de cet écran.**

- **Un parcours ne doit pas dépendre de l'heure qu'il est** (août 2026). Deux
  d'entre eux rougissaient à midi et passaient le matin : l'un visait la
  pastille « Ouvert » (qui dépend des horaires d'ouverture), l'autre exigeait
  que la pioche ait toujours quelque chose à proposer — faux en fin de
  journée, et c'est la bonne réponse, pas une panne. Une suite qui rougit à
  l'heure du déjeuner cesse d'être lue. Les pastilles de catégorie se visent
  maintenant par leur `aria-label`, seul repère stable puisque la liste se
  reconstruit à chaque clic.

- **67 parcours** (août 2026). Les trois fonctionnalités d'août n'avaient
  aucune couverture : billets du voyage, pré-chargement de la carte,
  confirmations collées. Quatre parcours de plus, et l'un d'eux a trouvé un
  vrai défaut — le pré-chargement s'obstinait onze secondes salve après salve
  même quand aucune tuile n'arrivait. Il s'arrête maintenant après deux salves
  bredouilles, ne marque pas le voyage comme fait, et réessaie six heures plus
  tard. Sans ça, la carte pouvait rester vide pour toujours.

- **Zéro défaut mesuré hors carte** (août 2026). `/verif-ui` couvre maintenant
  **huit** écrans dans les deux thèmes — l'Ajout et les Notes ont été ajoutés,
  et c'est là qu'il a trouvé les derniers : croix de fermeture à 28 px et
  4,22:1, raccourcis de type à 29 px, « Ouvert » en vert vif à 2,18:1.
  `.sheet__close` était déclarée **trois fois** dans la feuille : corriger les
  deux premières ne servait à rien (B5, quatrième occurrence).
  Il reste 26 points, tous sur la carte, tous assumés.

- **La surcharge se voit sans ouvrir le jour** (août 2026). C'était la seule
  friction que `/parcours` signalait encore. Le glyphe ⚠️ / ⚡ se pose dans la
  rangée d'état de la carte du jour, avec la météo et les notes — un glyphe,
  pas un bandeau, et le message complet en `aria-label`. Le détail du jour
  garde l'explication ; la frise donne la raison d'aller la lire.
  **63 parcours : 0 cassé, 0 friction, 0 non joué.**

- **Règle A7 en vigueur ici, sans exception** (août 2026) — « souvent tu ajoutes
  toutes les fonctionnalités, mais juste pour qu'elles y soient ». Dans ce
  projet, toute livraison doit pouvoir répondre à trois questions :
  1. quel élément **déjà à l'écran** porte la nouveauté ?
  2. si un élément est créé, **lequel disparaît** en échange ?
  3. le nombre d'éléments visibles par écran a-t-il **baissé ou stagné** ?

  Provo a une identité épurée : peu d'éléments, gros caractères, action évidente.
  C'est ce qui le distingue de Wanderlog, dont le reproche n°1 en 2026 est d'être
  « chaotique et encombré ». Une fonctionnalité utile mal insérée coûte plus que
  ce qu'elle rapporte.

- **Les rappels du voyage** (août 2026). Le Web Push marche sur iPhone depuis
  iOS 16.4, **mais seulement pour une app ajoutée à l'écran d'accueil** — en
  onglet Safari, `PushManager` n'existe pas. L'interrupteur le dit au lieu de
  rester mort. Un refus précédent fondé sur « bloqué sur iOS » était périmé.

  Chaîne : `useNotifications.js` (abonnement) → table `push_subscriptions`
  → `push-tick` (fonction Edge) → `.github/workflows/push-tick.yml` toutes les
  15 min. Le serveur lit les voyages dans `trips.data`, d'où la nécessité d'un
  compte connecté — sans compte, rien n'est proposé.

  **Trois rappels seulement**, chacun lié à une décision à prendre à cet
  instant : « il est temps de partir » (25 min avant), « ça ferme bientôt »
  (1 h avant), « c'est demain » (la veille à 18 h). Pas de résumé, pas de bonne
  journée : une notification qui n'aide pas fait désactiver toutes les autres.
  Rien entre 22 h et 7 h, **à l'heure du voyageur** (colonne `fuseau`), et un
  seul envoi par activité et par type (colonne `envoyes`).

  **Mise en route : un seul geste.** Actions › « Installer les rappels » ›
  Run workflow. Il crée la table par l'API de gestion Supabase, fabrique la
  paire de clés VAPID, dépose la privée dans les secrets Supabase et commite
  la publique dans `src/lib/vapid.js`. Aucun secret GitHub nouveau : le seul
  utilisé est `SUPABASE_ACCESS_TOKEN`, déjà là pour le déploiement des
  fonctions.

  **La clé privée n'existe jamais ailleurs que dans le runner et Supabase.**
  Ni dépôt, ni journal, ni conversation. La publique, elle, est faite pour être
  dans le bundle : la commiter évite qu'un déploiement l'oublie.

  `scripts/vapid.mjs` (`npm run vapid`) reste disponible pour la faire à la
  main, mais n'est plus nécessaire.

  Le déclencheur `push-tick.yml` ne demande **aucun secret** : l'adresse du
  projet et la clé publiable sont déjà dans le dépôt, et le point d'entrée peut
  rester ouvert — il n'accepte aucune donnée, ne rend que des compteurs, et
  n'envoie chaque rappel qu'une fois.

  **Installé et mesuré le 6 août 2026.** Le workflow a créé la table et déposé
  la clé privée ; son dernier pas a échoué parce que `main` est protégée — il
  ouvre maintenant une PR au lieu de pousser. Vérifié depuis un exécuteur
  GitHub, sur le vrai projet :

  ```
  POST .../functions/v1/push-tick → HTTP 200
  {"ok":true,"abonnes":0,"envoyes":0}
  ```

  Si la table manquait, la réponse serait `abonnements_illisibles` ; si la clé
  privée manquait, `vapid_absent`. Les deux sont donc en place, et la clé
  publique est dans le bundle construit depuis `main`.

  **Reste non prouvé tant qu'aucun appareil n'est abonné** : le chiffrement de
  la charge utile et l'envoi réel. Le premier abonnement fera passer `abonnes`
  à 1 au tour suivant — c'est le contrôle à faire après avoir touché
  l'interrupteur.

  **Le bac à sable de développement ne joint ni `vercel.app` ni le domaine
  Supabase du projet** : toute vérification de la chaîne réelle passe par un
  exécuteur GitHub (voir E2 dans le playbook).

- **La carte se garde toute seule** (août 2026). Ouvrir l'onglet Carte quand le
  départ est à moins de dix jours pré-charge les tuiles autour des lieux du
  voyage — **sans aucune interface** : ni bouton, ni bandeau, ni pop-up. Une
  boîte de dialogue à l'arrivée sur la carte a été écrite puis retirée : elle
  bloquait l'écran et demandait une décision que personne ne peut prendre (qui
  sait ce que pèsent des tuiles ?). Limites tenues dans
  `utils/carteHorsLigne.js` : 300 tuiles maximum (~4,5 Mo), six à la fois avec
  une pause — les CGU d'OpenStreetMap découragent le téléchargement en masse —
  et rien du tout si l'économiseur de données du système est actif.

- **Coller une confirmation remplit la fiche** (août 2026). Le champ de
  recherche de la feuille d'ajout reconnaît un courriel de réservation
  (`ressembleAUneReservation`) et le fait lire par `read-booking`. Même champ,
  même bouton : aucun écran ni bouton « importer une réservation » à côté.

- **Les hooks après le `return` anticipé** — quatrième occurrence dans
  `TripView.jsx`, dont une déjà livrée. Le fichier a une garde `if (!trip)`
  vers la ligne 330 : **tout `useState` / `useEffect` doit être au-dessus**.
  `npx eslint src/pages/TripView.jsx` le dit ; le lancer avant de commiter.

- **Deux jetons de bleu, deux métiers** (août 2026). `--accent` (#35A7DD) est la
  teinte de marque : traits, bordures, surfaces. Elle **ne peut porter aucun
  texte** — 2,72:1 contre le blanc, dans les deux sens. `--accent-deep`
  (#287DA6) reçoit du blanc ; `--accent-texte` (#22719A, clair en thème sombre)
  *est* du texte. Idem `--red-deep` / `--red-texte`, `--green-deep`.
  Trois fois de suite, une correction de couleur a été annulée par une
  redéclaration plus bas dans `index.css` (B5) : chercher `--orange:` et
  `!important` avant de conclure qu'un correctif ne marche pas.

- **Un seul geste par intention** (août 2026). Il existait **quatre** façons de
  déplacer une activité du planning : deux poignées ⠿ identiques côte à côte,
  un appui long, et les pastilles « Déplacer vers ». Il en reste **une**
  (poignée 44 × 44) plus les pastilles, qui sont aussi le seul chemin vers la
  Réserve. `useTouchDnd` supprimé (146 lignes).

- **La barre d'onglets masquait les dépôts** (août 2026). `elementFromPoint`
  renvoyait la barre flottante, la cible passait à « rien », et relâcher là ne
  déplaçait rien — sans un mot. `useReorderDrag` garde maintenant la dernière
  cible connue quand le doigt passe sous un calque `position: fixed`. Le vide
  reste l'échappatoire.

- **Le formulaire d'ajout est derrière un pli** (août 2026). La recherche de
  lieu est passée en tête et cherche à la frappe ; titre, catégorie, durée,
  horaires, prix et notes vivent sous « ▾ Détails ». Onze champs et huit tuiles
  ne s'ouvrent plus à chaque ajout alors que le principe produit dit que l'app
  remplit elle-même.

- **La carte reste à 32 px, sciemment.** Les 26 points restants de `/verif-ui`
  sont tous là : marqueurs Leaflet 32 × 32 et les deux liens d'attribution
  OpenStreetMap, obligatoires par licence. Les élargir à 44 px les ferait se
  chevaucher en zone dense — le doigt toucherait le mauvais lieu, ce qui est
  pire que viser. Tout le reste de l'app est à zéro dans les deux thèmes.

- **`/verif-ui` détecte les plantages et ignore les émojis** (août 2026). Il
  mesurait l'écran d'erreur sans broncher — tout au vert alors que l'app était
  tombée. Il comptait aussi les émojis couleur comme des défauts de contraste
  (1,11:1) alors qu'ils peignent leurs propres pixels. Les glyphes monochromes
  — ⠿, ▼, ＋ — restent mesurés : c'est ainsi qu'une poignée invisible a été
  trouvée.

- **L'onglet « Aujourd'hui » a été retiré** (août 2026). Le planning place déjà
  le jour J au centre à l'ouverture ; un onglet séparé dédoublait la question.
  `TodayMode.jsx` supprimé. Ce qui s'y faisait vit dans le menu ⋯
  (« Que faire maintenant ? ») et sur la fiche d'activité.
- **Les feuilles sont plein écran** (`align-self: stretch; height: 100dvh`).
  Une seule exception assumée : `.sheet--proposition`, un avis de trois lignes
  qui se lirait comme un blocage s'il occupait tout l'écran.
- **`content-visibility: auto`** sur les listes longues plutôt qu'une
  bibliothèque de virtualisation : mesuré à 17 648 px rendus pour un écran de
  844. Là où la propriété n'existe pas, tout se dessine comme avant.
- **Le retour haptique n'a aucun effet sur iPhone** — Safari n'implémente pas
  `navigator.vibrate`. Bonus Android, jamais un canal d'information.
- **Le Web Share Target n'existe pas sur iOS** (WebKit #194593). D'où le
  bouton « Coller un lien » et la voie du raccourci iOS (`?ajout=`).

## Écarté sciemment

- **Google Places** (F3) — carte bancaire obligatoire depuis mars 2025, et CGU
  interdisant d'afficher ces données sur une carte non-Google. Remplacé par
  Nominatim + Overpass.
- **Widget « prochaine activité », bloc-notes vocal, mode journée improvisée,
  modèles de voyage, checklist administrative, export du bilan en image** —
  proposés, non retenus. Ne pas les reproposer.
- **Champ « notes » supplémentaire** — refusé explicitement.

## Points ouverts

- Ce dépôt est la **source de référence** du playbook : les autres projets y
  copient `.claude/`. Toute règle ajoutée ici doit atterrir sur `main`, sinon
  elle est invisible pour eux (F2).

- Qualité réelle de la complétion automatique sur les petits commerces
  (couverture OpenStreetMap) — à valider à l'usage.
- Vercel Deployment Protection à passer sur « Only Preview Deployments » pour
  que la preview soit accessible sans compte (F2).

## Vérification standard de ce projet

```bash
npm run build
npx vite preview --port 4173      # en arrière-plan
```

Puis Playwright, thèmes clair **et** sombre, en amorçant `localStorage`
(`provo_trips`, `provo_settings`, `provo_theme`) :

```js
chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
```

Le thème se bascule **par le menu `⋯`**, pas par `localStorage` : `addInitScript`
réécrit la clé à chaque rechargement.

Puis, **avant toute livraison qui touche l'interface** :

```bash
npm run verif-ui
```

`/verif-ui` mesure ce qu'un coup d'œil ne tranche pas — contraste WCAG, cibles
de 44 px, débordement horizontal, action passée sous la ligne de flottaison,
boutons sans nom accessible, erreurs JS — sur les sept écrans principaux, dans
les deux thèmes. Il complète `/audit`, qui juge et propose ; lui ne fait que
compter. Le jeu de données de référence est `scripts/ui-fixture.mjs` : le même
voyage à chaque exécution, pour que deux mesures soient comparables.

Le contraste n'est calculé que sur fond **uni** : sur un dégradé ou une photo,
la couleur derrière le texte dépend de l'endroit exact où il tombe. Ces cas
sortent dans une liste séparée, non comptée en défaut. Un outil qui invente des
défauts finit par ne plus être lu.

Puis, **avant une livraison importante ou après une modification qui touche
plusieurs écrans** :

```bash
npm run parcours              # 50 parcours : hors ligne + services rejoués
npm run parcours:hors-ligne   # seulement ce qui doit marcher sans réseau
npm run parcours:reseau       # seulement les chaînes distantes
npm run verif-carte           # la carte : cadrage, zoom, position, bulles
```

`/parcours` est le seul des trois outils qui **appuie sur les boutons**. Il
rejoue des intentions d'utilisateur et vérifie à la fois l'écran et ce qui est
réellement enregistré — un écran peut avoir l'air juste pendant que les données
s'abîment derrière. Il détecte aussi les **plantages** : quand l'app tombe,
l'état fautif n'est jamais enregistré, donc aucun contrôle sur le stockage ne
peut le voir.

Les services distants sont **rejoués** (`scripts/reseau-stubs.mjs`), avec la
panne au choix : 500, 429 qui répond du HTML, 200 au corps tronqué, injoignable,
ou « a répondu mais n'a rien trouvé ». On ne peut pas demander à un vrai service
de tomber en panne, et c'est là que sont les bugs. Chaque parcours réseau a un
jumeau à l'attente inverse : les deux au vert prouvent que le stub pilote
vraiment le comportement.

Reste hors de portée : la **disponibilité réelle** des services et la forme
actuelle de leurs réponses — voir `scripts/diag-*.mjs`, sur réseau réel.

Devant un ✗ : **regarder le DOM réel avant de toucher au code de l'app.** À la
mise au point, sept constats sur huit venaient du script lui-même (mauvais
sélecteurs), pas de l'application.

## Contrôle des lieux (`verifyPlaces.js`)

Un géocodeur se trompe : « Vienna state opera » est déjà ressorti à Opera, en
Italie. L'erreur ne se voit pas dans une liste — elle se découvre sur la carte,
ou sur place. Deux temps **volontairement séparés** :

- `analyserVoyage(trip, ancre)` — pure géométrie, aucune requête. Tourne en
  continu, même hors ligne. Seuil : 150 km de la destination. En road trip,
  la distance à la destination ne veut plus rien dire : c'est l'**isolement**
  qui compte (loin de la destination *et* de toutes les autres activités).
- `chercherCorrections(...)` — en ligne, lent, seulement sur demande.

Rien n'est jamais appliqué d'office (principe produit). Le bandeau se referme,
chaque proposition se laisse, et une correction n'écrase que ce qui est faux :
pour un lieu écarté la position, pour une fiche incomplète les seuls trous.

**Jamais d'abandon silencieux.** Quand la recherche ne trouve rien d'utilisable,
la fiche s'affiche quand même avec la raison (`aucun`, `loin`, `identique`) et
deux issues : « C'est correct » ou « Corriger à la main ». Un lieu signalé puis
laissé sans un mot est le pire des deux mondes — l'erreur persiste et on ne sait
pas pourquoi. C'est le cas « Casa de Mozart » : le géocodeur ne connaît que la
maison de Salzbourg, aucune correction automatique n'est possible, il faut le
dire.

**Mémoire des vérifications.** `signaturePlace(a)` = `titre|lat|lon` arrondis,
stockée dans `a.placeCheckSig`. Une fiche déjà examinée n'est plus recherchée en
ligne (une seconde par lieu, c'est cher) ni comptée dans le bandeau. Modifier le
titre ou la position invalide l'empreinte et remet la fiche dans le circuit.
`analyse.nouveaux` alerte, `analyse.total` sert au bouton « Tout revérifier ».

Fausses alertes vérifiées comme telles : excursion à 55 km, road trip étalé,
repas, voyage sans ancre géocodée — aucun n'est signalé.

## Mesurer ce que le bac à sable ne peut pas joindre

La politique réseau de l'environnement de développement **bloque `share.google`
et le domaine Supabase du projet** (403 sur le CONNECT du proxy). Impossible d'y
tester la résolution d'un lien ou la fonction Edge en local.

Ne pas en conclure une cause : lancer `.github/workflows/diagnose-link.yml`
(Actions › Run workflow, le lien en paramètre). Un exécuteur GitHub sort par une
IP de centre de données, comme la fonction Edge, et mesure la chaîne complète —
redirections, réponse de la fonction, préflight CORS, santé des proxys de
secours (E2).

Le déploiement de la fonction Edge est automatique :
`.github/workflows/deploy-edge-functions.yml` se déclenche sur `main` dès que
`supabase/functions/**` change. Un correctif de l'extracteur poussé sur une
branche n'est donc **pas** en ligne tant qu'il n'est pas fusionné.

## Enrichissement par le site du lieu (`enrich-place` + `deepEnrich.js`)

OpenStreetMap connaît bien les monuments, mal les commerces : un café y aura
rarement ses horaires et jamais son ticket moyen. Or c'est justement ce qu'on
veut savoir avant d'y aller. Le site de l'établissement, lui, le dit — mais le
navigateur ne peut pas le lire (CORS), d'où la fonction Edge.

Chaîne : site officiel via le tag OSM `website` → téléchargement de la page →
extraction par le modèle (horaires, fourchette de prix, description en deux
phrases) → **pop-up de confirmation**, jamais d'écriture directe.

Déclenchement **automatique à l'ajout** d'une activité, en arrière-plan, une à
la fois. La pop-up s'ouvre quand il y a quelque chose à proposer.

Points de conception à ne pas défaire :

- **La provenance est affichée** (« D'après cafe-example.at »). Une information
  dont on ignore la source se fait accepter les yeux fermés.
- **Un prix deviné est refusé.** `confiance: "basse"` vide les champs prix et
  description : une fourchette fausse finit dans le budget de quelqu'un.
- **Seuls les trous sont remplis** : ce que l'utilisateur a saisi n'est jamais
  écrasé, même par une source plus récente.
- **Garde-fou SSRF** dans la fonction : la fonction télécharge une URL qu'elle
  n'a pas choisie. Protocoles limités à http/https, adresses privées et noms
  sans point refusés.
- Sans clé Anthropic configurée, la réponse retombe sur OSM avec
  `raison: "modele_non_configure"` — jamais un échec silencieux.

La clé se pose côté Supabase (`Edge Functions → Secrets`), sous
`ANTHROPIC_API_KEY` ou `ANTHROPIC_API_KEY_TB` : les deux noms sont acceptés.
