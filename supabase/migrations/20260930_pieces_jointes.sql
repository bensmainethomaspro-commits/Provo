-- Les pièces jointes des voyages, rangées à part (30 septembre 2026).
--
-- Photos de couverture, captures et billets vivaient en base64 DANS le voyage
-- (colonne `trips.data`) : chaque synchronisation les renvoyait tous, et le
-- stockage local du téléphone plafonnait vers 5 Mo. L'app les range désormais
-- à côté (IndexedDB sur le téléphone) et dépose ici une copie de chacune, pour
-- les autres téléphones du voyage.
--
-- Rangement : pieces/<id du voyage>/<empreinte du contenu>. L'empreinte rend
-- chaque dépôt idempotent : même contenu, même chemin, et un second dépôt du
-- même fichier est refusé comme doublon, ce que l'app compte comme réussi.
--
-- Qui y a accès : exactement ceux qui ont accès au voyage (propriétaire et
-- membres). Personne d'autre, et pas les visiteurs anonymes. Rien n'est
-- public : un billet porte un nom, un numéro de dossier, un code-barres.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pieces', 'pieces', false, 6291456,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Propriétaire ou membre du voyage. `security definer` : les politiques de
-- `trips` et `trip_members` ne laissent pas lire les lignes des autres, et la
-- question « suis-je de ce voyage ? » doit pouvoir se poser quand même.
create or replace function public.est_du_voyage(p_trip_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from trips where id = p_trip_id and owner_id = auth.uid())
      or exists (select 1 from trip_members where trip_id = p_trip_id and user_id = auth.uid());
$$;

revoke execute on function public.est_du_voyage(text) from public, anon;
grant execute on function public.est_du_voyage(text) to authenticated;

drop policy if exists "pièces : lues par les gens du voyage" on storage.objects;
create policy "pièces : lues par les gens du voyage"
  on storage.objects for select to authenticated
  using (bucket_id = 'pieces' and public.est_du_voyage((storage.foldername(name))[1]));

drop policy if exists "pièces : déposées par les gens du voyage" on storage.objects;
create policy "pièces : déposées par les gens du voyage"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pieces' and public.est_du_voyage((storage.foldername(name))[1]));

-- Ni mise à jour ni suppression : une pièce est identifiée par son contenu,
-- elle ne change jamais. Un fichier devenu inutile reste en place (quelques
-- centaines de ko) plutôt que d'ouvrir un droit d'effacement sur les billets
-- des autres membres.
