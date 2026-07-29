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

Aucune dépendance payante. Tous les services externes sont gratuits et sans clé :
Nominatim, Overpass, Open-Meteo, OSRM, Wikipédia, Frankfurter, Google News RSS via
rss2json, tuiles OSM, et des proxys CORS de secours interrogés en parallèle.

## Architecture à connaître

- `src/hooks/useTrips.js` : modèle de données, persistance, synchro, collaboration.
  C'est le fichier le plus critique du projet.
- `src/utils/enrich.js` : complétion automatique des fiches.
- `src/lib/supabase.js` : client Supabase, URL et clé publiable.
- `supabase/functions/extract-place/index.ts` : fonction Edge Deno qui résout les
  liens courts et extrait les métadonnées d'une page tierce. Utilise
  optionnellement le secret ANTHROPIC_API_KEY.
- `.github/workflows/deploy-edge-functions.yml` : déploie automatiquement sur push
  vers main dès que `supabase/functions/**` change.

**Modèle de données** : un voyage entier tient dans un seul objet JSON, stocké tel
quel dans localStorage (`provo_trips`) et dans la colonne `data` de la table
`trips`. Il n'y a pas de schéma relationnel côté application. C'est un choix, pas
un oubli.

**Persistance en trois couches** : localStorage écrit à chaque changement, puis
Supabase avec synchronisation différée de 700 ms et comparaison d'empreinte, puis
Realtime via `postgres_changes`.

Tables Supabase : `trips`, `trip_members`, `profiles`, `shared_trips`. Elles
cohabitent dans le même projet Supabase que l'application sœur JobWatch, dont les
tables sont préfixées `jobwatch_`.

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
