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
| C1 · Phrase, pas données | « Sam doit 60 € à Alex » |
| C2 · Chemin direct | Dépense sans activité associée |
| C3 · Complétion auto | `src/utils/enrich.js` — Nominatim puis Overpass |
| C4 · Point de vue connecté | Solde personnel via `profileId` |
| D1 · Proposer en pop-up | Piochage, itinéraire plus court |
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
