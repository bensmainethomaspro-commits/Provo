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

-- Pas de `with check` ici, et c'est volontaire — pas un oubli. PostgreSQL :
-- « pour les politiques UPDATE, si aucune expression WITH CHECK n'est définie,
-- l'expression USING sert aussi de contrôle sur la nouvelle ligne. »
-- Réaffecter sa ligne à l'`user_id` d'un autre échoue donc déjà, et
-- `pg_policies` affiche `with_check: null` précisément dans ce cas.
-- Un audit d'août 2026 y a lu une faille et a proposé un correctif ; l'attaque
-- n'avait pas été exercée. Si elle l'est un jour et qu'elle passe, c'est ce
-- commentaire qui est faux — pas l'inverse.
create policy "ses propres abonnements — mise à jour"
  on public.push_subscriptions for update
  using (auth.uid() = user_id);

create policy "ses propres abonnements — suppression"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);
