# Provo

PWA de planification de voyage, en français, mobile d'abord (max 480 px).
React + Vite, Supabase (sync + collaboration), fonctionne hors ligne.

## Principe produit directeur

**Tout se cale AVANT le voyage. Pendant le voyage, on doit penser le moins
possible — ni à ce qu'on doit faire, ni à ce qu'on a dépensé.**

Ce principe tranche les arbitrages de conception :

- Une fonctionnalité qui demande de la saisie *pendant* le voyage est une
  dette. Si elle est indispensable, elle doit être pré-remplie, suggérée, ou
  déductible automatiquement de ce qui a été préparé en amont.
- L'écran du jour doit répondre à « qu'est-ce que je fais maintenant ? » sans
  lecture ni réflexion : peu d'informations, gros caractères, action évidente.
- Les décisions (ordre des visites, budget, qui paie quoi, quoi emporter) se
  prennent à la préparation. Sur place, l'app rappelle — elle ne fait pas
  décider.
- Toute automatisation est **proposée**, jamais imposée : une pop-up avec le
  gain concret et un refus possible (cf. suggestion d'itinéraire).

## Conventions

- Interface en français, tutoiement.
- Couleur de marque : bleu clair (`--accent`, avec `--orange`/`--yellow`
  conservés comme alias hérités car référencés partout dans le CSS).
  Les couleurs sémantiques restent : rouge = erreur, ambre = alerte, vert =
  montants.
- Barre du bas : 5 onglets maximum. Le secondaire va dans le menu ⋯.
- Vérifier visuellement (rendu Playwright, thèmes clair **et** sombre) avant
  de livrer une modification d'interface.
