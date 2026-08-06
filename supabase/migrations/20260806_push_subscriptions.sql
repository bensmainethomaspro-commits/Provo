-- Provo — abonnements aux notifications
--
-- À exécuter une fois dans Supabase › SQL Editor.
--
-- Un abonnement identifie un NAVIGATEUR, pas une personne : le même compte sur
-- un téléphone et un ordinateur en a deux. La clé est donc l'`endpoint` fourni
-- par le service de push, et c'est lui qui porte l'unicité.

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  fuseau      text not null default 'Europe/Paris',
  -- Ce qui a déjà été envoyé, pour ne pas répéter le même rappel à chaque
  -- passage du planificateur. Clé = identifiant d'activité + type de rappel.
  envoyes     jsonb not null default '{}'::jsonb,
  cree_le     timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Chacun ne voit et ne gère que ses propres abonnements. La fonction Edge, elle,
-- passe par la clé de service et n'est pas soumise à ces règles.
create policy "ses propres abonnements — lecture"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

create policy "ses propres abonnements — création"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "ses propres abonnements — mise à jour"
  on public.push_subscriptions for update
  using (auth.uid() = user_id);

create policy "ses propres abonnements — suppression"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);
