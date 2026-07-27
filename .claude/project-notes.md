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
