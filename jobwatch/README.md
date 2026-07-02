# 🔎 JobWatch — veille de postes HRBP / L&D

Agrégateur d'offres d'emploi qui surveille **Welcome to the Jungle**, **LinkedIn**
(best effort) et les **pages carrières** de tes entreprises cibles, calcule un
**score d'adéquation** avec ton profil (HRBP, L&D, Paris, alternance/CDI) et
t'envoie un **digest email chaque matin**.

App indépendante de Provo, mais hébergée dans le même repo et le même projet
Supabase (tables préfixées `jobwatch_`, même compte utilisateur).

## ⚠️ Limite à connaître : LinkedIn

LinkedIn **bloque activement les bots** (HTTP 429/999, captchas, rotation
d'empreintes). JobWatch utilise l'endpoint « invité » de recherche d'offres
(accessible sans connexion), qui fonctionne par intermittence et **peut cesser
de fonctionner à tout moment**. Quand il casse, la source est simplement
marquée en erreur et le reste de la collecte continue. Les sources **fiables**
sont Welcome to the Jungle (API de recherche publique) et les pages carrières
via les API JSON publiques des ATS **Greenhouse, Lever et Recruitee**.

## Architecture

```
jobwatch/                          # Frontend React (Vite) — offres scorées + réglages
supabase/migrations/…_jobwatch.sql # Tables : settings, companies, jobs, matches (RLS)
supabase/functions/
  _shared/jobwatch.ts              # Scoring par règles + auth des appels
  jobwatch-fetch/                  # Collecte multi-sources + déduplication + scoring
  jobwatch-digest/                 # Compose et envoie l'email du matin (Resend)
```

### Scoring (0–100, par règles pondérées)

| Critère                              | Points |
|--------------------------------------|--------|
| Intitulé recherché dans le **titre** | 45 (22 si seulement dans le descriptif) |
| **Localisation** acceptée            | 20 (8 si inconnue) |
| **Type de contrat** voulu            | 20 (8 si inconnu) |
| **Mots-clés bonus** dans le descriptif | +5 chacun, max 15 |

Tout est modifiable dans l'onglet Réglages (mots-clés, villes, contrats, seuil
du digest). Exemple : « HRBP Senior · Paris · CDI » → 95.

## Déploiement

### 1. Base de données

Appliquer la migration `supabase/migrations/20260702090000_jobwatch.sql`
(SQL Editor du dashboard, ou `supabase db push`).

### 2. Edge functions

```sh
supabase functions deploy jobwatch-fetch --no-verify-jwt
supabase functions deploy jobwatch-digest --no-verify-jwt
```

`--no-verify-jwt` est nécessaire pour les appels du cron ; les fonctions
revalident elles-mêmes chaque appel (JWT utilisateur **ou** secret cron).

### 3. Secrets (dashboard → Edge Functions → Secrets)

| Secret | Rôle |
|--------|------|
| `JOBWATCH_CRON_SECRET` | Chaîne aléatoire partagée avec le cron (obligatoire pour la planification) |
| `RESEND_API_KEY` | Clé API [Resend](https://resend.com) pour l'envoi d'emails (gratuit jusqu'à 3 000/mois) |
| `JOBWATCH_EMAIL_FROM` | Optionnel — expéditeur (défaut : `JobWatch <onboarding@resend.dev>`, qui ne peut envoyer qu'à l'adresse du compte Resend ; brancher un domaine vérifié pour un vrai « from ») |
| `WTTJ_ALGOLIA_APP` / `WTTJ_ALGOLIA_KEY` / `WTTJ_INDEX` | Optionnel — surcharge des clés publiques de recherche WTTJ si elles changent |

### 4. Cron du matin (pg_cron + pg_net, SQL Editor)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Collecte à 7h00 Paris (5h00 UTC en été, prendre 6h00 UTC en hiver)
select cron.schedule('jobwatch-fetch-morning', '0 5 * * *', $$
  select net.http_post(
    url := 'https://usztistixgzdrvjzplqx.supabase.co/functions/v1/jobwatch-fetch',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "LE_MEME_SECRET_QUE_JOBWATCH_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- Digest à 7h30 Paris
select cron.schedule('jobwatch-digest-morning', '30 5 * * *', $$
  select net.http_post(
    url := 'https://usztistixgzdrvjzplqx.supabase.co/functions/v1/jobwatch-digest',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "LE_MEME_SECRET_QUE_JOBWATCH_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```

### 5. Frontend

```sh
cd jobwatch
npm install
npm run dev        # local
npm run build      # dist/ à déployer (Vercel, Netlify…)
```

Sur Vercel : projet avec *root directory* `jobwatch`, framework Vite.

## Premier lancement

1. Connecte-toi (même compte que Provo, ou crée-le).
2. Le profil par défaut (HRBP, L&D, Paris, CDI/alternance) et une liste
   d'entreprises cibles sont créés automatiquement — ajuste-les dans Réglages.
3. Les **slugs ATS pré-remplis sont des hypothèses** : clique « Tester » sur
   chaque entreprise (ou lance une collecte et regarde le statut affiché) et
   corrige slug/type si besoin.
4. « ↻ Actualiser » lance une collecte immédiate ; « Prévisualiser » montre le
   digest sans l'envoyer.

## Comportement du digest

- Uniquement les offres **jamais digérées**, vues il y a moins de 72 h, avec
  un score ≥ ton seuil (défaut 40), triées par score, 30 max.
- Pas de nouvelles offres → **pas d'email** (pas de bruit).
- Les entreprises en « lien manuel » (ATS propriétaires : L'Oréal, LVMH…)
  apparaissent en pied de digest comme rappels à vérifier à la main.
