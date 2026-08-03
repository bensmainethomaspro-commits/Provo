---
name: verif-ui
description: Mesure l'interface avant livraison — contraste WCAG, cibles tactiles, débordement, action hors écran, boutons sans nom, erreurs JS, dans les deux thèmes. Utiliser systématiquement avant de livrer une modification d'interface, et quand l'utilisateur demande une vérification, un contrôle d'accessibilité, ou invoque /verif-ui. Complète /audit : celui-ci juge, celui-là mesure.
---

# Vérification d'interface mesurée

`/audit` **juge** : il lit le playbook et propose des améliorations.
Ce contrôle-ci ne juge rien, il **mesure**. Les deux sont complémentaires et ne
se remplacent pas.

Il existe parce que je me suis trompé plusieurs fois en regardant au lieu de
mesurer : une barre d'onglets diagnostiquée en débordement alors qu'elle
débordait de 0 px, des barres de couleur attribuées à un `::before` alors
qu'elles venaient d'un `border-left`. Un chiffre tranche, un coup d'œil non
(playbook E2, F4).

## Quand

**Avant toute livraison qui touche l'interface.** Pas seulement quand on le
demande. C'est une étape de la livraison, comme le build et le lint.

## Comment

```bash
npm run build
(setsid npx vite preview --port 4173 --strictPort &) ; sleep 3
node scripts/verif-ui.mjs
```

Le script parcourt Accueil, Aujourd'hui, Planning, Réserve, Dépenses, Carte et
la fiche d'activité, en **thème clair et thème sombre**, sur 390 × 844 — le
plus petit écran cible. Il sort un tableau, le détail des écarts, et un code
de sortie (0 = rien à signaler).

`--json` pour exploiter la sortie, `--url` pour viser un autre serveur.

## Ce qu'il mesure

| Contrôle | Seuil | Pourquoi |
|---|---|---|
| Contraste du texte | 4,5:1 (3:1 si ≥ 24 px ou ≥ 18,66 px gras) | L'app se lit dehors, en plein soleil, sur un écran à 30 % de luminosité |
| Cibles tactiles | 44 × 44 px | Un pouce ne vise pas mieux |
| Débordement horizontal | 0 px | Une page qui part de travers casse la confiance |
| Action principale sous la ligne de flottaison | — | « Il y a des boutons qui obligent à scroller pour rien » |
| Boutons sans nom accessible | — | Un ✕ ou un ⋯ seul ne dit rien à un lecteur d'écran |
| Erreurs JavaScript | 0 | Une erreur silencieuse casse un écran sans prévenir |

## Ce qu'il ne mesure pas, et pourquoi

Le contraste n'est calculé que lorsque le fond est **uni**. Sur un dégradé ou
une photo, la couleur derrière le texte dépend de l'endroit exact où il tombe :
la machine ne peut pas trancher. Ces cas sortent dans une liste séparée
« à vérifier à l'œil », **non comptée en défaut**.

C'est délibéré. Un outil qui invente des défauts pour paraître complet ne sert
plus à rien : on cesse de le lire. Mieux vaut moins de chiffres, tous vrais.

## Lire le résultat

Un écart mesuré **n'est pas automatiquement un bug à corriger**. Le script
donne les faits ; le discernement reste au jugement :

- Une cible de 30 × 26 px sur une action rare gêne moins qu'une de 40 × 31 px
  sur l'action principale. Trier par fréquence d'usage, pas par écart au seuil.
- Un contraste de 4,35:1 pour un seuil de 4,5 se corrige d'une nuance ;
  un contraste de 1,2:1 est un texte invisible.
- Une régression par rapport à la mesure précédente compte plus qu'un écart
  ancien et connu : elle vient d'être introduite.

**Ne jamais annoncer corrigé ce qui n'a pas été remesuré** (playbook F4).
Relancer le script après correction et citer le nouveau chiffre.

## Après

Consigner dans `.claude/project-notes.md` ce qui a été corrigé, et ce qui a été
**sciemment laissé** avec la raison — pour ne pas le re-signaler à chaque fois.
Si l'écart révèle une règle absente du playbook, passer par `/lecon`.
