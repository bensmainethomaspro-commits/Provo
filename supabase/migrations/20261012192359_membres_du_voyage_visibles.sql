-- Qui est sur le voyage : visible par tous ceux qui y sont (12 octobre 2026).
--
-- `trip_members` ne se lisait que ligne à ligne : `member_read_own` ne montre à
-- chacun que SA propre ligne, et `owner_manage_members` ouvre tout — mais au
-- seul propriétaire. Un collaborateur qui ouvrait « Membres du compte » voyait
-- donc une liste d'une personne : lui. La feuille Partager promet pourtant
-- « mêmes dépenses, pour tout le monde », et c'est ce lien compte ↔ voyageur
-- qui dit à l'écran des dépenses qui est « Moi » : payeur par défaut, part
-- affichée, « (Moi) » dans les listes.
--
-- La question « suis-je de ce voyage ? » a déjà sa réponse : `est_du_voyage`,
-- écrite le 30 septembre pour les pièces jointes. Elle est `security definer`,
-- donc elle ne relance pas les politiques de `trip_members` — c'est ce qui
-- évite la récursion infinie corrigée le 26 juin.
--
-- CE QUE ÇA OUVRE, EXACTEMENT : l'identifiant de compte et le rôle des gens du
-- MÊME voyage. Mesuré avant d'appliquer, sur deux membres posés puis annulés :
-- le collaborateur passe de 1 ligne à 2, le propriétaire reste à 2, un compte
-- étranger au voyage voit 0, et le collaborateur ne voit rien hors de ses
-- propres voyages. Les noms affichés viennent de `profiles`, déjà lisible par
-- n'importe quel compte connecté ; aucune adresse e-mail n'y est rangée.
--
-- `member_read_own` reste : les politiques permissives s'additionnent (OU), et
-- la garder laisse en première ligne la règle la plus simple et la moins chère.
-- `to authenticated` parce que `est_du_voyage` n'est pas donnée aux visiteurs
-- anonymes, et qu'une politique qui lève vaut moins qu'une politique qui tait.
--
-- Posée sous condition, et non `drop` puis `create` : PostgreSQL n'offre pas
-- `create policy if not exists` (c'est ce qui bloquait le workflow des rappels,
-- audit A-076), et rejouer ce fichier ne doit rien casser.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'trip_members'
      and policyname = 'membre_lit_les_membres'
  ) then
    create policy "membre_lit_les_membres" on public.trip_members
      for select to authenticated
      using (public.est_du_voyage(trip_id));
  end if;
end $$;
