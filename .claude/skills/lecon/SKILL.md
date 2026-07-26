---
name: lecon
description: Transforme un retour utilisateur en règle durable dans le playbook UX/UI partagé entre projets. Utiliser après un retour, une correction ou une critique de l'utilisateur, quand il dit « retiens ça », « n'oublie pas », ou invoque /lecon. Écrit dans .claude/ux-playbook.md.
---

# Capturer une leçon dans la mémoire partagée

Transforme un retour ponctuel en règle qui servira **dans tous les projets**.
C'est le mécanisme qui fait progresser la routine ; sans lui, le playbook se
fige.

L'argument passé est le retour à traiter. Sans argument, prendre le dernier
retour ou la dernière correction de l'utilisateur dans la conversation.

## 1 · Isoler le reproche réel

Distinguer ce qui est dit de ce qui est reproché. « Il y a des boutons qui ne se
voient pas » n'est pas une demande de recolorer un bouton : c'est le constat
qu'on n'a pas vérifié le contraste sur le fond réel.

Si le retour porte sur une erreur de méthode (correctif superficiel, cause mal
diagnostiquée, vérification sautée), la leçon va en section **E**. Ce sont les
plus rentables et les plus faciles à manquer.

## 2 · Généraliser

Réécrire la règle **sans aucun terme propre au projet**. Elle doit se lire
aussi bien dans une app de voyage que dans un suivi de candidatures.

- ❌ « Le badge horaire de la timeline doit contraster. »
- ✅ « Vérifier le contraste de chaque élément interactif sur son fond réel,
  dans les deux thèmes. »

Une règle doit être **actionnable et vérifiable**. « Soigner l'UX » n'est pas
une règle. Si on ne peut pas dire d'un écran s'il la respecte ou non, elle est
mal écrite.

## 3 · Fusionner plutôt qu'empiler

Relire `.claude/ux-playbook.md` avant d'écrire :

- Règle déjà présente → **ne rien ajouter aux principes**, ajouter seulement la
  ligne au journal. Une récidive est une information : la signaler à
  l'utilisateur, c'est le signe d'un problème structurel.
- Règle existante trop vague ou incomplète → **l'affiner sur place**, ne pas en
  créer une deuxième à côté.
- Vraiment nouvelle → l'ajouter dans la section A–F qui convient, numérotée à
  la suite.

Un playbook de 60 règles ne sera pas lu. Viser la concision : si une nouvelle
règle en rend une ancienne inutile, supprimer l'ancienne.

## 4 · Écrire

Dans `.claude/ux-playbook.md` :

1. La règle, en une phrase à l'impératif, **suivie de son origine** — l'incident
   réel, cité brièvement. Une règle sans son origine devient un conseil creux.
2. Une ligne dans le **journal analytique** : date, verbatim abrégé, règle.
3. Si c'est la 3ᵉ occurrence d'un même thème, l'ajouter aux **récidives**.

Mettre aussi à jour `.claude/project-notes.md` si le projet courant vient de
corriger ou d'écarter quelque chose.

## 5 · Propager

Le playbook est dupliqué dans chaque dépôt : une règle ajoutée ici n'existe
nulle part ailleurs tant qu'elle n'est pas recopiée.

Terminer en affichant la règle dans un bloc à recopier tel quel, et rappeler à
l'utilisateur dans quels autres projets la reporter. Indiquer si elle a des
chances d'y révéler un écart existant — c'est là qu'elle a le plus de valeur.
