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
