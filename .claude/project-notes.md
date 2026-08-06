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
| A4 · Chiffre principal | Budget, soldes, compte à rebours |
| A5 · Contenu qui remplit | Cartes de jour pleine hauteur ; dates d'en-tête retirées |
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

Inspiré de Punkt AI, qui fait lire la vidéo par une IA. Aucune règle ne
transforme « Perfect restaurant for Gen-Zs » en nom de lieu ; un modèle, si.

`classifyWithLLM` s'active dès que le secret **`ANTHROPIC_API_KEY`** est posé
dans Supabase › Edge Functions › Secrets. Trois garde-fous, parce que la clé
est payante et que la clé publique Supabase est lisible dans le bundle :

1. Seules les origines de l'app déclenchent l'appel (`origineAutorisee`).
2. Le modèle n'est appelé que si les règles ont échoué — une légende contenant
   déjà « 📍 Bouillon Chartier, Paris » se lit sans lui.
3. Sa réponse repasse par le géocodeur, qui refuse ce qui ne correspond à rien,
   et une réponse marquée `confiance: "basse"` ne peut ni nommer ni situer.

Modèle : `claude-haiku-4-5-20251001`, environ 0,001 € par lien.

## Décisions récentes

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
