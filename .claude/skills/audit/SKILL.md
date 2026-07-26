---
name: audit
description: Audite l'application du projet courant contre le playbook UX/UI partagé et propose des améliorations classées. Utiliser quand l'utilisateur demande des propositions d'amélioration, un audit d'interface, « qu'est-ce qu'on pourrait améliorer », ou invoque /audit. Ne modifie aucun code.
---

# Audit UX/UI contre le playbook partagé

Produit une liste d'améliorations **classées et argumentées** pour le projet
courant. **Ne modifie aucun code** : l'utilisateur choisit, ensuite on implémente.

## 1 · Charger la mémoire

Lire dans cet ordre :

1. `.claude/ux-playbook.md` — les règles, communes à tous les projets.
2. `.claude/project-notes.md` — ce qui est déjà fait ici, et ce qui a été
   **sciemment écarté**.
3. Le `CLAUDE.md` du projet — le principe produit directeur.

**Ne jamais reproposer** ce que « Écarté sciemment » liste. C'est la faute qui
détruit la confiance dans cette routine.

## 2 · Regarder l'application, pas seulement le code

Une lecture de code ne révèle pas un bouton invisible ni une cible de 6 px
(règles E1, E3). Lancer l'app et la parcourir :

- Construire et servir (voir « Vérification standard » dans `project-notes.md`).
- Playwright sur le plus petit écran cible, **thème clair et thème sombre**.
- Capturer chaque écran principal, et les états qu'on ne voit pas au repos :
  listes vides, listes longues, modales, formulaires ouverts.
- Mesurer plutôt que supposer : `getBoundingClientRect`, `elementFromPoint` sur
  chaque cible tactile, contraste calculé, débordement horizontal.

Si l'app ne peut pas être lancée, le dire franchement et auditer sur le code
seul — en signalant que la partie visuelle n'a pas été vérifiée (F4).

## 3 · Confronter aux règles

Parcourir les sections A à F du playbook. Pour chaque écart réel constaté,
noter : la règle, ce qui a été observé (avec le chiffre mesuré si applicable),
et l'effet sur l'utilisateur.

Regarder en priorité les **récidives** listées en fin de playbook : ce sont les
thèmes sur lesquels ce projet — ou l'utilisateur — se fait piéger le plus souvent.

Chercher aussi ce que le playbook ne couvre pas encore : un problème nouveau est
une future règle, à passer par `/lecon`.

## 4 · Restituer

Trois sections, dans cet ordre :

**À corriger** — écarts constatés, du plus gênant au moins gênant. Une ligne
par écart : ce qui cloche, la règle, le correctif proposé, l'effort (petit /
moyen / gros).

**À ajouter** — fonctionnalités qui découlent du principe produit du projet.
Chacune justifiée par ce qu'elle enlève comme effort à l'utilisateur.

**Écarts non couverts par le playbook** — le cas échéant, proposer la règle à
ajouter.

Règles de restitution :

- **Chiffrer.** « La cible fait 6 px sur 390 » vaut mille fois « c'est petit ».
- **Maximum 8 propositions.** Une liste de 20 ne se lit pas — c'est le
  problème même qu'on corrige chez l'utilisateur (A3).
- **Recommander.** Terminer en désignant les 2 ou 3 à faire en premier, et
  pourquoi.
- Ne pas commencer à implémenter sans que l'utilisateur ait choisi.
