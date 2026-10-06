# Critique design · Provo · 1er octobre 2026

Deux passes : la critique du visuel et du design system, puis le test d'un
nouvel utilisateur. Rien n'a été modifié dans le code : ce rapport attend tes
choix.

## Suite donnée (1er octobre 2026, même jour)

Demandé : « fais tout ce que tu penses être le mieux ». Les trois lots sont
appliqués, avec trois écarts par rapport au plan ci-dessous, chacun pour une
raison :

- **Les repas restent dans l'estimé.** Je recommandais de les en sortir ;
  `budgetStats` documente qu'ils y sont exprès, pour qu'on sache à quoi
  s'attendre. Ils sortent des compteurs, de l'avancement et du bilan, et
  l'estimé dit d'où il vient (« ≈ 200 € de repas prévus »).
- **La Réserve vide ne promet pas Instagram** : l'extraction Instagram est
  abandonnée sciemment (`project-notes.md`).
- **Le vide sous la carte du jour (F3) n'est pas traité** : c'est la
  conséquence de la frise horizontale, une décision de conception à prendre
  avec toi.

Trouvé en chemin et corrigé : un champ de saisie posé dans une feuille ne se
voyait plus du tout (A-072).

Vérifié : `verif-ui` à zéro hors carte sur 30 écrans par thème (26 avant),
avec la nouvelle mesure au pixel ; 92 parcours et 21 suites verts ;
`verif-jetons` rouge sur l'ancien code, vert sur le nouveau. Non vérifié : le
rendu de SF Pro sur un vrai iPhone (captures faites sous Linux).

Le détail des décisions est dans `.claude/project-notes.md` ; les constats
sont dans `.audit/journal.md` (A-066 à A-074 ; numérotés après l'audit du 2026-10-05, fusionné avant).

## Méthode et limites

- **26 écrans × 2 thèmes** capturés sur le jeu de référence de `verif-ui`
  (390 × 844), plus **le parcours d'un nouvel utilisateur** depuis un téléphone
  vierge (aucun voyage, aucun compte), 14 étapes × 2 thèmes.
- **Mesuré, pas estimé** : contraste au pixel sur les fonds en dégradé (que
  `verif-ui` ne compte pas), géométrie lue dans le DOM, inventaire chiffré de
  `src/index.css`, lecture du code pour chaque cause annoncée.
- **Ce que je n'ai pas pu vérifier** (F4) :
  - le réseau extérieur était coupé pendant les captures : police de secours
    au lieu d'Inter, ni tuiles de carte ni photos ;
  - les champs date et heure sont rendus par un Chromium sans interface au
    format américain (AM/PM, MM/JJ). Sur un téléphone réglé en français ce
    sera probablement différent : non vérifié, donc non compté ;
  - la feuille Compte (elle demande une session) et un vrai iPhone.
- **Ce que je n'ai pas trouvé : le cliché violet/indigo.** 10 couleurs sur 316
  dans la feuille sont violettes, surtout des catégories. Le cliché de Provo
  est ailleurs : le **bleu « glossy »** (dégradé, reflet intérieur, ombre
  colorée, ombre portée sur le texte) et **l'émoji comme système d'icônes**.
- **Ce qui tient** : l'échelle typographique (6 à 7 tailles, 3 graisses par
  écran, conforme à E7), la réduction de mouvement respectée, `verif-ui` à
  zéro hors carte sur les fonds unis.
- **Respecté, donc non critiqué** : le formulaire de dépense façon Tricount
  (demandé tel quel), 🔄 et 🌙 sur l'accueil, les marqueurs de carte à 32 px,
  et tout ce que `project-notes.md` liste comme écarté.

---

## 🔴 Critiques majeures

### R1 · Le blanc sur dégradé bleu clair ne se lit pas, et l'outil ne le voit pas

Contraste mesuré au pixel (valeur médiane du fond derrière le texte) :

| Élément | Clair | Sombre | Seuil WCAG |
|---|---|---|---|
| Libellé de l'onglet actif (10,9 px) | 2,66:1 | 2,69:1 | 4,5:1 |
| Bouton « Nouveau voyage » | 2,66:1 | 2,68:1 | 4,5:1 |
| ＋ de l'en-tête (glyphe) | 2,63:1 | 3,91:1 | 3:1 |
| Activités de la carte « En voyage » | 2,77:1 | 2,77:1 | 4,5:1 |
| « JOUR 1 » sur l'en-tête du jour | 2,47:1 | 3,92:1 | 4,5:1 |

- **Cause.** `--accent-grad` commence à `#5CBEEA`, plus clair que l'accent
  `#35A7DD`, qui ne tient déjà que 2,72:1 face au blanc. Le libellé du jour
  prend `--trip-accent` comme couleur de texte, alors que les notes du projet
  disent que l'accent « ne peut porter aucun texte ». Avec une couleur pays
  claire (Islande `#48cae4`), on descend à **1,79:1**.
- **Pourquoi personne ne l'a vu.** `verif-ui` range **989 textes** dans
  « fond non uni, à vérifier à l'œil, non compté ». L'onglet actif, l'élément
  le plus vu de l'app, en fait partie.

C'est la sixième occurrence de la récidive « un cas qu'aucun outil ne
regarde ».

| Règles | Effort |
|---|---|
| B1, E6 | petit pour le CSS, moyen pour la sonde |

### R2 · Il n'y a pas un design system, il y en a quatre, empilés

`src/index.css` fait 7 638 lignes. Il empile des couches successives :

- « APPLE DESIGN SYSTEM » ;
- « PROVO 2.0 Premium Redesign » ;
- « DESIGN 2.0 direction golden hour » ;
- « MODE CLAIR 2.0 à la Apple » ;
- « APAISEMENT ».

Chacune redéclare les jetons :

| Mesure | Valeur |
|---|---|
| `--surface` / `--text` / `--text-muted` / `--shadow-md` | déclarés 7, 7, 8 et 8 fois |
| `.tab-btn--active` | 7 déclarations complètes |
| Couleurs distinctes | 122 hex et 166 rgba |
| Ombres distinctes | 91 |
| Mouvement | 29 durées, 14 courbes, 18 `transition: all` |
| Calques | 23 valeurs de z-index, jusqu'à 9999 |
| `!important` | 68 |
| Espacements | 32 valeurs, dont 3, 5, 7, 9, 11 et 13 px |
| letter-spacing | 33 valeurs |

**Les commentaires mentent.** « Ombres teintées ambre », « mode sombre
braise, charbon chaud » et « neutres chauds papier/sable » décrivent des
valeurs bleu froid. La personne qui lit le fichier croit retoucher une palette
chaude.

C'est la règle B5 devenue structurelle : cinq occurrences sont déjà notées
dans `project-notes.md`, et chaque correctif de couleur commence par une chasse
au doublon.

| Règles | Effort |
|---|---|
| B5, E7 | gros, mais découpable couche par couche |

### R3 · Créer un voyage : un contrôle mort, un champ qui déborde, 34 contrôles

- **La couleur choisie n'est jamais enregistrée.** `createTrip`
  (`src/hooks/useTrips.js:591`) ne recopie pas `color`. Le voyage prend alors
  la couleur du pays (`COUNTRY_THEMES`) :

  | Pays | Couleur |
  |---|---|
  | Portugal | `#3a0ca3`, indigo, le seul vrai violet de l'app |
  | Autriche | `#780000`, bordeaux |
  | France | `#003049`, presque noir |

  Le choix ne fonctionne qu'en modification. Règle A8 : un contrôle qui ne
  fait rien se lit comme une panne.
- **Le champ « Retour » sort de la fenêtre.** Son bord droit est à 404 px,
  pour une fenêtre qui s'arrête à 370 px sur un écran de 390. La fenêtre
  défile de côté : 384 px de contenu pour 350 visibles. Cause : la grille
  `1fr 1fr` posée en style en ligne laisse le champ date imposer sa largeur
  minimale. Cet écran n'est pas dans `verif-ui`.
- **34 contrôles pour créer un voyage.** Trois sont des choix décoratifs
  (8 couleurs, 15 émojis, une photo), demandés avant même que le voyage
  existe. À l'inverse, la destination, qui pilote la recherche située, la
  devise et la couleur, est facultative.
- **C'est la seule fenêtre centrée de l'app.** Toutes les autres feuilles
  sont plein écran, comme le veut la convention notée.

| Règles | Effort |
|---|---|
| A8, A3, E6 | petit pour les deux défauts, moyen pour l'allègement |

### R4 · Le premier voyage s'ouvre sur des données que personne n'a saisies

J'ai créé un voyage de 5 jours sans rien y ajouter. Il affiche déjà :

- 10 activités « Repas midi » et « Repas soir » à 20 € ;
- « 200 € estimé », sans aucun budget saisi ;
- un badge « 10 » sur l'onglet Planning.

Sur le jeu de référence, le Bilan affiche « 🥇 Resto ×12 » parmi les
« activités préférées ». Ce sont les 12 repas insérés d'office :
`TripRecap.jsx:36` compte toutes les activités tant qu'aucune n'est faite.

Les repas planifiés sont un choix produit ancien : ils servent au calcul du
temps libre, et je ne le remets pas en cause. Mais affichés comme de vraies
activités, ils contredisent C1, et **le premier chiffre que voit un nouvel
utilisateur est inventé**.

| Règle | Effort |
|---|---|
| C1 | moyen, avec une décision à prendre (voir plan, point 11) |

### R5 · L'émoji sert de système d'icônes (défaut visuel, pas une panne)

Le JSX contient **130 émojis distincts, en 359 occurrences** : barre
d'onglets, boutons d'en-tête (🔄 🌙 🔑), entrées de menu, titres de feuilles
(✈️ Nouveau voyage, 🔗 Partager le voyage, 📊 Bilan du voyage), boutons
(🚀 Créer). Les conséquences :

- l'app change de visage selon le téléphone, car Apple, Google et Samsung
  dessinent chacun leurs émojis ;
- un émoji ne se teinte pas : impossible de marquer un état actif ou de
  suivre le thème sombre ;
- l'onglet Planning affiche 📅 « 17 juillet » toute l'année. Le projet a déjà
  retiré cet émoji du bouton d'assignation pour exactement cette raison
  (« tous en portent un quantième ») ;
- certains disent faux : 🚗 pour « Billets de train ».

Linear, Raycast et Apple utilisent une seule famille d'icônes monochromes, au
même trait, en `currentColor`. L'émoji garde sa place là où il est un
**contenu** choisi par l'utilisateur : émoji du voyage, drapeau, catégorie,
voyageurs.

| Effort |
|---|
| moyen à gros, progressif : barre d'onglets et en-tête d'abord |

---

## 🟡 Frictions UX (test d'un nouvel utilisateur)

Point de départ : un téléphone vierge, aucun voyage, aucun compte.

### F1 · Quatre diapositives avant de voir l'app, dont deux promesses fausses

- La première dit « Toutes tes données… pas besoin de compte ». Partager dit
  ensuite « Il faut un compte pour inviter ».
- « Glisse-la pour fait ou skip » : la frise du Planning, premier endroit où
  l'on voit ses activités, n'a aucun geste de glissement. `TimelineView`
  n'en gère aucun ; il n'existe que dans le détail du jour.
- « Colle un lien Google Maps » : l'usage majoritaire noté est TikTok.
- Puis l'accueil vide redit « Bienvenue sur Provo ! », sous un titre
  « EN COURS & À VENIR » posé sur rien, avec deux boutons pour la même action
  (« Créer mon premier voyage » et la pastille flottante « Nouveau voyage »).

**Proposé** : supprimer le carrousel. L'état vide sert d'accueil, avec une
phrase et un bouton. Les gestes s'apprennent sur place, une seule fois, par
une bulle à la première activité.

### F2 · Le cœur du produit a l'état vide le plus pauvre

La Réserve vide affiche « Boîte à idées vide · Glisse des activités ici ou
clique + pour en ajouter ». Plusieurs problèmes :

- aucun bouton ;
- « clique » sur un téléphone ;
- un troisième nom pour la même chose (Réserve, Boîte à idées, vivier) ;
- pas un mot sur ce qui fait la force de Provo : coller un lien TikTok, un
  lien Maps ou une confirmation.

**Proposé** (A7, aucun élément nouveau) : l'état vide porte la commande
« Coller » qui existe déjà dans la rangée de la Réserve, avec une ligne
d'exemple.

### F3 · Le chrome mange l'écran

- **Réserve** : la première idée commence à 245 px, soit 29 % de l'écran ;
  3 fiches seulement sont visibles en entier.
- **Planning** : 131 px d'en-tête et 74 px de barre d'onglets, soit 205 px
  (24 %). Puis **342 px vides sous la carte du jour** (40 % de l'écran) sur le
  jeu de référence.
- La pastille « 700 € restants » occupe une rangée entière, à côté de rien,
  sur Dépenses et Réserve.
- « 📍 Vienne » répète le nom du voyage quand le nom et la destination sont
  identiques.

**Proposé** : faire passer le solde dans la ligne de sous-titre, à la place
de la destination quand elle répète le nom. Cela rend environ 56 px au contenu
sur trois onglets.

Pour le vide du Planning, je ne propose rien d'office : c'est la conséquence
de la frise horizontale, et c'est à toi de dire si on y réfléchit.

### F4 · Une activité dit trois fois sa catégorie

- **Rangée de la frise** : poignée ⠿, barre de couleur, heure, émoji, titre,
  ▾.
- **Fiche de la Réserve**, jusqu'à 9 éléments : vignette, émoji, point de
  couleur, titre, durée et prix, état, « N infos à compléter » souligné,
  adresse soulignée, ＋, ⋯.

La catégorie y est dite par l'émoji, le point coloré **et** le titre de
section. Deux liens soulignés par fiche donnent un air de page web ancienne.
En vue liste, « Café bel étage » passe sur deux lignes faute de place.

**Proposé** :

- une seule marque de catégorie, l'émoji ;
- l'adresse sans soulignement ;
- la poignée allégée. Elle reste le geste unique décidé, simplement moins
  appuyée.

### F5 · La langue et le ton changent d'un écran à l'autre

- Des anglicismes et du jargon : « Timeline », « Nogo » (`helpers.js:256`),
  « skip ».
- « ▼ Descendre » dans le menu d'une activité.
- « clique » sur un téléphone.
- Un vouvoiement, « Vous êtes plusieurs ? » (`ExpensesTab.jsx:679`), dans une
  app au tutoiement.
- Le bouton « Timeline › » affiche la vue en cours mais bascule vers
  « Agenda » : on ne sait pas si on lit un état ou une action.

**Proposé** :

- un contrôle segmenté à deux choix, « Frise · Grille », à la manière d'iOS ;
- « Annulée » au lieu de « Nogo », « Plus tard » au lieu de « skip » ;
- la phrase des Dépenses au tutoiement.

### F6 · La barre d'onglets affiche des chiffres qui ne demandent rien

Trois onglets sur quatre portent un badge (16, 2, 8). Ces badges ont la forme
d'une notification non lue, mais ne sont que des totaux. Un nouvel
utilisateur voit « 10 » sur un voyage vide. Les libellés font 10,9 px.

**Proposé** : retirer les compteurs, puisque le contenu de l'onglet les donne
déjà (A6). Ne garder un point que pour ce qui demande une action.

---

## 🟢 Delight & polish

### P1 · La typographie change avec le réseau

- Inter vient de Google Fonts, que le service worker ne garde pas :
  `public/sw.js:86` ignore tout ce qui ne vient pas de l'origine de l'app.
  Hors ligne, au premier lancement sans réseau et dans l'APK, on a donc la
  police système ; en ligne, Inter.
- Six graisses sont chargées (400 à 900) pour trois utilisées.
- Mes captures sont d'ailleurs en police de secours.

**La solution la plus « Apple »** : la pile système. `-apple-system` donne SF
Pro sur iPhone et Roboto sur Android : aucun téléchargement, rendu natif.

**Sinon** : Inter en police variable, hébergée par l'app et précachée.

Je ne suis pas certain de l'état actuel du droit sur un point : charger une
police depuis Google transmet l'adresse IP du visiteur, et un tribunal
allemand l'a sanctionné en 2022. Tu devrais vérifier si ça te concerne.

### P2 · Le bleu « glossy »

La feuille compte **31 dégradés**, dont le fond de la page lui-même : bleu
vers bleu clair, avec une `transition: background 2s`. Chaque bouton principal
cumule en plus :

- un reflet intérieur ;
- une ombre colorée ;
- une ombre portée sur le texte (`text-shadow`, hérité de `.btn`).

Apple, Linear et Vercel utilisent des aplats et une seule élévation par
niveau.

**Proposé** :

- des aplats `--accent-deep` ;
- une ombre neutre ;
- plus aucun `text-shadow` ;
- un seul dégradé toléré, la couverture du voyage.

### P3 · Un mouvement sans grammaire

La feuille utilise 29 durées et 14 courbes d'animation.

**Proposé** :

- 3 durées : 120, 200 et 320 ms ;
- 2 courbes : une sortie standard, et le ressort des feuilles. La courbe iOS
  `cubic-bezier(.32,.72,0,1)` est déjà dans le fichier ;
- `transition: all` interdit.

La réduction de mouvement est déjà respectée : on la garde.

### P4 · Les petites incohérences qui font « brouillon » (B2)

- Deux glyphes de menu : ⋮ sur la carte de voyage, ⋯ partout ailleurs.
- Dans l'en-tête, un ＋ rond en dégradé est posé à côté d'un ⋯ carré blanc.
  En thème sombre, le ＋ devient blanc : la hiérarchie s'inverse d'un thème à
  l'autre.
- La recherche de l'accueil s'étend de 68 à 323 px, alors que toute la grille
  va de 16 à 374 px.
- Partager a un ✕ **et** un bouton « Fermer ». Ses deux sections répètent le
  libellé de leur bouton : « Envoyer une copie » apparaît deux fois.

### P5 · Trois moments qui méritent du soin (utile, pas décoratif)

- **Cocher « fait »**, le geste le plus répété du voyage : une coche qui se
  dessine en 200 ms, et le titre qui s'estompe.
- **Les feuilles** : ouverture au ressort iOS. Une feuille porte déjà une
  poignée en haut ; je n'ai pas vérifié si elle se ferme en glissant vers le
  bas.
- **Le Bilan** : le pourcentage qui monte jusqu'à sa valeur à l'ouverture.

---

## 🛠️ Plan d'action technique

**Préalable.** Provo n'utilise pas Tailwind : `package.json` n'en contient
aucune trace, et tout le style tient dans une feuille CSS de 7 638 lignes.
Migrer vers Tailwind voudrait dire réécrire chaque composant, pour un gain
qu'on obtient avec des jetons. Je propose de garder le CSS et de lui donner
**une source unique**.

### Lot 1 · Les défauts mesurés (environ une demi-journée, sans question de goût)

1. **`src/hooks/useTrips.js:591`** (`createTrip`) : ajouter
   `color: data.color || null,`.
2. **`src/components/NewTripModal.jsx:124`** : remplacer la grille en ligne
   `gridTemplateColumns: '1fr 1fr'` par
   `'minmax(0, 1fr) minmax(0, 1fr)'`, et donner aux deux champs date
   `width: '100%'`.
3. **`src/index.css`**, dans la couche finale :

   ```css
   .btn { text-shadow: none; }
   .btn--primary, .fab__btn, .header__add-btn {
     background: var(--accent-deep);     /* blanc dessus : 4,59:1 */
     color: #fff;
     box-shadow: var(--shadow-sm);
   }
   .today-hero { background: var(--accent-deep); }
   .tab-btn--active {
     background: color-mix(in srgb, var(--accent) 14%, transparent);
     color: var(--accent-texte);          /* 4,74:1 clair, 7,26:1 sombre */
   }
   .tl-day__label { color: var(--text-muted); }  /* 4,74:1 ; l'accent reste sur la bordure */
   ```

4. **Les mots** :

   | Fichier | Avant | Après |
   |---|---|---|
   | `src/pages/TripView.jsx:685` | « Timeline » | « Frise » |
   | `src/utils/helpers.js:256` | « Nogo » | « Annulée » |
   | `src/components/ActivityCard.jsx:345` | « Descendre » | « Plus bas » |
   | `src/components/ExpensesTab.jsx:679` | « Vous êtes plusieurs ? » | « Tu voyages à plusieurs ? » |

   Les parcours qui visent ces libellés sont à mettre à jour (E4).

### Lot 2 · La sonde et le premier contact (environ une journée)

5. **`scripts/verif-ui.mjs`** : mesurer aussi les fonds en dégradé, avec la
   méthode utilisée pour ce rapport :
   - capturer l'élément ;
   - garder les pixels éloignés de la couleur du texte ;
   - calculer le contraste médian, et le compter en défaut sous le seuil.

   La sonde doit d'abord rougir sur le code actuel (onglet actif à 2,66:1).
   Ajouter aussi les écrans « Nouveau voyage », « Accueil vide », « Réserve
   vide » et « Dépenses vide ».
6. **`src/components/OnboardingOverlay.jsx`** : le supprimer, ainsi que son
   appel dans `src/App.jsx:191`.
7. **`src/pages/Dashboard.jsx`** : un état vide à un seul bouton. Pas de titre
   de section tant qu'il n'y a rien dessous.
8. **`src/components/NewTripModal.jsx`** :
   - destination obligatoire, en premier, puis les dates ;
   - nom prérempli depuis la destination ;
   - budget, voyageurs, couleur, émoji et photo repliés sous « Plus
     d'options ». `TripSettingsSheet.jsx` gère déjà couleur et voyageurs
     (lignes 53 et 71) ;
   - passage en feuille plein écran.
9. **`src/pages/TripView.jsx:1317`** (Réserve vide) : un bouton
   « 📋 Coller un lien » qui appelle le même gestionnaire que la commande
   existante, et le mot « Réserve » partout.
10. **`src/pages/TripView.jsx:1148-1172`** : retirer les `tab-badge` qui ne
    sont que des totaux.
11. **Les repas (décision à toi)**, deux options :
    - **(a)** ils restent des créneaux de temps, mais ne comptent ni dans les
      badges, ni dans l'estimé tant qu'ils ne sont pas confirmés, ni dans le
      Bilan (`TripRecap.jsx:36`, filtrer `!a.isMeal`) ;
    - **(b)** une case « Prévoir midi et soir » à la création.

    Je recommande (a) : elle ne change rien au calcul du temps libre.

### Lot 3 · Un seul design system (progressif, 2 à 3 jours)

12. **`src/styles/tokens.css`** (nouveau, importé avant `index.css` dans
    `src/main.jsx`) : chaque jeton déclaré **une fois**.

    ```css
    :root {
      /* Espacement : grille de 4 */
      --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px;
      --s-5: 20px; --s-6: 24px; --s-8: 32px;
      /* Élévation : trois niveaux, ombre neutre */
      --e-1: 0 1px 2px rgb(16 24 40 / .06), 0 0 0 1px rgb(16 24 40 / .04);
      --e-2: 0 4px 12px rgb(16 24 40 / .08);
      --e-3: 0 12px 32px rgb(16 24 40 / .14);
      /* Mouvement */
      --d-1: 120ms; --d-2: 200ms; --d-3: 320ms;
      --ease: cubic-bezier(.2, .8, .2, 1);
      --ease-feuille: cubic-bezier(.32, .72, 0, 1);
      /* Calques */
      --z-colle: 10; --z-barre: 100; --z-voile: 400;
      --z-feuille: 500; --z-message: 800; --z-urgence: 900;
      /* Police */
      --police: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif;
    }
    ```

    Y ajouter les couleurs, clair et sombre, reprises de la couche finale
    actuelle (`--surface*`, `--text*`, `--border*`, `--accent*`, couleurs
    sémantiques), avec `--t-*` et `--radius-*` qui existent déjà.
13. **`src/index.css`** : supprimer les couches mortes une par une (APPLE
    DESIGN SYSTEM, PROVO 2.0, DESIGN 2.0…), en commençant par leurs blocs
    `:root` et `[data-theme]`, et retirer les commentaires faux. Après chaque
    couche : `verif-ui` dans les deux thèmes et captures avant/après
    comparées.
14. **`scripts/verif-jetons.mjs`** (nouveau, branché dans `npm run verif`) :
    compter hors de `tokens.css` les hex, rgba, ombres, durées, z-index et
    `!important`, avec un plafond qui ne peut que baisser, comme `verif-lint`.
    Plafonds de départ : 316 hex, 91 ombres, 68 `!important`.
15. **`index.html`** : retirer les trois balises Google Fonts.
16. **`src/components/Icone.jsx`** (nouveau) : une vingtaine d'icônes SVG
    monochromes (grille de 24, trait de 1,75, `currentColor`), d'abord pour la
    barre d'onglets et l'en-tête, puis pour les menus. Source possible :
    Lucide, sous licence ISC il me semble (à vérifier), avec les SVG copiés
    dans le dépôt plutôt qu'une dépendance.

---

## Recommandation : par où commencer

1. **Le lot 1** (R1 contraste, R3 couleur et dates). Ce sont des défauts
   mesurés, sans question de goût ni risque : une demi-journée.
2. **La sonde des dégradés** (point 5). Sans elle, R1 reviendra : c'est la
   sixième fois qu'un cas qu'aucun outil ne regarde cache un défaut.
3. **Le premier contact** (F1 et F2). C'est là que se joue l'adoption, et ça
   **retire** du code au lieu d'en ajouter (A7).

Le lot 3 est le plus rentable à long terme, mais aussi le plus long : à faire
couche par couche, chacune vérifiée.

## Règles candidates pour le playbook (via /lecon)

- **B1, corollaire** : une sonde qui renvoie « à l'œil » ce qu'elle ne sait pas
  mesurer doit l'échantillonner au pixel. Sinon, l'élément le plus vu de l'app
  (l'onglet actif) sort de toute mesure.
- **Nouvelle règle B6** : l'émoji est du contenu, l'icône est du chrome. Les
  contrôles de l'interface utilisent une seule famille d'icônes, teintable ;
  l'émoji reste réservé à ce que l'utilisateur choisit lui-même.
