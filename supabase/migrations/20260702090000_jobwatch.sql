-- JobWatch : agrégateur de veille de postes
-- Tables préfixées jobwatch_ pour cohabiter avec l'app Provo (voyage).

-- ─────────────────────────────────────────────────────────────
-- Réglages / profil de recherche (1 ligne par utilisateur)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.jobwatch_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  title_keywords text[] not null default array[
    'HRBP', 'HR Business Partner', 'Human Resources Business Partner',
    'L&D', 'Learning & Development', 'Learning and Development',
    'Responsable formation', 'Chargé de formation', 'Talent Development',
    'People Partner', 'People Development'
  ],
  bonus_keywords text[] not null default array[
    'ressources humaines', 'people', 'talent', 'formation',
    'développement des compétences', 'onboarding', 'engagement'
  ],
  locations text[] not null default array['Paris', 'Île-de-France', 'Ile-de-France', 'Remote', 'Télétravail'],
  contract_types text[] not null default array['CDI', 'Alternance', 'Apprentissage', 'Contrat pro'],
  search_queries text[] not null default array['HRBP', 'Learning Development', 'Responsable formation'],
  min_score int not null default 40,
  digest_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobwatch_settings enable row level security;

create policy "jobwatch_settings own rows"
  on public.jobwatch_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Entreprises cibles (pages carrières à surveiller)
-- source_type :
--   greenhouse : https://boards-api.greenhouse.io/v1/boards/{slug}/jobs (JSON public)
--   lever      : https://api.lever.co/v0/postings/{slug}?mode=json (JSON public)
--   recruitee  : https://{slug}.recruitee.com/api/offers/ (JSON public)
--   wttj       : filtre par entreprise dans la recherche Welcome to the Jungle
--   link       : simple lien vers la page carrières (pas de scraping, ATS propriétaire)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.jobwatch_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('greenhouse', 'lever', 'recruitee', 'wttj', 'link')),
  slug text,
  careers_url text,
  active boolean not null default true,
  last_fetch_at timestamptz,
  last_fetch_status text,
  created_at timestamptz not null default now()
);

create index if not exists jobwatch_companies_user_idx on public.jobwatch_companies (user_id);

alter table public.jobwatch_companies enable row level security;

create policy "jobwatch_companies own rows"
  on public.jobwatch_companies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Offres collectées (partagées entre utilisateurs, écrites par
-- les edge functions avec la clé service — la RLS ne les bloque pas)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.jobwatch_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('wttj', 'linkedin', 'greenhouse', 'lever', 'recruitee')),
  external_id text not null,
  company_name text,
  title text not null,
  location text,
  contract_type text,
  url text not null,
  description text,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  raw jsonb,
  unique (source, external_id)
);

create index if not exists jobwatch_jobs_seen_idx on public.jobwatch_jobs (first_seen_at desc);

alter table public.jobwatch_jobs enable row level security;

create policy "jobwatch_jobs readable by authenticated"
  on public.jobwatch_jobs for select
  to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- Correspondances offre ↔ utilisateur avec score d'adéquation
-- status : new | seen | saved | hidden
-- ─────────────────────────────────────────────────────────────
create table if not exists public.jobwatch_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobwatch_jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  score int not null,
  breakdown jsonb,
  status text not null default 'new' check (status in ('new', 'seen', 'saved', 'hidden')),
  digested_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, user_id)
);

create index if not exists jobwatch_matches_user_idx on public.jobwatch_matches (user_id, created_at desc);

alter table public.jobwatch_matches enable row level security;

create policy "jobwatch_matches select own"
  on public.jobwatch_matches for select
  using (auth.uid() = user_id);

create policy "jobwatch_matches update own"
  on public.jobwatch_matches for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
