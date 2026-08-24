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
| A-011 | 2026-08-03 | Sécurité | `origineAutorisee` rend `true` quand l'en-tête `Origin` est absent : le garde-fou n°1 de la clé Anthropic ne filtre que les navigateurs, jamais un script (`extract-place/index.ts:737-743`) | Majeur | PROPOSÉ |
| A-012 | 2026-08-03 | Fiabilité | Chaîne d'appels séquentiels sans budget global côté fonction Edge (jusqu'à ~82 s pour un lien TikTok) et aucun plafond côté client sur `extractViaEdge` | Majeur | PROPOSÉ |
| A-013 | 2026-08-03 | Fiabilité | `ai.title` est le seul titre du fichier à ne pas passer par `cleanTitle()` : la sortie du modèle atterrit brute dans la fiche (`index.ts:636`) | Mineur | PROPOSÉ |
| A-014 | 2026-08-03 | Fiabilité | `resolve()` systématique sur TikTok alors que le dépôt a mesuré que la page renvoie un captcha depuis un serveur : jusqu'à 10 s perdues par import (`index.ts:596`) | Mineur | PROPOSÉ |
| A-015 | 2026-08-03 | Fiabilité | `fetchPlaceData` appelait `res.json()` sans vérifier `res.ok` : le 429 de Nominatim levait au lieu de rendre `null` | Mineur | CORRIGÉ |
| A-016 | 2026-08-03 | Dette technique | Liaison morte `finalUrl` dans `handleGeneric`, neutralisée par un `void` | Mineur | CORRIGÉ |
| A-017 | 2026-08-10 | Sécurité | `push_subscriptions` : politique UPDATE sans `WITH CHECK` (vérifié en production). Un compte connecté réaffecte sa propre ligne à l'`user_id` d'un autre : `push-tick` lui pousse alors les titres et adresses des activités de l'autre | Majeur | PROPOSÉ |
| A-018 | 2026-08-10 | Sécurité | `read-booking`, `read-receipt` et `enrich-place` n'appellent pas `origineAutorisee` : la clé Anthropic est dépensable par quiconque lit la clé publiable du bundle (`read-receipt` accepte 1,5 Mo d'image par appel) | Majeur | PROPOSÉ |
| A-019 | 2026-08-10 | Sécurité | `enrich-place` : le garde-fou SSRF ne valide que l'URL initiale, `lirePage` suit ensuite les redirections sans revérifier (`index.ts:146`) | Majeur | PROPOSÉ |
| A-020 | 2026-08-10 | Fiabilité | Photo de ticket que le navigateur ne sait pas décoder : `reduireImage` rejette, `lireLeRecu` n'avait qu'un `finally` — écran muet (`ExpensesTab.jsx:287`) | Mineur | CORRIGÉ |
| A-021 | 2026-08-10 | Dette technique | Deux directives `eslint-disable` mortes, signalées par ESLint lui-même | Mineur | CORRIGÉ |
| A-022 | 2026-08-10 | Méthode | `.audit/contexte.md.` (point final parasite) subsiste et a divergé de `contexte.md` : deux mémoires d'audit, dont une périmée | Mineur | PROPOSÉ |
| A-017 | 2026-08-10 | Sécurité | **Faux positif.** `with_check: null` n'est pas l'absence de contrôle : PostgreSQL précise que pour une politique `UPDATE` sans `WITH CHECK`, l'expression `USING` sert AUSSI de contrôle sur la nouvelle ligne. `using (auth.uid() = user_id)` fait donc échouer la réaffectation à l'`user_id` d'un autre. La lecture de `pg_policies` était juste, son interprétation non — et l'attaque n'avait pas été exercée, ce qui était précisément le cas où ça comptait. Raison inscrite dans `supabase/migrations/20260806_push_subscriptions.sql`, avec sa condition de réfutation | Sans objet | REFUSÉ |
| A-018 | 2026-08-10 | Sécurité | `origineAutorisee` posé sur `read-booking`, `read-receipt` et `enrich-place`. Il vit désormais dans `supabase/functions/_shared/origine.ts`, importé par les quatre fonctions au lieu d'être recopié — c'est la recopie qui l'avait laissé derrière. Le fichier dit aussi ce que le contrôle NE couvre pas : `Origin` n'est imposé que par les navigateurs, un appel forgé peut l'omettre | Majeur | CORRIGÉ |
| A-019 | 2026-08-10 | Sécurité | Redirections suivies à la main, chaque saut repassant par `urlSure`, cinq au plus. `scripts/verif-redirections.mjs` (7 cas) vérifie que l'adresse interne n'est **jamais jointe**, pas seulement que la réponse est nulle. Limite annoncée dans le code : un nom d'hôte public qui *résout* vers une adresse interne n'est pas couvert | Majeur | CORRIGÉ |
| A-023 | 2026-08-17 | Sécurité | `extract-place` n'a **aucun** garde-fou SSRF, là où `enrich-place` en a un depuis A-019. Le corps de requête donne l'URL, seul `/^https?:\/\//` la filtre, puis `fetchOnce` la joint en `redirect: "follow"` (`index.ts:264`). `urlSure`/`PRIVE` ne vivent que dans `enrich-place`, ils n'ont pas été partagés comme l'a été `origineAutorisee` | Majeur | PROPOSÉ |
| A-024 | 2026-08-17 | Fiabilité | La liste des dépenses divise encore à parts égales (`eurAmt / n`, `ExpensesTab.jsx:696`) alors que soldes, dettes et feuille voyageur passent par `partEnEuros` depuis c17be9e. Le calcul était écrit **quatre** fois, pas trois : l'écran le plus lu contredit les trois autres sur une dépense à parts inégales | Majeur | PROPOSÉ |
| A-025 | 2026-08-17 | Fiabilité | Retirer un voyageur ne le retire que de `tripTravelers` (`TripSettingsSheet.jsx:98`) : son id reste dans `participantIds`, sa part reste comptée, et `calcDebts` crée une entrée hors liste. Le panneau des dettes affiche alors une ligne au nom d'un identifiant technique (`getName` retombe sur l'id brut) | Majeur | PROPOSÉ |
| A-026 | 2026-08-17 | Fiabilité | Quatre accès non gardés à `exp.participantIds` dans le **rendu** (liste des dépenses, feuille par voyageur), alors que `calcDebts`/`calcBalances` se gardent depuis longtemps avec un commentaire qui dit pourquoi. La garde des calculs ne protège pas le rendu | Mineur | CORRIGÉ |
| A-023 | 2026-08-24 | Sécurité | Clos. `urlSure` vit maintenant dans `supabase/functions/_shared/reseau.ts` et `extract-place` l'importe (deux occurrences dans `index.ts`). Le garde-fou SSRF est partagé comme l'est l'origine — livré par `2187348` (#73) | Majeur | CORRIGÉ |
| A-024 | 2026-08-24 | Fiabilité | Clos. `ExpensesTab.jsx:1113` calcule encore `eurAmt / n`, mais ne l'affiche plus que sur un partage ÉGAL ; à parts inégales la ligne montre `partEnEuros(exp, me.id)`. Livré par `118b1cc` (#71), jamais consigné ici | Majeur | CORRIGÉ |
| A-025 | 2026-08-24 | Fiabilité | Clos. `voyageSansVoyageur` (`helpers.js:1477`) retire l'id des `participantIds` et des `parts` en plus de `tripTravelers` — livré par `2187348` (#73) | Majeur | CORRIGÉ |
| A-027 | 2026-08-24 | Fiabilité | Ouverte par une notification (`?voyage=…`), l'app ne rend plus la main : l'effet de `App.jsx:148-153` re-navigue vers le voyage à chaque fois que `route.page` repasse à `dashboard`, et `pendingVoyage` n'est jamais consommé. « Retour » est inopérant jusqu'au rechargement | Majeur | PROPOSÉ |
| A-028 | 2026-08-24 | Fiabilité | Aucun contrôle automatique nulle part : ni `eslint`, ni `vite build`, ni `verif-calcul.mjs` (45 cas) ni `verif-notif-depense.mjs` (13 cas) ne tournent sur push ou sur PR. Les huit workflows sont des déploiements ou des diagnostics. `deploy-edge-functions.yml` pousse `supabase/functions/**` en production à chaque push sur `main` | Majeur | PROPOSÉ |
| A-029 | 2026-08-24 | Fiabilité | Le champ « Quand » s'écrit et ne se lit nulle part : aucun écran n'affiche `expense.date`, la liste rend `trip.expenses` dans l'ordre d'insertion (`ExpensesTab.jsx:285`). Et `date: form.date \|\| undefined` (`:559`) traverse le patch `{...e, ...patch}` de `updateExpense` : vider le champ efface la date au lieu de la conserver | Mineur | PROPOSÉ |
| A-030 | 2026-08-24 | Fiabilité | Rouvrir une dépense à parts inégales déplace des centimes : `openEditForm` normalise les parts et les arrondit au centième (`:365`), `handleAdd` les recalcule (`:543`). 100 € partagés 70/30 rouverts puis réenregistrés sans rien changer donnent 69,97 / 30,03 | Mineur | PROPOSÉ |
| A-031 | 2026-08-24 | Sécurité | Supabase Auth : la vérification des mots de passe compromis (HaveIBeenPwned) est désactivée — relevé par l'advisor `auth_leaked_password_protection`. L'e-mail/mot de passe est la seule authentification du projet | Mineur | PROPOSÉ |
| A-032 | 2026-08-24 | Dette technique | Trois champs du formulaire de dépense (Titre, Montant, Quand) portaient un `<label>` associé à rien : sans nom accessible sur l'écran de saisie d'argent | Mineur | CORRIGÉ |
| A-033 | 2026-08-24 | Dette technique | Le sélecteur Dépense/Revenu/Transfert annonçait `role="tablist"`/`role="tab"` sans aucun `tabpanel` associé | Mineur | CORRIGÉ |
| A-034 | 2026-08-24 | Dette technique | « Il reste 0.01 % à répartir » : point décimal dans un message bloquant, en français | Mineur | CORRIGÉ |

<!--
Exemple de ligne, à supprimer :
| A-001 | 2026-08-03 | Sécurité | Route /api/export accessible sans vérification de session | Critique | CORRIGÉ |
-->

## Dernier audit effectif

Date : 2026-08-24
Type : LÉGER (7 jours écoulés, 6 commits significatifs, +2 045 lignes — sous les
deux seuils : moins de 3 semaines, moins de 40 commits)
Axes : Sécurité, Fiabilité. Pas d'axe rotatif en audit LÉGER.
Prochain axe rotatif : Performance et coûts (toujours pas consommé, quatrième
audit d'affilée — le calendrier n'a jamais atteint le seuil STANDARD)
Référence ESLint à la date de l'audit : **52 erreurs, 4 avertissements** —
inchangé depuis le 2026-08-10, dette non aggravée malgré +2 045 lignes.
`npm run build` passe. `verif-calcul.mjs` (45 cas) et `verif-notif-depense.mjs`
(13 cas) passent.
Note de méthode : trois constats ouverts depuis le 2026-08-17 (A-023, A-024,
A-025) étaient en fait corrigés dans le code sans avoir été consignés ici. Le
journal ne se met pas à jour tout seul quand un correctif part dans une PR qui
ne le mentionne pas.

### Audit précédent

Date : 2026-08-17
Type : LÉGER (7 jours écoulés, 3 commits significatifs : les deux correctifs de
sécurité de l'audit précédent, jamais relus par personne d'autre, et `#70`
« Parts inégales », qui touche le calcul de l'argent)
Axes : Sécurité, Fiabilité. Pas d'axe rotatif en audit LÉGER.
Prochain axe rotatif : Performance et coûts (toujours pas consommé)
Référence ESLint à la date de l'audit : **52 erreurs, 4 avertissements** —
inchangé depuis le 2026-08-10, dette non aggravée. `npm run build` passe.

### Audit précédent

Date : 2026-08-10
Type : PROFOND (7 jours écoulés seulement, mais **89 commits** sur `main` depuis
le 2026-08-03, dont quatre nouvelles fonctions Edge et une nouvelle table —
au-delà du seuil de 40 commits, la profondeur ne se décide plus au calendrier)
Dernier axe rotatif couvert : Produit et UX (au 2026-08-10, dans le cadre PROFOND)
Prochain axe rotatif : Performance et coûts
Référence ESLint à la date de l'audit : **52 erreurs, 4 avertissements** après
correction (52 erreurs / 6 avertissements avant). La dette d'erreurs n'a pas
augmenté malgré +14 500 lignes ; les deux avertissements de plus étaient des
directives `eslint-disable` mortes, retirées ici.

### Historique

| Date | Type | Axes | Constats retenus |
|---|---|---|---|
| 2026-07-29 | PROFOND | Tous + roadmap | A-001 à A-010 |
| 2026-08-03 | LÉGER | Sécurité, Fiabilité | A-011 à A-016 |
| 2026-08-10 | PROFOND | Tous + roadmap | A-017 à A-022 |
| 2026-08-17 | LÉGER | Sécurité, Fiabilité | A-023 à A-026 |
| 2026-08-24 | LÉGER | Sécurité, Fiabilité | A-027 à A-031 (+ A-032 à A-034 corrigés) |
