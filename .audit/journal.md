# Journal d'audit

Registre en ajout seul. Ne jamais réécrire une entrée existante : on ajoute une
nouvelle ligne avec le statut mis à jour, on ne modifie pas l'historique.

## Statuts

| Statut | Signification |
|---|---|
| CORRIGÉ | Traité et fusionné |
| PROPOSÉ | Constat remonté, en attente d'arbitrage |
| REPORTÉ | Vu, accepté sur le principe, pas maintenant |
| REFUSÉ | Volontairement écarté. Ne doit plus jamais être remonté, sauf passage en sévérité Critique |
| PASSÉ | Audit non déclenché faute de commits significatifs |

## Axes

Sécurité et données, Fiabilité, Performance et coûts, Dette technique, Produit et UX.

Rotation de l'axe secondaire : Performance et coûts, puis Dette technique, puis
Produit et UX, puis retour au début.

## Registre

| ID | Date | Axe | Constat | Sévérité | Statut |
|---|---|---|---|---|---|
| INIT | AAAA-MM-JJ | - | Création du journal, aucun audit effectué | - | - |
| A-001 | 2026-07-29 | Sécurité | `shared_trips` : RLS `public_read`/`public_update` en `USING (true)` + droits `anon` — n'importe qui lit et réécrit tous les voyages partagés | Critique | PROPOSÉ |
| A-002 | 2026-07-29 | Fiabilité | Écriture Supabase échouée marquée comme synchronisée, puis écrasée par le nuage au chargement suivant (`useTrips.js`) | Critique | CORRIGÉ |
| A-003 | 2026-07-29 | Fiabilité | Devise convertie à 1:1 quand le taux manque : `eurAmount` faux, persisté définitivement (`useCurrencyRates.js:59`) | Majeur | PROPOSÉ |
| A-004 | 2026-07-29 | Sécurité | Retirer un membre ne révoque pas son accès : le code d'invitation du propriétaire reste valide (`join_trip_by_invite`) | Majeur | PROPOSÉ |
| A-005 | 2026-07-29 | Fiabilité | Quota localStorage dépassable par une seule pièce jointe (PDF 3 Mo en base64), échec silencieux | Majeur | CORRIGÉ (journalisation) / PROPOSÉ (dimensionnement) |
| A-006 | 2026-07-29 | Sécurité | `extract-place` : récupération d'URL arbitraire invocable par quiconque lit le bundle, dépense l'`ANTHROPIC_API_KEY` | Majeur | PROPOSÉ |
| A-007 | 2026-07-29 | Sécurité | `trips.member_update` sans `WITH CHECK` distinct : un collaborateur peut réécrire `owner_id` et déposséder le propriétaire | Mineur | PROPOSÉ |
| A-008 | 2026-07-29 | Fiabilité | Suppression d'un voyage par un collaborateur refusée en silence, voyage « zombie » au rechargement | Mineur | CORRIGÉ (journalisation) / PROPOSÉ (interface) |
| A-009 | 2026-07-29 | Dette technique | Neuf boutons de fermeture ✕ sans nom accessible | Mineur | CORRIGÉ |
| A-010 | 2026-07-29 | Méthode | `.audit/contexte.md.` (point final parasite) : le fichier de contexte n'est pas lu sous son nom attendu | Mineur | CORRIGÉ (copie créée) |

<!--
Exemple de ligne, à supprimer :
| A-001 | 2026-08-03 | Sécurité | Route /api/export accessible sans vérification de session | Critique | CORRIGÉ |
-->

## Dernier audit effectif

Date : 2026-07-29
Type : PROFOND (premier audit effectif ; 133 commits, aucun passage antérieur)
Dernier axe rotatif couvert : Dette technique
Prochain axe rotatif : Produit et UX
Référence ESLint à la date de l'audit : 53 erreurs, 3 avertissements
(54 avant l'audit — une erreur `no-empty` corrigée au passage)
