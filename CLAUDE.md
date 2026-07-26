# Provo

PWA de planification de voyage, en français, mobile d'abord (max 480 px).
React + Vite, Supabase (sync + collaboration), fonctionne hors ligne.

## Principe produit directeur

**On prépare un vivier d'idées avant le voyage ; pendant le voyage, on
« pioche » dans la Réserve au lieu de chercher.**

Ce n'est PAS « tout planifier à l'avance » : le programme d'une journée peut
très bien se composer le jour même. Ce qu'on veut éviter, c'est de *chercher*
sur le moment (un resto, des horaires, un prix) et de *réfléchir* à
l'optimisation.

Conséquences directes sur la conception :

- **La Réserve est le cœur du produit.** Avant le départ on y accumule des
  idées ; sur place on y pioche. Tout ce qui facilite « remplir la réserve »
  puis « piocher vite » a de la valeur.
- **Aucune fiche ne doit être incomplète.** Dès qu'une activité est ajoutée,
  l'app complète elle-même les informations manquantes (horaires, prix,
  adresse, coordonnées) en cherchant en ligne — l'utilisateur ne doit pas
  avoir à les saisir pour en bénéficier.
- **L'app est force de proposition, uniquement en pop-up.** Quand on ajoute
  une activité le jour même, elle signale ce qui compte (lieu fermé
  aujourd'hui, ça ne rentre pas dans le temps restant, c'est loin) et propose
  — elle ne réorganise jamais d'office et ne bloque rien.
- L'écran du jour répond à « qu'est-ce que je fais maintenant ? » sans lecture
  ni réflexion : peu d'informations, gros caractères, action évidente.
- Les dépenses se notent en un geste ; les calculs (partage, qui doit à qui)
  sont faits par l'app, jamais par l'utilisateur.

## Conventions

- Interface en français, tutoiement.
- Couleur de marque : bleu clair (`--accent`, avec `--orange`/`--yellow`
  conservés comme alias hérités car référencés partout dans le CSS).
  Les couleurs sémantiques restent : rouge = erreur, ambre = alerte, vert =
  montants.
- Barre du bas : 5 onglets maximum. Le secondaire va dans le menu ⋯.
- Vérifier visuellement (rendu Playwright, thèmes clair **et** sombre) avant
  de livrer une modification d'interface.

## Amélioration continue

`.claude/ux-playbook.md` est la **mémoire UX/UI partagée entre tous mes
projets** : les règles que j'ai apprises des retours utilisateur, généralisées
pour s'appliquer à n'importe quelle application. Le fichier est identique dans
chaque dépôt.

**S'y conformer par défaut** avant de dessiner ou de modifier un écran — sans
attendre qu'on le demande. Il prime sur les habitudes ; le principe produit
ci-dessus prime sur lui.

`.claude/project-notes.md` dit ce qui est déjà appliqué **ici**, et ce qui a
été écarté sciemment : ne jamais reproposer ces derniers.

Deux compétences entretiennent la boucle :

- `/audit` — audite l'app contre le playbook et propose des améliorations
  classées, sans toucher au code.
- `/lecon` — transforme un retour en règle durable, généralisée pour les
  autres projets.

Après un retour qui révèle une erreur de conception ou de méthode, proposer
`/lecon` : c'est ce qui empêche de refaire la même faute dans le projet suivant.
