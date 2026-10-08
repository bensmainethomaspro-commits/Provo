-- Partage et collaboration : fermer ce qui était ouvert à tous.
-- Appliquée le 30 septembre 2026 par le connecteur Supabase (audit Pareto).
--
-- 1 · shared_trips (audit A-001, ouvert depuis le 29 juillet, sévérité Critique)
--     Les politiques `public_read`, `public_update` et `public_insert` valaient
--     `true`, avec les droits `anon`. La clé publique est dans le paquet de
--     l'app : n'importe qui pouvait LISTER tous les voyages partagés (noms,
--     dépenses, voyageurs), les RÉÉCRIRE, et remplir la table.
--     Désormais : lecture d'UNE copie par son identifiant seulement, via
--     `lire_voyage_partage` (un uuid aléatoire, donc un lien qu'on ne devine
--     pas) ; création réservée à un compte connecté, qui en devient l'auteur ;
--     plus aucune mise à jour. Les deux liens existants continuent de s'ouvrir.
--
-- 2 · trips.owner_id (audit A-007)
--     `member_update` laissait un membre réécrire `owner_id`, donc déposséder
--     le propriétaire. Un déclencheur refuse tout changement de propriétaire.
--
-- 3 · Invitations (audit A-004)
--     `join_trip_by_invite` acceptait le code de N'IMPORTE QUEL membre, et
--     retirer un membre ne révoquait rien : il gardait le lien, et le lien
--     marchait encore. Seul le code du propriétaire fait entrer, et il change
--     quand un membre est retiré. La fonction fixe aussi son `search_path`
--     (avertissement Supabase `function_search_path_mutable`).
--
-- 4 · Fonctions SECURITY DEFINER exécutables par `anon` (avertissement 0028)
--     Plus d'exécution sans compte. `handle_new_user` n'est qu'un déclencheur :
--     le privilège EXECUTE n'est vérifié qu'à la création du déclencheur, pas
--     quand il se déclenche.
--
-- 5 · profiles lisible sans compte (`read_any_profile`, USING true, rôle public)
--     Les prénoms de tous les comptes étaient lisibles avec la seule clé
--     publique. Un compte connecté les lit toujours (`Authenticated users can
--     read profiles`), c'est ce dont les co-voyageurs ont besoin.

-- ── 1 ───────────────────────────────────────────────────────────────────────
alter table public.shared_trips
  add column if not exists owner_id uuid default auth.uid() references auth.users (id) on delete set null;

drop policy if exists public_read on public.shared_trips;
drop policy if exists public_update on public.shared_trips;
drop policy if exists public_insert on public.shared_trips;

create policy "copie : créée par un compte, à son nom" on public.shared_trips
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

revoke all on table public.shared_trips from anon;
revoke update, delete, truncate on table public.shared_trips from authenticated;

create or replace function public.lire_voyage_partage(p_share_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select data from public.shared_trips where share_id = p_share_id
$$;

revoke all on function public.lire_voyage_partage(uuid) from public;
grant execute on function public.lire_voyage_partage(uuid) to anon, authenticated;

-- ── 2 ───────────────────────────────────────────────────────────────────────
create or replace function public.garder_proprietaire()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Le propriétaire d''un voyage ne change pas' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trips_garder_proprietaire on public.trips;
create trigger trips_garder_proprietaire
  before update of owner_id on public.trips
  for each row execute function public.garder_proprietaire();

-- ── 3 ───────────────────────────────────────────────────────────────────────
create or replace function public.join_trip_by_invite(p_invite_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id text;
  v_trip_data jsonb;
begin
  if v_uid is null then
    return json_build_object('error', 'Connecte-toi pour rejoindre ce voyage');
  end if;

  -- Seul le code du PROPRIÉTAIRE fait entrer : celui qu'il a partagé, et qui
  -- change quand il retire quelqu'un.
  select tm.trip_id into v_trip_id
  from public.trip_members tm
  where tm.invite_code = p_invite_code and tm.role = 'owner'
  limit 1;

  if v_trip_id is null then
    return json_build_object('error', 'Ce lien d''invitation n''est plus valable');
  end if;

  if not exists (select 1 from public.trip_members where trip_id = v_trip_id and user_id = v_uid) then
    insert into public.trip_members (trip_id, user_id, role) values (v_trip_id, v_uid, 'editor');
  end if;

  select data into v_trip_data from public.trips where id = v_trip_id;
  return json_build_object('trip_id', v_trip_id, 'data', v_trip_data);
end
$$;

create or replace function public.renouveler_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trip_members
     set invite_code = encode(extensions.gen_random_bytes(6), 'hex')
   where trip_id = old.trip_id and role = 'owner';
  return old;
end
$$;

drop trigger if exists trip_members_renouveler_invitation on public.trip_members;
create trigger trip_members_renouveler_invitation
  after delete on public.trip_members
  for each row when (old.role <> 'owner')
  execute function public.renouveler_invitation();

-- ── 4 ───────────────────────────────────────────────────────────────────────
revoke execute on function public.join_trip_by_invite(text) from public, anon;
grant execute on function public.join_trip_by_invite(text) to authenticated;

revoke execute on function public.is_trip_owner(text) from public, anon;
grant execute on function public.is_trip_owner(text) to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function public.garder_proprietaire() from public, anon, authenticated;
revoke execute on function public.renouveler_invitation() from public, anon, authenticated;

-- ── 5 ───────────────────────────────────────────────────────────────────────
drop policy if exists read_any_profile on public.profiles;
