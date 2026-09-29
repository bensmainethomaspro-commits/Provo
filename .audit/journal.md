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
| A-023 | 2026-08-31 | Sécurité | Clos par `2187348` : `urlSure`/`PRIVE` vivent désormais dans `supabase/functions/_shared/reseau.ts`, importé par `enrich-place` et `extract-place`. La couverture reste partielle dans `extract-place` — c'est A-027, un constat distinct | Majeur | CORRIGÉ |
| A-024 | 2026-08-31 | Fiabilité | Clos par `e37feb1` : `calcDebts` et `calcBalances` passent par `partEnEuros` (`ExpensesTab.jsx:87` et `:121`). Plus aucune division locale `montant / participantIds.length` dans `src/` | Majeur | CORRIGÉ |
| A-025 | 2026-08-31 | Fiabilité | Clos par `2187348` : `voyageSansVoyageur` (`helpers.js:1476`) retire l'id des `participantIds` et des `parts`. Il ne touche pas `payerId` — c'est A-029, un constat distinct | Majeur | CORRIGÉ |
| A-027 | 2026-08-31 | Sécurité | `extract-place` : `urlSure` n'est appelé que dans `resolve()` (`index.ts:296`). Trois chemins joignent la même URL d'appelant sans lui — `fetchOnce` en `redirect: "follow"` (`:266`), la branche `continue=` du consentement Google (`:302`), et surtout `tiktokDonneesPage`/`pageRobotSocial` (`:731`, `:661`) que `handleTikTok` appelle sur `canonical`, qui vaut `rawUrl` quand `resolve` a refusé. Le routeur teste `/tiktok\.com/i` sur l'URL entière, chemin compris : `http://10.0.0.5/tiktok.com` entre dans la branche TikTok et est joint | Majeur | PROPOSÉ |
| A-028 | 2026-08-31 | Fiabilité | `ExpensesTab.jsx:335` : `aujourdhui()` rend une date **UTC** (`toISOString().slice(0,10)`), seul endroit de `src/` à ne pas passer par `localDateStr`. Sans effet tant que `addExpense` écrasait la date ; depuis `5f0d633` elle est conservée (`useTrips.js:782`). Une dépense notée après minuit heure locale se range la veille — toute la matinée en UTC+9 | Majeur | PROPOSÉ |
| A-029 | 2026-08-31 | Fiabilité | `voyageSansVoyageur` (`helpers.js:1476`) ne nettoie pas `payerId`, et sort même en `return e` quand le retiré n'était pas participant. `calcDebts` crédite alors `bal[exp.payerId]` sur un id absent de `travelers` (`ExpensesTab.jsx:81`) : le panneau des dettes réaffiche une ligne au nom d'un identifiant technique — le symptôme exact d'A-025, par l'autre champ | Majeur | PROPOSÉ |
| A-030 | 2026-08-31 | Fiabilité | Notification de dépense tirée à la saisie (`useTrips.js:790`) alors que l'écriture part 700 ms plus tard (`:224`). `notifier-depense` relit une fois après 1 500 ms puis abandonne (`index.ts:145-151`), et l'`invoke` est un `.catch(() => {})`. Hors ligne ou en réseau lent — le terrain de l'app — la notification est perdue sans trace ni reprise | Mineur | PROPOSÉ |
| A-031 | 2026-08-31 | Dette technique | Trois liaisons mortes signalées par ESLint dans les fichiers touchés depuis le dernier audit : `CATEGORIES` (`ExpensesTab.jsx:3`), `useEffect` (`ActivityCard.jsx:1`), `signOut` (`App.jsx:16`) | Mineur | CORRIGÉ |
| A-032 | 2026-09-28 | Sécurité | `read-receipt` est **toujours déployée** chez Supabase (relevé au MCP le jour de l'audit : `status: ACTIVE`, version 5), 28 jours après son retrait du dépôt. La fonction déployée est celle d'avant : elle lit `ANTHROPIC_API_KEY`, accepte 1,5 Mo de base64 par appel et appelle le modèle payant. Les deux gestes manuels notés dans `project-notes.md` le 31 août (supprimer la fonction, retirer le secret) n'ont pas été faits | Majeur | PROPOSÉ |
| A-033 | 2026-09-28 | Sécurité | `extract-place` n'appelle `origineAutorisee` que sur la branche « légende collée » (`index.ts:1149`). La branche URL — celle qui télécharge des pages entières, jusqu'à ~80 s d'appels en chaîne — ne l'appelle nulle part. Ce n'est pas une régression du 31 août : avant, le drapeau était passé à `handleTikTok` pour gager l'appel payant, et il est parti avec lui. Seule des cinq fonctions à ne pas l'avoir, alors que `enrich-place` écrit à sa porte « elle télécharge toujours une page choisie par l'appelant, le contrôle reste » (`:365-371`) | Majeur | PROPOSÉ |
| A-034 | 2026-09-28 | Fiabilité | Le corps de la réponse est lu en entier avant d'être coupé, et hors délai : `clear()` est appelé AVANT `await r.text()` (`extract-place:281-285`, `enrich-place:183-191`), donc le plafond de 600 ko / 400 ko s'applique à une chaîne déjà entièrement en mémoire et plus aucun `AbortSignal` ne borne la lecture. `pageRobotSocial` (`:723`) n'a ni plafond ni contrôle de type. Un serveur qui annonce `text/html` et sert un gigaoctet fait tomber la fonction sur sa limite mémoire | Majeur | PROPOSÉ |
| A-035 | 2026-09-28 | Sécurité | `extract-place` valide l'URL d'entrée à la porte (A-027) mais laisse les redirections se suivre seules — `redirect: "follow"` en `:269`, `:720`, `:791`. Une URL publique qui renvoie 302 vers `http://169.254.169.254/` ou une plage privée est donc jointe, et `handleGeneric` rend au client le `og:title` et 300 caractères d'`og:description` de la page d'arrivée : lecture, pas seulement SSRF aveugle. C'est exactement A-019, corrigé dans `enrich-place` par `suivreRedirections` (chaque saut repasse par `urlSure`) et jamais porté ici | Majeur | PROPOSÉ |
| A-036 | 2026-09-28 | Performance et coûts | Le service worker re-télécharge en tâche de fond tout ce qu'il sert depuis son cache : `const fetchPromise = fetch(...)` est construit inconditionnellement avant `return cached || fetchPromise` (`public/sw.js:79-88`). Sans conséquence tant qu'il s'agissait de 800 ko de bundle ; depuis le 31 août, le moteur OCR passe par la même branche — 4,5 Mo par lecture de ticket, sur la donnée mobile d'un séjour à l'étranger. `vercel.json` n'accorde `immutable` qu'à `/assets/`, jamais à `/tesseract/` | Majeur | PROPOSÉ |
| A-037 | 2026-09-28 | Méthode | Lint stable : **49 erreurs, 4 avertissements**, identique à la référence du 2026-08-31, malgré +2 300 lignes. Dette non aggravée, rien à signaler | Sans objet | PASSÉ |
| A-038 | 2026-09-28 | Produit et UX | `.recu__msg` porte l'avancement de la lecture du ticket (trois à dix secondes) puis son résultat, sans région vive : rien n'annonce la fin à qui ne regarde pas l'écran (`ExpensesTab.jsx:750`) | Mineur | CORRIGÉ |
| A-022 | 2026-09-28 | Méthode | `.audit/contexte.md.` (point final parasite) subsiste, inchangé depuis le 2026-08-10 et toujours divergent. Rappelé sans être re-remonté : la routine n'a pas le droit de supprimer un fichier, c'est un geste d'une seconde côté propriétaire | Mineur | PROPOSÉ |

<!--
Exemple de ligne, à supprimer :
| A-001 | 2026-08-03 | Sécurité | Route /api/export accessible sans vérification de session | Critique | CORRIGÉ |
| A-039 | 2026-09-29 | Fiabilité | Repris de la PR #87 (non fusionnée, numéro libre ici) : `/parcours` rougissait tout seul le matin. « Que faire maintenant ? » exigeait que la randonnée de 9 h soit écartée alors qu'avant 11 h elle tient avant l'opéra de 20 h, et l'app a raison de la proposer | Majeur | CORRIGÉ |
| A-040 | 2026-09-29 | Fiabilité | Repris de la PR #87 : la première lecture de ticket exige 4,5 Mo de moteur que rien ne précharge. Hors ligne au premier ticket, le message accuse la photo alors que c'est le moteur qui manque | Majeur | PROPOSÉ |
| A-041 | 2026-09-29 | Performance et coûts | Repris de la PR #87 : `icon-512.png` et `apple-touch-icon.png` pèsent 673 ko chacune, plus que tout le JavaScript de l'app | Mineur | PROPOSÉ |
| A-042 | 2026-09-29 | Fiabilité | Repris de la PR #80 (numéroté A-027 là-bas, numéro déjà pris) : ouverte par une notification (`?voyage=…`), l'app re-navigue vers le voyage à chaque retour au tableau de bord. Non revérifié sur le code du jour | Majeur | PROPOSÉ |
| A-043 | 2026-09-29 | Fiabilité | Repris de la PR #80 : aucun contrôle automatique (lint, build, `verif-*.mjs`) ne tourne sur push ou sur PR | Majeur | PROPOSÉ |
| A-044 | 2026-09-29 | Sécurité | Repris de la PR #80 : Supabase Auth, la vérification des mots de passe compromis est désactivée (advisor `auth_leaked_password_protection`) | Mineur | PROPOSÉ |
| A-033 | 2026-09-29 | Sécurité | `origineAutorisee` posé sur la branche URL d'`extract-place` | Majeur | CORRIGÉ |
| A-034 | 2026-09-29 | Fiabilité | `lireCorps` (`_shared/reseau.ts`) lit le flux et coupe AU plafond, sous le délai toujours armé ; utilisé par `extract-place` et `enrich-place`. `verif-redirections.mjs` fige un corps sans fin coupé à 400 ko | Majeur | CORRIGÉ |
| A-035 | 2026-09-29 | Sécurité | `suivreRedirections` d'`enrich-place` devient `joindre` dans `_shared/reseau.ts`, et les trois `redirect: "follow"` d'`extract-place` passent par lui. `verif-redirections.mjs` importe le module (plus de découpage du source, qui était cassé) et vérifie qu'aucune des deux fonctions ne laisse `fetch` suivre seul | Majeur | CORRIGÉ |
| A-036 | 2026-09-29 | Performance et coûts | Le service worker ne rafraîchit plus en tâche de fond ce qui ne peut pas changer (`/assets/`, empreinte dans le nom) ni le moteur OCR (`/tesseract/`), et ne rend plus `index.html` à la place d'un script hors ligne | Majeur | CORRIGÉ |
| A-032 | 2026-09-29 | Sécurité | Toujours ouvert : supprimer `read-receipt` dans le tableau de bord Supabase et retirer `ANTHROPIC_API_KEY`. Geste manuel du propriétaire | Majeur | PROPOSÉ |
-->

## Dernier audit effectif

Date : 2026-09-28
Type : STANDARD (28 jours écoulés, donc au-delà du seuil de trois semaines)
Axes : Sécurité, Fiabilité, plus l'axe rotatif **Performance et coûts** —
consommé pour la première fois après trois audits LÉGERS qui l'avaient repoussé.
Prochain axe rotatif : Dette technique.
Référence ESLint à la date de l'audit : **49 erreurs, 4 avertissements**,
inchangé depuis le 2026-08-31. `npm run build` vert.

### Le contrôle de pertinence, et pourquoi il n'a pas arrêté cet audit

Trois commits seulement depuis le 2026-08-31, et l'un des trois
(`ed16f77`) ne touche que de la documentation et un commentaire de workflow.
À la lettre, deux commits significatifs, donc moins de trois : PASSÉ.

Audit conduit quand même, et la raison est consignée ici pour que la prochaine
routine tranche pareil sans re-délibérer : ce dépôt écrase ses PR en un seul
commit. Les deux qui restent portent +2 300 lignes, trois fonctions Edge
réécrites, une quatrième supprimée et un moteur OCR neuf dans le navigateur.
Le seuil compte des commits pour mesurer une quantité de changement ; ici il
mesure une convention de fusion. **Compter les fichiers applicatifs touchés,
pas les commits**, quand le dépôt écrase ses PR.

Le code de ces deux commits n'avait de plus jamais été relu : `23700ac` est
l'arbitrage de l'audit du 31 août (l'auditeur ne relit pas ses propres
correctifs le jour où il les écrit) et `01e69f7` est parti le même jour.
Quatre des six constats ci-dessous vivent précisément là.

### Audit précédent

Date : 2026-08-31
Type : LÉGER (14 jours écoulés, 6 commits significatifs : la réécriture du
formulaire de dépense, le calcul dans le champ montant, une sixième fonction
Edge `notifier-depense`, et le lien profond de notification)
Axes : Sécurité, Fiabilité. Pas d'axe rotatif en audit LÉGER.
Prochain axe rotatif : Performance et coûts (toujours pas consommé — trois
audits LÉGERS d'affilée l'ont repoussé)
Référence ESLint à la date de l'audit : **52 erreurs, 4 avertissements** avant
correction, **49 erreurs, 4 avertissements** après (A-031). Dette non aggravée
malgré +2 000 lignes. `npm run build` passe.

### Arbitrage de l'audit 2026-08-31

Rendu le jour même, sur la branche de travail.

| Constat | Décision | Ce qui a été fait |
|---|---|---|
| A-027 · SSRF | **Retenu** | Le filtre passe à la PORTE (`Deno.serve`), plus à l'intérieur de `resolve()`, et l'aiguillage se décide sur l'HÔTE et non sur l'URL entière. `scripts/verif-aiguillage.mjs` fige 25 cas, dont l'attaque exacte du constat. |
| A-028 · date UTC | **Retenu** | `dateLocale()` dans `helpers.js`, une seule définition pour tout le dépôt. `scripts/verif-date-locale.mjs` fige 9 cas — Tokyo, New York, Auckland, et Paris en été, qui décale aussi après 22 h. |
| A-029 · `payerId` | **Non reproduit** | Tout affichage d'un payeur traverse `getName`, qui replie sur « Voyageur retiré » depuis A-025. Vérifié au grep : aucun identifiant n'atteint le JSX. Consigné dans le code, à l'endroit où le prochain audit relira. |
| A-030 · notification | **Retenu** | Elle part désormais APRÈS une écriture acceptée, depuis une file par voyage. Hors ligne, elle attend la première écriture qui passe. |

Deuxième fois qu'un audit lit une faille là où le correctif est déjà posé
(A-017 en août, A-029 ici). Les deux fois, la lecture portait sur le chemin de
données sans dérouler l'affichage.

### Audit du 2026-08-17

Date : 2026-08-17
Type : LÉGER (7 jours écoulés, 3 commits significatifs : les deux correctifs de
sécurité de l'audit précédent, jamais relus par personne d'autre, et `#70`
« Parts inégales », qui touche le calcul de l'argent)
Axes : Sécurité, Fiabilité. Pas d'axe rotatif en audit LÉGER.
Référence ESLint à la date de l'audit : **52 erreurs, 4 avertissements** —
inchangé depuis le 2026-08-10, dette non aggravée. `npm run build` passe.

### Audit 2026-08-10

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

### Regroupement du 2026-09-29

Six PR d'audit s'étaient accumulées sans être fusionnées (#80, #81, #85, #86,
#87, #88), chacune avec son propre journal, et leurs numéros se chevauchaient.
Elles sont remplacées par une seule. Ce qui a été repris :

- #88 en entier (journal du 2026-09-28, `role="status"` sur la lecture du ticket) ;
- de #87 : les deux liaisons mortes (A-037 là-bas) et trois constats sans
  équivalent, renumérotés A-039 à A-041 ;
- de #80 : les trois correctifs du formulaire de dépense (champs nommés, groupe
  radio, pourcentage à la virgule) et trois constats, renumérotés A-042 à A-044.

Écarté : #81 (journal du 2026-08-31 et correctifs de lint déjà sur `main`),
#85 et #86 (passages sans objet). #80 et #81 étaient de plus branchées avant le
tout-gratuit : les fusionner telles quelles aurait recréé `read-receipt`.

**Leçon de méthode : une PR d'audit non fusionnée dans la semaine se périme.**
La routine suivante repart de `main`, ignore la précédente et réutilise ses
numéros.

### Historique

| Date | Type | Axes | Constats retenus |
|---|---|---|---|
| 2026-07-29 | PROFOND | Tous + roadmap | A-001 à A-010 |
| 2026-08-03 | LÉGER | Sécurité, Fiabilité | A-011 à A-016 |
| 2026-08-10 | PROFOND | Tous + roadmap | A-017 à A-022 |
| 2026-08-17 | LÉGER | Sécurité, Fiabilité | A-023 à A-026 |
| 2026-08-31 | LÉGER | Sécurité, Fiabilité | A-027 à A-031 |
| 2026-09-28 | STANDARD | Sécurité, Fiabilité, Performance et coûts | A-032 à A-036 |
| 2026-09-29 | Regroupement | Sécurité, Fiabilité, Performance et coûts | A-039 à A-044, clôture d'A-033 à A-036 |
