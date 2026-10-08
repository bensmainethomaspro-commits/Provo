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
-->
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
| A-045 | 2026-09-30 | Fiabilité | Les quatre `fetch` d'`enrich.js` n'avaient aucun délai. Un appel que le navigateur ne règle jamais (bascule Wi-Fi/4G, portail captif) laissait `lookupPlace` en attente pour toujours, et comme la file `enfile` ne repart qu'une fois la place libérée, UNE requête coincée arrêtait la complétion de toute la session, sans un mot. Mesuré sur le code d'avant : 1 appel parti, 0 fiche terminée, jamais | Majeur | CORRIGÉ |
| A-046 | 2026-09-30 | Fiabilité | Régression de #94 : `lienPartage` rend `null` au-delà de 160 caractères ou 3 lignes autour du lien, et `isUrl` ne rattrape plus que le texte SANS espace. Un lien collé en tête suivi d'une description part donc en recherche de texte libre, échoue sur « Aucun lieu trouvé, précise la ville », et le lien n'est même pas gardé dans la fiche. `ressembleAUneLegende` ne le reprend pas (`helpers.js` : `if (/^https?:\/\//.test(t)) return false`). Avant #94, `raw.startsWith('http')` suffisait. Mesuré sur quatre collages réalistes : 2 sur 4 finissent en cul-de-sac, dont un qui passait avant | Majeur | PROPOSÉ |
| A-047 | 2026-09-30 | Fiabilité | `pickBest` (`extract-place:268`) n'exige le nom que `si (!coords || exigerNom)` : dès que la page publie des coordonnées, un résultat OSM à moins de 25 km gagne sur ses seuls attributs (nom 3, non générique 4, horaires 2, site 1, téléphone 1, numéro 1) sans porter le nom cherché, et fournit adresse, horaires, prix et catégorie. Le client, depuis #94, exige le nom et 150 km (`candidatValable`), et `project-notes` décrit la règle du client comme « un établissement du même nom à moins d'un kilomètre ». Deux règles pour le même travail, et c'est le serveur qui écrit d'abord. #94 a fait de `handleGeneric` le chemin de tout lien qui n'est ni Maps ni TikTok | Majeur | PROPOSÉ |
| A-048 | 2026-09-30 | Dette technique | `_shared/lecture-lien.ts` est désormais dans le bundle client (`helpers.js:2`, `enrich.js`, `doublon.js`) et AUCUN contrôle ne le lit : `eslint.config.js` ignore `supabase/functions`, il n'y a pas de typecheck, `deno check` ne tourne nulle part. Démontré : `Deno.env.get` ajouté dans ce fichier laisse ESLint à 47/4, `npm run build` réussit, et `Deno.env.get` se retrouve dans `dist/assets/index-*.js`. Comme `helpers.js` l'importe, l'erreur tomberait à l'évaluation du module : l'app ne démarrerait pas | Mineur | PROPOSÉ |
| A-049 | 2026-09-30 | Fiabilité | `isClosedOnDate` (`helpers.js:1148`) est exportée et jamais appelée (grep sur `src/` et `scripts/`), et sa première règle est `if (/\bclosed\b|fermé/i.test(raw)) return true` : un horaire contenant le mot « closed » où que ce soit rend le lieu fermé TOUS les jours. Or #94 ouvre une source d'horaires en prose (`lireJsonLd` → `horairesDe`, rangé « tel quel »). Sans effet tant qu'elle est morte ; branchée, elle contredirait `ouvertMaintenant`, qui rend `null` dans ce cas précisément pour ne jamais annoncer « fermé » à tort | Mineur | PROPOSÉ |
| A-032 | 2026-09-30 | Sécurité | Clos. `read-receipt` n'est plus déployée — relevé au MCP ce jour : cinq fonctions ACTIVE seulement (`extract-place` v36, `enrich-place` v12, `push-tick` v6, `read-booking` v8, `notifier-depense` v4). Le retrait du secret `ANTHROPIC_API_KEY` n'est pas vérifiable par le MCP, il reste à confirmer côté tableau de bord | Majeur | CORRIGÉ |
| A-037 | 2026-09-30 | Méthode | Lint : **47 erreurs, 4 avertissements**, contre 49/4 au 2026-09-28. Dette non aggravée, en baisse de 2 malgré +1 200 lignes. `npm run build` vert, les 15 suites hors réseau passent (293 cas). Rien à signaler | Sans objet | PASSÉ |
| A-022 | 2026-09-30 | Méthode | `.audit/contexte.md.` (point final parasite) subsiste. Rappelé, pas re-remonté : la routine n'a pas le droit de supprimer un fichier | Mineur | PROPOSÉ |
| A-050 | 2026-09-30 | Méthode | Le `<!--` ouvert pour la ligne d'exemple du registre n'avait jamais été refermé : douze entrées réelles (A-039 à A-044, les clôtures d'A-033 à A-036, A-032) étaient dans le commentaire, donc invisibles à la lecture du journal. Délimiteurs réparés, aucune entrée réécrite | Mineur | CORRIGÉ |
| A-027 | 2026-09-30 | Sécurité | Clôture tardive : l'arbitrage du 2026-08-31 l'avait retenu et corrigé, sans ligne de registre. Revérifié ce jour : `urlSure` est appelé à la PORTE (`extract-place:1399`) et `aiguillage(cible)` décide sur l'HÔTE, pas sur l'URL entière. `scripts/verif-aiguillage.mjs` passe (25 cas, dont `http://10.0.0.5/tiktok.com`) | Majeur | CORRIGÉ |
| A-028 | 2026-09-30 | Fiabilité | Clôture tardive, même raison. Revérifié : `ExpensesTab.jsx:353` fait `aujourdhui = () => dateLocale()`, et `dateLocale` (`helpers.js:1618`) est la seule définition du dépôt. `scripts/verif-date-locale.mjs` passe (9 cas : Tokyo, New York, Auckland, Paris en été) | Majeur | CORRIGÉ |
| A-029 | 2026-09-30 | Fiabilité | Clôture tardive. **Non reproduit**, comme l'avait établi l'arbitrage du 2026-08-31 : tout affichage d'un payeur traverse `getName`, qui replie sur « Voyageur retiré » (`ExpensesTab.jsx:331`, `TravelerBalanceSheet.jsx:8`). Revérifié au grep ce jour : aucun identifiant technique n'atteint le JSX. Ne plus le remonter sur la seule lecture de `voyageSansVoyageur` — c'est l'affichage qu'il faut dérouler | Sans objet | REFUSÉ |
| A-030 | 2026-09-30 | Fiabilité | Clôture tardive. Revérifié : `viderLesNotifs` (`useTrips.js:204`) part d'une file par voyage, appelée APRÈS une écriture acceptée ; hors ligne l'identifiant attend la première écriture qui passe. `scripts/verif-notif-depense.mjs` passe (13 cas) | Mineur | CORRIGÉ |
| A-046 | 2026-09-30 | Fiabilité | Clos le jour même, hors routine. Un texte qui COMMENCE par un lien repart par l'import de lien (`/^https?:\/\//` dans `isUrl`, lien pris par `premierLien`), et un lien cité au milieu d'un texte qui ne donne aucun lieu rejoint quand même la fiche. Parcours 80/80 | Majeur | CORRIGÉ |
| A-047 | 2026-09-30 | Fiabilité | Clos le jour même. `resolvePlace` passe `exigerNom: true` à `pickBest` : avec ou sans point, le résultat doit porter le nom lu dans le lien, comme côté client. Sans nom lu, rien ne change (le point seul décide). Mesure sur exécuteur à relire dans `diagnose-places` | Majeur | CORRIGÉ |
| A-048 | 2026-09-30 | Dette technique | Clos le jour même. `verif-lecture-lien.mjs` vérifie que le module partagé n'a ni `Deno.`, ni import, ni `fetch` : c'est le contrôle qui manquait, puisque le lint l'ignore. Et `npm run verif` enchaîne désormais les 15 suites hors réseau | Mineur | CORRIGÉ |
| A-049 | 2026-09-30 | Fiabilité | Clos le jour même. `isClosedOnDate`, `expandDayRange` et `DAY_MAP` retirés de `helpers.js` : morts ensemble (grep), et `ouvertMaintenant` reste la seule lecture des horaires | Mineur | CORRIGÉ |
| A-022 | 2026-09-30 | Méthode | Clos. `.audit/contexte.md.` supprimé à la main (la routine n'en a pas le droit) : copie ancienne de 176 lignes, dépassée par `contexte.md` | Mineur | CORRIGÉ |
| A-051 | 2026-09-30 | Fiabilité | **Perte de données, reproduite.** `loadFromSupabase` REMPLAÇAIT chaque voyage local par la version du nuage, et il tourne au démarrage, sur `TOKEN_REFRESHED` et sur `SIGNED_IN`, qu'auth-js émet à chaque retour dans l'app (`_onVisibilityChanged` → `_recoverAndRefresh`). Une modification faite hors ligne était perdue au premier aller-retour par une autre app ; dans l'autre sens, l'écriture différée partie avant la lecture réécrivait le nuage avec une version périmée | Critique | CORRIGÉ |
| A-052 | 2026-09-30 | Fiabilité | Au premier lancement, `clients.claim()` déclenchait `controllerchange`, donc un rechargement, alors que l'app avait déjà retiré de l'adresse le lien qui l'avait ouverte : `?invite=`, `?share=`, `?voyage=`, `?ajout=` perdus pour quiconque ouvrait Provo pour la première fois. Reproduit | Majeur | CORRIGÉ |
| A-053 | 2026-09-30 | Fiabilité | `profiles` n'a pas de colonne `name` mais `display_name` : chaque publication du prénom échouait (`[Provo] Publication du profil refusée`), et `fetchTripMembers` ne rendait jamais le prénom des autres membres | Majeur | CORRIGÉ |
| A-054 | 2026-09-30 | Fiabilité | `shared_trips` « collaboratif » était un instantané figé présenté comme « temps réel », et rouvrir son propre lien REMPLAÇAIT le voyage par cet instantané (perte de tout ce qui avait changé depuis, puis écrite dans le nuage) | Majeur | CORRIGÉ |
| A-055 | 2026-09-30 | Performance et coûts | Chaque frappe resérialisait tous les voyages et réécrivait tout le stockage local : mesuré 239 ms par frappe (CPU ×4) avec un billet de 1,5 Mo joint, 33 ms après | Majeur | CORRIGÉ |
| A-056 | 2026-09-30 | Performance et coûts | Service worker au nom de cache constant (`provo-v3`) : versions empilées sans purge, moteur OCR jamais renouvelé, `sw.js` identique d'un déploiement à l'autre. Et « Vider le cache » de l'écran d'erreur, hors ligne, rendait l'app inlançable | Mineur | CORRIGÉ |
| A-057 | 2026-09-30 | Produit et UX | Barre de messages en thème sombre : texte à 3,39:1 (`--accent-deep` n'est pas un jeton de texte). Jamais mesuré : la barre n'est sur aucun écran de `/verif-ui` | Mineur | CORRIGÉ |
| A-001 | 2026-09-30 | Sécurité | Clos. Migration `20260930_partage_securise.sql` appliquée et vérifiée en jouant `anon` et `authenticated` : plus de lecture en liste ni de réécriture, une copie se lit par son lien via `lire_voyage_partage` | Critique | CORRIGÉ |
| A-003 | 2026-09-30 | Fiabilité | Clos. Dernier taux gardé sans limite ; sans taux, `eurAmount: null` + `tauxManquant`, converti à l'arrivée du taux ; source de secours pour les devises hors BCE ; `enEuros()` seule lecture. Deux parcours, rouges sur l'ancien code | Majeur | CORRIGÉ |
| A-004 | 2026-09-30 | Sécurité | Clos. Seul le code du propriétaire fait entrer, et il change quand un membre est retiré (déclencheur `renouveler_invitation`) | Majeur | CORRIGÉ |
| A-007 | 2026-09-30 | Sécurité | Clos. Déclencheur `garder_proprietaire` : `owner_id` ne change plus, vérifié (refus en 42501) | Mineur | CORRIGÉ |
| A-012 | 2026-09-30 | Fiabilité | Clos côté client : `timeout` de 25 s sur les quatre `functions.invoke`, et `scripts/verif-delais.mjs` refuse tout appel réseau de `src/` sans délai. Le budget global côté fonction Edge reste ouvert | Majeur | CORRIGÉ (client) / PROPOSÉ (serveur) |
| A-041 | 2026-09-30 | Performance et coûts | Clos. Icônes recompressées en palette : 1,3 Mo → 280 ko, écart moyen 1,6/255 par canal | Mineur | CORRIGÉ |
| A-042 | 2026-09-30 | Fiabilité | Clos. Reproduit puis corrigé : le lien d'une notification se consomme en quittant le voyage | Majeur | CORRIGÉ |
| A-043 | 2026-09-30 | Fiabilité | Clos. `.github/workflows/verif.yml` : build, suites, dette ESLint plafonnée, 87 parcours, sur chaque PR | Majeur | CORRIGÉ |
| A-044 | 2026-09-30 | Sécurité | Toujours ouvert : la protection contre les mots de passe compromis est un réglage du tableau de bord (Authentication › Providers › Email), pas du SQL. Peut-être réservée aux offres payantes : à vérifier | Mineur | PROPOSÉ |
| A-058 | 2026-09-30 | Fiabilité | Annuler (« Nogo ») une activité du jour affichait l'écran d'erreur : `tempsRestant` et `signauxAjout` lisaient `s.start`/`s.end` sur le créneau `null` d'une activité annulée. En production depuis la PR #98. Trouvé par `/verif-ui` ; parcours « Annuler une activité du jour, puis se raviser » | Critique | CORRIGÉ |
| A-059 | 2026-09-30 | Produit et UX | Feuille Partager : badge « Modifier ensemble » à 4,09:1 (clair) et 2,78:1 (sombre) ; lien des fiches à 3,51:1 et 15 px de haut. Aucun des deux écrans n'était visité par `/verif-ui` | Mineur | CORRIGÉ |
| A-060 | 2026-09-30 | Fiabilité | La réception temps réel fusionnait l'écho de sa propre écriture comme une version d'ailleurs quand il arrivait avant la réponse de l'envoi : ce qui avait été tapé entre-temps était écrasé | Majeur | CORRIGÉ |
| A-012 | 2026-09-30 | Fiabilité | Clos côté serveur : budget de 20 s pour tout l'appel (`_shared/budget.ts`), `extract-place` et `enrich-place`. Réseau muet : 27 s avant, moins de 21,5 s après (`verif-budget`). À confirmer en production : la sonde de santé doit répondre `budget: true` | Majeur | CORRIGÉ |
| A-040 | 2026-09-30 | Fiabilité | Clos. Le moteur des tickets se précharge à 10 jours du départ ; hors ligne sans moteur, le message le dit | Majeur | CORRIGÉ |
| A-061 | 2026-10-05 | Fiabilité | Le nuage perd sa copie AVANT que la pièce y soit. L'extraction remplace les données lourdes par `pj:<empreinte>` (`usePiecesSync.js:57-77`), ce qui marque le voyage à envoyer : `planifier` l'écrit à 700 ms (`useTrips.js:252`, `update({ data: trip })` remplace tout le JSON) et le dépôt de la pièce ne commence qu'à 2 500 ms (`usePiecesSync.js:132`). Pendant ~1,8 s, et aussi longtemps que le dépôt échoue, le nuage référence une pièce dont il n'a aucune copie, alors qu'il avait le base64 juste avant. Cas réel : le voyage `ms0rso33cuc7x` (321 ko, base64 inline, dernière écriture 2026-07-26, relevé au MCP ce jour) le fera à la prochaine ouverture. Pas de perte immédiate — la pièce est dans IndexedDB d'un téléphone, et `marquerEnvoyee` n'est posé qu'après un dépôt réussi, donc le ménage ne l'efface pas — mais la seule copie partagée a disparu | Majeur | PROPOSÉ |
| A-062 | 2026-10-05 | Fiabilité | Une pièce absente n'est jamais redemandée. `rapatrier` rend `null` et rien ne retente (`usePiecesSync.js:104-114`) : les seuls déclencheurs d'`echanger` sont un changement de `trips` (2 500 ms de latence) et l'événement `online` (`usePiecesSync.js:131-139`) ; aucun minuteur, et `echanger` est stable (dépendances toutes des refs). Le voyage reçu par le temps réel déclenche UN essai 2,5 s après — avant la fin du dépôt du billet de 3 Mo parti de l'autre téléphone. Ensuite, tant que personne ne modifie le voyage, le billet n'arrive jamais. C'est l'inverse du but affiché par le module : « un billet doit être là AVANT d'arriver dans l'aéroport sans réseau » (`usePiecesSync.js:44-45`) | Majeur | PROPOSÉ |
| A-063 | 2026-10-05 | Fiabilité | Un papier en image pas encore rapatrié ouvrait l'aperçu plein écran sur du vide, sans un mot : `ImagePiece` rend `null` par construction (`ImagePiece.jsx:10`) et la branche image d'`ouvrir` ne contrôlait rien (`TripDocuments.jsx`), alors que la branche PDF du même écran dit déjà « pas encore sur ce téléphone : il arrive avec du réseau ». Même asymétrie dans `ActivityCard` : le PDF a `pdf-list__absent`, la visionneuse de captures n'a rien | Mineur | CORRIGÉ (papiers) / PROPOSÉ (captures) |
| A-064 | 2026-10-05 | Produit et UX | `ConflitsSheet` (PR #99) portait `role="dialog"` sans `aria-modal`, contrairement aux deux autres boîtes du dépôt (`ConfirmDialog.jsx:6`, `TripSearch.jsx:80`) : un lecteur d'écran continue à lire la page derrière la feuille | Mineur | CORRIGÉ |
| A-065 | 2026-10-05 | Fiabilité | `memoire`, le cache en mémoire des pièces (`pieces.js:168`), n'a aucune borne : `lirePiece` et `stockerPieces` y posent le base64 entier de chaque pièce lue, et la seule suppression est le ménage des orphelines (`pieces.js:235`). Parcourir les billets d'un voyage garde donc leur poids cumulé en mémoire pour toute la session — le dépôt tient déjà les dizaines de Mo du moteur OCR pour un motif à éteindre (`ocrTicket.js`, « sur un téléphone, le garder… »). Raisonné sur le code, non mesuré sur appareil | Mineur | PROPOSÉ |
| A-037 | 2026-10-05 | Méthode | Lint : **40 erreurs, 4 avertissements** — identique au relevé du 2026-09-30 après correction, donc dette non aggravée malgré +2 100 lignes (PR #99). `npm run build` vert, les 20 suites `verif-*` passent, `/verif-ui` ne relève aucun nouveau point sur les 11 écrans × 2 thèmes. Rien à signaler | Sans objet | PASSÉ |
| A-066 | 2026-10-01 | Produit et UX | Texte blanc sur dégradé bleu clair, mesuré au pixel : libellé de l'onglet actif 2,66:1, « Nouveau voyage » 2,66:1, ＋ de l'en-tête 2,63:1, carte « En voyage » 3:1, « JOUR 1 » 2,47:1 (accent du voyage en couleur de texte). Invisible à `/verif-ui`, qui rangeait 989 textes sur fond non uni en « à l'œil, non compté » | Majeur | CORRIGÉ |
| A-067 | 2026-10-01 | Dette technique | Quatre « design systems » empilés dans `index.css` : `--text-muted` déclaré 8 fois, 91 ombres distinctes, 29 durées, 68 `!important`, commentaires décrivant des teintes chaudes sur des valeurs bleu froid. `styles/tokens.css` (passage vérifié sans écart de style calculé) et `verif-jetons` | Majeur | CORRIGÉ |
| A-068 | 2026-10-01 | Fiabilité | La couleur choisie à la création d'un voyage n'était jamais enregistrée (`createTrip` ne recopiait pas `color`) : le voyage prenait celle du pays, indigo pour le Portugal | Mineur | CORRIGÉ |
| A-069 | 2026-10-01 | Produit et UX | Création de voyage : champ « Retour » sorti de 34 px de sa fenêtre, 34 contrôles dont 3 décoratifs, destination facultative. Écran absent de `/verif-ui` | Mineur | CORRIGÉ |
| A-070 | 2026-10-01 | Produit et UX | Les repas posés d'office comptaient comme des activités : un voyage vide annonçait 10 activités, un bilan sacrait « Resto ×12 » ; l'estimé de 200 € s'affichait sans dire qu'il ne venait que des repas | Majeur | CORRIGÉ |
| A-071 | 2026-10-01 | Produit et UX | Inter chargée depuis Google Fonts, que le service worker ne garde pas : l'app changeait de police hors ligne, au premier lancement sans réseau et dans l'APK | Mineur | CORRIGÉ |
| A-072 | 2026-10-01 | Produit et UX | Un champ de saisie posé dans une feuille ne se voyait pas : une couche intermédiaire posait `border: none` et le fond même des feuilles. Trouvé pendant la refonte, à la capture | Majeur | CORRIGÉ |
| A-073 | 2026-10-01 | Produit et UX | Quatre écrans d'introduction avant l'app, dont deux promesses fausses (« pas besoin de compte » alors que le partage en demande un ; un glissement absent de la frise) | Mineur | CORRIGÉ |
| A-074 | 2026-10-01 | Produit et UX | Vus à la lecture, pas sur un écran mesuré : pastille de compte du menu ⋯ en blanc sur ambre (environ 2,2:1), bouton « Modifier » des bulles de la carte en blanc sur l'accent (2,72:1) | Mineur | CORRIGÉ |
| A-061 | 2026-10-07 | Fiabilité | Clos. Un voyage que le nuage porte peut-être (session ou nuage pas encore lus, ou voyage déjà dans le nuage) ne perd une donnée lourde qu'une fois la pièce déposée dans son dossier (`envoyee` contient le voyage) : `usePiecesSync` range la pièce, la dépose, PUIS la remplace par sa référence (`enReferences`, `pieces.js`). Sans compte, ou pour un voyage que le nuage n'a pas, rien ne change : sortie immédiate. Gardé par `verif-demarrage` : à chaque écriture simulée, une donnée retirée du nuage doit déjà être dans le dossier (cas F), et le cas H coupe le dépôt (le nuage garde le base64, puis s'allège au retour du réseau). Rouge sur le code d'avant (4 vérifications), vert après. Prod relevée au MCP le jour même : `ms0rso33cuc7x` porte toujours son base64, zéro objet dans `pieces`, donc rien n'a été perdu avant le correctif. Reste non couvert : un téléphone qui aurait DÉJÀ allégé ce voyage hors ligne avec l'ancien code l'enverra allégé ; aucun signe que ce soit arrivé | Majeur | CORRIGÉ |
| A-062 | 2026-10-07 | Fiabilité | Clos. Ce qui n'a pas pu être échangé (pièce absente, dépôt refusé, voyage pas encore dans le nuage) est retenté seul avec un recul croissant (5 s, 15 s, 45 s, 2 min, puis toutes les 5 min tant que l'app est ouverte), qui repart de zéro dès qu'une pièce passe, au retour du réseau et au retour au premier plan. Cas I de `verif-demarrage` : la pièce arrive dans le dossier après l'ouverture, sans modification du voyage ; rouge avant, vert après | Majeur | CORRIGÉ |
| A-075 | 2026-10-08 | Fiabilité | Le contrôle « Supabase Preview » (intégration GitHub de Supabase) échouait sur CHAQUE commit de `main` depuis au moins le 2026-09-30 : « Remote migration versions not found in local migrations directory ». L'historique de la base (`supabase_migrations.schema_migrations`) portait cinq versions à la seconde ; le dépôt rangeait ses fichiers sous une date seule (`20260930_…` deux fois, `20260806_…`), et trois migrations de juin n'y avaient jamais été versées. `push_subscriptions` avait été posée par l'éditeur SQL, sans entrée dans l'historique. Corrigé : fichiers renommés aux versions exactes (SQL identique hors commentaires, comparé au MCP), trois migrations de juin recopiées depuis la base (md5 identique), `push_subscriptions` inscrite dans l'historique sous `20260806085824` (équivalent de `migration repair`, aucune instruction rejouée : table, colonnes, quatre politiques, index et clé étrangère relevés identiques au fichier), chemin mis à jour dans `setup-push.yml`. Garde-fou : `scripts/verif-migrations.mjs` (version à 14 chiffres, unique ; workflows qui citent une migration existante), rouge sur l'état d'avant. Le contrôle sur `main` est à relire après la fusion | Mineur | CORRIGÉ |

## Dernier audit effectif

Date : 2026-10-05
Type : LÉGER (5 jours depuis le 2026-09-30, donc sécurité et fiabilité, pas
d'axe rotatif ; une vingtaine de commits, sous le seuil de 40)
Prochain axe rotatif : **Dette technique** (toujours pas consommé — quatre
audits LÉGERS d'affilée l'ont repoussé)
Référence ESLint à la date de l'audit : **40 erreurs, 4 avertissements**,
inchangé depuis le 2026-09-30. `npm run build` vert, 20 suites `verif-*`
vertes, `/verif-ui` sans nouveau point.

### Ce que cet audit a lu, et pourquoi

Le contrôle de pertinence passe largement : la PR #99, fusionnée le
2026-10-01, porte +2 100 lignes et trois modules neufs
(`utils/pieces.js`, `hooks/usePiecesSync.js`, `_shared/budget.ts`). Elle a
été écrite ET arbitrée le 2026-09-30 dans la même session : personne ne
l'avait relue depuis, exactement le cas que le journal note depuis le
2026-09-28 (« l'auditeur ne relit pas ses propres correctifs le jour où il
les écrit »). Les cinq constats ci-dessus vivent tous là.

### La branche de cet audit ne s'appelle pas `claude/audit-…`

La session a été provisionnée sur `claude/keen-fermat-ufkdfo` et n'a pas le
droit de pousser ailleurs. Le préfixe `claude/` — la seule contrainte dure —
est respecté. **Conséquence pour la routine suivante : chercher la PR d'audit
en cours par son TITRE (« Audit … »), pas par le nom de sa branche.** Sinon
elle en ouvrira une seconde, ce qui est précisément l'accident du 2026-09-29.

### Ce que le MCP Supabase dit de la production, ce jour

- La migration `20260930_pieces_jointes.sql` est bien appliquée : le dossier
  `pieces` existe (privé, 6 MiB, cinq types MIME) et les deux politiques
  `select`/`insert` sont en place sur `storage.objects`, réservées à
  `authenticated` et filtrées par `est_du_voyage((storage.foldername(name))[1])`.
  `trips.id` et `trip_members.trip_id` sont tous deux `text` : la fonction
  compare bien ce qu'il faut.
- **Zéro objet déposé** dans `pieces`, et aucun voyage ne porte encore de
  référence `pj:`. La chaîne des pièces jointes n'a donc jamais tourné en
  production : tout ce qui la concerne ci-dessus est lu sur le code, pas
  observé à l'usage.
- `trip_members` est vide : la collaboration non plus n'a jamais été exercée.
- Advisors sécurité : rien de neuf. `auth_leaked_password_protection` est
  A-044, déjà ouvert ; les quatre `security definer` signalés (dont
  `est_du_voyage`) sont voulus et ne rendent qu'un booléen sur l'appelant.

### Audit précédent

Date : 2026-09-30
Type : LÉGER (le dernier audit a été fusionné la veille — moins de trois
semaines, donc sécurité et fiabilité, pas d'axe rotatif)
Prochain axe rotatif : **Dette technique** (toujours pas consommé)
Référence ESLint à la date de l'audit : **47 erreurs, 4 avertissements**
(49/4 au 2026-09-28 : la dette a baissé de 2). `npm run build` vert.
Les 15 suites `verif-*.mjs` hors réseau passent : 293 cas.

### Le contrôle de pertinence, tranché comme la dernière fois

Deux commits depuis le regroupement du 2026-09-29 : `7603dd6` (#93) ne touche
qu'un workflow, `700cb90` (#94) porte +1 222 lignes sur 12 fichiers
applicatifs, dont un module partagé neuf de 317 lignes. À la lettre, un seul
commit significatif, donc PASSÉ. Audit conduit quand même, en appliquant la
règle que le passage du 2026-09-28 a écrite pour éviter de re-délibérer :
**compter les fichiers applicatifs touchés, pas les commits, quand le dépôt
écrase ses PR.** Quatre des cinq constats ci-dessous vivent dans ce commit.

### Ce qui s'est débloqué côté production

- `read-receipt` n'est plus déployée (A-032 clos). Il restait depuis le 31 août.
- Le déploiement automatique des fonctions Edge remarche : l'`entrypoint_path`
  des cinq fonctions pointe `/home/runner/work/Provo/Provo/…`, donc le jeton
  `SUPABASE_ACCESS_TOKEN` a été renouvelé et le workflow repousse depuis un
  exécuteur. Le « À FAIRE À LA MAIN » de `project-notes` est fait.

### Audit précédent

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
| 2026-09-30 | LÉGER | Sécurité, Fiabilité | A-045 à A-050, clôture d'A-032 |
| 2026-09-30 | Audit Pareto (session) | Tous axes, code et UX/UI | A-051 à A-057 ; clôture d'A-001, A-003, A-004, A-007, A-012 (client), A-041 à A-043 |
| 2026-09-30 | Améliorations (session, PR #99) | Fiabilité, Produit et UX | A-058 à A-060 ; clôture d'A-012 (serveur) et A-040 |
| 2026-10-01 | Critique design (session) | Produit et UX, Dette technique | A-066 à A-074 (numérotés après l'audit du 2026-10-05, fusionné avant) |
| 2026-10-05 | LÉGER | Sécurité, Fiabilité | A-061 à A-065 |
| 2026-10-07 | Correctif (session) | Fiabilité | Clôture d'A-061 et A-062 |
| 2026-10-08 | Correctif (session) | Fiabilité | A-075 (ouvert et clos le même jour) |
