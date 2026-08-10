# Contexte projet : Provo

> Mémoire long terme de l'auditeur automatique. Ce fichier fait autorité.
> Ne le contredis pas, ne propose rien qui l'ignore, et ne le réécris que si tu
> constates un changement structurel réel dans le code.

## Ce que fait l'application

PWA de planification de voyage, en français, tutoiement, mobile d'abord (largeur
maximale 480 px). Fonctionne hors ligne, se synchronise et se partage via Supabase.
Déployée sur Vercel, empaquetable en application Android via Capacitor.

**Principe produit directeur** : on prépare un vivier d'idées avant le voyage, on
pioche dans la Réserve pendant. Ce n'est pas de la planification exhaustive : ce
qu'on évite, c'est de chercher et d'arbitrer sur le moment.

Quatre invariants produit. Une recommandation qui les contredit est irrecevable,
quelle que soit sa qualité technique.

1. La Réserve est le cœur du produit.
2. Aucune fiche ne doit être incomplète : l'app complète elle-même horaires, prix,
   adresse et coordonnées. L'utilisateur ne saisit rien pour en bénéficier.
3. L'app est force de proposition uniquement en pop-up. Elle ne réorganise jamais
   d'office et ne bloque rien.
4. L'écran du jour répond à « qu'est-ce que je fais maintenant » sans lecture ni
   réflexion : peu d'informations, gros caractères, action évidente.

Utilisateurs : le propriétaire et ses proches, sur des séjours ponctuels. Quelques
personnes, quelques fois par an. Aucun objectif de croissance ni de monétisation.

## Stack

| Domaine | Choix |
|---|---|
| Interface | React 19, sans routeur, état de route local dans App.jsx |
| Build | Vite 8, base './', chunks vendor séparés (react, supabase, leaflet) |
| Style | CSS unique src/index.css (~5 900 lignes), variables CSS, deux thèmes |
| Backend | Supabase : auth e-mail/mot de passe, Postgres, Realtime, Edge Functions |
| Cartographie | Leaflet, tuiles OpenStreetMap |
| Hébergement | Vercel, vercel.json pilote le cache |
| Mobile natif | Capacitor 8 (com.provo.app), dossier android/ |
| Qualité | ESLint 10, aucune suite de tests automatisés |

Services externes gratuits et sans clé : Nominatim, **Photon**
(`photon.komoot.io`, second recours de `searchPlaces` quand Nominatim ne rend
rien — même fond OSM, index approximatif, mais ni horaires ni tarifs), Overpass,
Open-Meteo, OSRM, Wikipédia, Frankfurter, Google News RSS via rss2json, tuiles
OSM, et des proxys CORS de secours interrogés en parallèle.

**Une seule dépendance payante, optionnelle** (depuis le 2026-08-03) :
l'API Anthropic, appelée par la fonction Edge pour lire les légendes TikTok que
les règles n'ont pas su interpréter. Modèle `claude-haiku-4-5-20251001`,
~0,001 € par lien. Elle ne s'active que si le secret `ANTHROPIC_API_KEY` (ou
`ANTHROPIC_API_KEY_TB`) est posé dans Supabase › Edge Functions › Secrets ;
sans lui, `classifyWithLLM` rend `null` et la chaîne à base de règles reprend
la main. Les garde-fous sont décrits dans `.claude/project-notes.md`.

## Architecture à connaître

- `src/hooks/useTrips.js` : modèle de données, persistance, synchro, collaboration.
  C'est le fichier le plus critique du projet.
- `src/hooks/useTripAnchor.js` : point d'ancrage géographique d'un voyage (les
  coordonnées de sa **destination**, jamais celles de la première activité).
  Toute recherche de lieu s'y situe. Cache dans `localStorage` sous
  `provo_dest_coords` — troisième clé du projet avec `provo_trips` et
  `provo_settings`.
- `src/utils/enrich.js` : complétion automatique des fiches.
- `src/lib/supabase.js` : client Supabase, URL et clé publiable.
- `supabase/functions/extract-place/index.ts` : fonction Edge Deno qui résout les
  liens courts et extrait les métadonnées d'une page tierce. Utilise
  optionnellement le secret ANTHROPIC_API_KEY.
- `.github/workflows/deploy-edge-functions.yml` : déploie automatiquement sur push
  vers main dès que `supabase/functions/**` change. Il **parcourt le dossier**
  depuis le 2026-08-04 : ajouter une fonction suffit à la déployer.

### Les cinq fonctions Edge — relevé le 2026-08-10

| Fonction | Rôle | Clé Anthropic | Contrôle d'origine |
|---|---|---|---|
| `extract-place` | liens et légendes | oui | **oui** |
| `enrich-place` | site du lieu | oui | **oui** (depuis A-018) |
| `read-booking` | confirmation collée | oui | **oui** (depuis A-018) |
| `read-receipt` | photo de ticket (vision) | oui | **oui** (depuis A-018) |
| `push-tick` | rappels planifiés | non | non (assumé, voir project-notes) |

Aucun `supabase/config.toml` : les fonctions sont déployées avec la vérification
de jeton par défaut. **La clé publiable suffit à la satisfaire**, et elle est
dans le bundle et dans deux workflows. Le contrôle d'origine est donc le seul
filtre réel sur les fonctions qui dépensent la clé payante — c'est la raison
d'être de la règle écrite dans `project-notes.md` (« garde-fou n°1 »).

`origineAutorisee` ne vit plus dans `extract-place` mais dans
`supabase/functions/_shared/origine.ts`, importé par les quatre fonctions —
c'est sa recopie qui l'avait laissé derrière quand trois fonctions ont été
ajoutées. **Toute nouvelle fonction qui dépense la clé payante l'importe.**
Le dossier `_shared` n'a pas d'`index.ts` : la boucle de déploiement l'ignore
comme fonction, et le CLI l'embarque dans chaque paquet qui l'importe.

Ce que ce contrôle NE fait pas : l'en-tête `Origin` n'est imposé que par les
navigateurs. Il ferme l'abus depuis un autre site — le vecteur réaliste d'une
dépense massive — pas l'appel forgé en ligne de commande. Ne pas le présenter
comme une fermeture complète.

`diagnose-enrich.yml` envoie déjà un en-tête `Origin: https://provo-tbens.vercel.app`,
le diagnostic n'a donc pas été cassé par cet ajout.

**Modèle de données** : un voyage entier tient dans un seul objet JSON, stocké tel
quel dans localStorage (`provo_trips`) et dans la colonne `data` de la table
`trips`. Il n'y a pas de schéma relationnel côté application. C'est un choix, pas
un oubli.

**Persistance en trois couches** : localStorage écrit à chaque changement, puis
Supabase avec synchronisation différée de 700 ms et comparaison d'empreinte, puis
Realtime via `postgres_changes`.

Tables Supabase : `trips`, `trip_members`, `profiles`, `shared_trips`, et
`push_subscriptions` depuis le 2026-08-06. Elles cohabitent dans le même projet
Supabase que l'application sœur JobWatch, dont les tables sont préfixées
`jobwatch_`.

`push_subscriptions` est la **première table dont le SQL vit dans le dépôt**
(`supabase/migrations/20260806_push_subscriptions.sql`). Vérifié le 2026-08-10 :
la table déployée porte bien les quatre politiques du fichier, la clé est
l'`endpoint`, et `anon` comme `authenticated` ont les quatre droits — seules
les politiques protègent. La politique UPDATE n'a pas de `WITH CHECK`, et
**ce n'est pas une faille** : PostgreSQL précise que pour une politique `UPDATE`
sans `WITH CHECK`, l'expression `USING` sert AUSSI de contrôle sur la nouvelle
ligne. `using (auth.uid() = user_id)` fait donc échouer la réaffectation d'une
ligne à l'`user_id` d'un autre, et `pg_policies` affiche `with_check: null`
précisément dans ce cas. C'était le constat A-017, **passé en REFUSÉ** ; la
raison et sa condition de réfutation sont dans le fichier de migration.
**Ne pas le remonter à nouveau sur la seule lecture de `pg_policies`** : un
`with_check: null` sur une politique `UPDATE` ne prouve rien à lui seul, il faut
lire l'expression `USING`.

## Coexistence avec le système .claude/ existant

Ce dépôt possède déjà une mémoire d'amélioration continue. Elle prime sur toi.

- `.claude/ux-playbook.md` : 30 règles d'interface portables, partagées à
  l'identique entre tous les projets du propriétaire. Provo en est le dépôt de
  référence. Lis-le avant tout constat d'interface. Ne reformule jamais une de ses
  règles comme si tu la découvrais.
- `.claude/project-notes.md` : ce qui est déjà appliqué et ce qui a été écarté
  sciemment. Tout ce qui y figure comme écarté ne doit jamais être reproposé.
- Une commande `/audit` maison existe déjà : elle audite l'app contre le playbook
  sans toucher au code. Elle est manuelle et centrée interface. Toi, tu es la
  routine hebdomadaire autonome, centrée sécurité, fiabilité et code. Ne double pas
  son travail : sur l'axe produit et UX, contente-toi de signaler les écarts au
  playbook que tu croises, sans conduire une revue d'interface complète.

## Conventions assumées, à ne jamais signaler comme défauts

- **54 erreurs et 3 avertissements ESLint sur main.** Dette connue, non bloquante.
  Consigne : ne pas aggraver. Ne la signale que si le nombre a augmenté depuis le
  dernier audit, en chiffrant l'écart.
- Absence totale de tests automatisés. La vérification se fait au rendu réel, via
  `npm run build`, `vite preview` et des scripts Playwright ponctuels en 390 × 844.
  Ne recommande la mise en place d'une suite de tests que si un bug de régression
  réel est identifiable dans l'historique git.
- Un seul fichier CSS de près de 6 000 lignes. C'est assumé. Ne propose ni
  découpage, ni CSS Modules, ni framework de style.
- Aucun routeur. L'état de route vit dans App.jsx. Assumé.
- Français et tutoiement partout. Pas d'internationalisation.
- Couleur de marque `--accent: #35A7DD`. Les jetons `--orange` et `--yellow`
  subsistent comme alias hérités référencés partout dans le CSS : c'est voulu, ne
  propose pas de nettoyage.
- Google Places a été écarté sciemment (carte bancaire obligatoire depuis mars
  2025, conditions d'utilisation incompatibles avec une carte non-Google). Ne le
  repropose jamais.
- Cinq onglets maximum dans la barre du bas, le secondaire va dans `⋯`.
- Cartes repliées par défaut.
- Volume : quelques utilisateurs. Aucune recommandation de montée en charge, de
  cache distribué ou d'optimisation de coût d'infrastructure.

## Limites connues, à ne jamais remonter comme constats

- Modifier les dates d'un voyage supprime les activités des jours retirés.
- La complétion automatique dépend de la couverture OpenStreetMap : bonne sur les
  lieux touristiques, inégale sur les petits commerces.
- La complétion d'un lien partagé cherche autour de la destination du voyage : un
  lieu situé ailleurs ne sera pas complété.
- Le partage par URL encodée est limité par la longueur maximale d'une URL.
- Pas de résolution de conflit en écriture simultanée : le dernier qui écrit gagne.
- Vercel Deployment Protection doit rester sur « Only Preview Deployments » pour
  qu'un lien partagé s'ouvre sans compte Vercel.

Si l'une de ces limites produit une régression nouvelle et démontrable dans le
code, c'est un constat recevable. Sa simple existence ne l'est pas.

## Hors périmètre

- Monétisation, abonnement, paiement
- Internationalisation
- Analytics et suivi comportemental
- SEO
- Migration de framework, de style ou d'hébergeur
- Refonte de l'architecture de données vers un schéma relationnel

## Priorités de l'auditeur, par ordre décroissant

1. **Fuite de données entre voyages ou entre utilisateurs.** Les politiques RLS
   sur `trips`, `trip_members`, `profiles` et `shared_trips` sont le point le plus
   sensible du projet. Un voyage partagé en consultation ne doit exposer que ce
   qu'il doit exposer, et un code d'invitation révoqué doit l'être réellement.
2. **Exposition de secrets.** ANTHROPIC_API_KEY dans la fonction Edge, clés
   Supabase, tout ce qui pourrait se retrouver dans le bundle client ou dans
   l'historique git.
3. **Perte de données saisies.** Un voyage effacé par un bug de synchronisation ou
   de fusion local/nuage est le pire scénario du projet. Regarde en priorité
   `useTrips.js`, la fusion à la connexion, et la reconstruction des jours au
   changement de dates.
4. **Fiabilité en connexion dégradée.** L'application est utilisée sur téléphone
   pendant un séjour, parfois sans réseau. Service worker, bannière hors ligne,
   file de synchronisation au retour du réseau.
5. **Justesse des calculs de dépenses.** Soldes, parts dues, remboursements exclus
   des totaux et de la répartition par catégorie. Une erreur ici est silencieuse et
   coûteuse.
6. **Robustesse des appels externes.** Neuf services tiers gratuits, sans
   engagement de disponibilité. Chacun doit échouer proprement sans casser l'écran.
7. Le reste.

## Base de données : état relevé le 2026-07-29

Relevé via le MCP Supabase (projet `usztistixgzdrvjzplqx`, région eu-west-3).
Aucune migration n'existe dans le dépôt : les politiques vivent uniquement dans
le tableau de bord Supabase. Toute modification y est donc manuelle, et le
dépôt n'en garde aucune trace. C'est le principal angle mort du projet.

| Table | Politiques |
|---|---|
| `trips` | `owner_all` (ALL, `owner_id = auth.uid()`), `member_select` + `member_update` (EXISTS dans `trip_members`) |
| `trip_members` | `owner_manage_members` (ALL, `is_trip_owner`), `join_by_invite` (INSERT, `user_id = auth.uid()`), `member_read_own` (SELECT, ses propres lignes) |
| `profiles` | `own_profile_all`, plus deux SELECT en `USING (true)` |
| `shared_trips` | `public_read`, `public_insert`, `public_update`, tous en `true` |

`anon` et `authenticated` ont les droits SELECT/INSERT/UPDATE/DELETE sur les
quatre tables : seules les politiques RLS protègent quoi que ce soit.

Conséquences à connaître sans les redécouvrir :

- `member_read_own` ne laisse voir à un collaborateur que sa propre ligne :
  `fetchTripMembers` ne renvoie donc qu'une personne pour un non-propriétaire.
- Aucune politique DELETE pour les membres : `deleteTrip` échoue pour eux.
- `invite_code` (défaut `encode(gen_random_bytes(6),'hex')`) existe sur **chaque**
  ligne de `trip_members`, et `join_trip_by_invite` accepte n'importe lequel.
- Fonctions SECURITY DEFINER exposées : `join_trip_by_invite`, `is_trip_owner`,
  `handle_new_user`. Seule `is_trip_owner` fixe son `search_path`.

Volumétrie au 2026-07-29 : `trips` 4, `profiles` 3, `shared_trips` 2,
`trip_members` 0. La collaboration par code d'invitation n'a donc jamais servi ;
le partage par `shared_trips` (bouton « Partager ») si.

## Budget de temps de la fonction Edge — relevé le 2026-08-03

Chaque appel externe porte son propre `withTimeout`, mais rien ne borne la
somme. Additionnés dans le pire cas, en séquence :

| Chemin | Détail | Pire cas |
|---|---|---|
| TikTok | `resolve` 10 s + oEmbed 3 × 8 s + modèle 12 s + `geocode` 9 s + hashtags 3 × 9 s | **~82 s** |
| Google Maps | `resolve` 10 s (+10 s si interstitiel de consentement) + `reverseGeocodeRaw` 8 s + 2 × `nominatimSearch` 9 s | **~46 s** |

Côté client, `extractViaEdge` n'impose aucun plafond ; ailleurs le dépôt
applique pourtant un `Promise.race` de 4 500 ms (`AddActivitySheet.jsx:308`).
Ne pas redécouvrir ce calcul : il est la preuve du constat A-012.

## Contraintes de l'auditeur automatique

- Le bac à sable ne joint pas le domaine Supabase du projet (403 sur le CONNECT
  du proxy) : impossible de prouver une faille RLS par un appel REST réel. Le
  MCP Supabase, lui, passe — c'est par lui qu'on lit `pg_policies` et les droits.
- La branche de travail imposée par l'environnement d'exécution peut différer du
  `claude/audit-AAAA-MM-JJ` attendu. L'invariant à tenir est le préfixe
  `claude/`, jamais un push sur la branche par défaut.

## Décisions déjà tranchées

| Sujet | Décision |
|---|---|
| Stockage | Un objet JSON par voyage, pas de schéma relationnel |
| Google Places | Écarté définitivement |
| Tests | Pas de suite automatisée, vérification au rendu réel |
| Style | Un seul fichier CSS, pas de framework |
| Audience | Usage privé |
| Hébergement | Vercel, pas de migration |

## État de maturité

Projet personnel vivant, utilisé pour de vrais séjours. La barre de qualité est
celle d'un outil sur lequel on compte le jour J, pas celle d'un logiciel
commercial. Ce qui casse pendant un voyage compte. Ce qui n'est pas élégant dans le
code ne compte pas.
