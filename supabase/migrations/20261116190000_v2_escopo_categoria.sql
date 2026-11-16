-- ScoutHouse v2 · D-K · escopo de categoria por membro
-- Antes: todo membro do clube via todas as categorias (dado de menor além do necessário).
-- Agora: cada membro tem a lista de categorias que pode ver. NULL = todas (vale para quem já está no clube).
-- Admin sempre vê todas. Convite com papel "leitura" precisa dizer quais categorias.
-- Escrita continua exigindo papel admin/treinador/analista E a categoria liberada.

alter table public.team_members add column categorias text[]
  check (categorias is null or (cardinality(categorias) > 0 and categorias <@ array['Sub-15', 'Sub-16', 'Sub-17', 'Sub-20']));
alter table public.team_invites add column categorias text[]
  check (categorias is null or (cardinality(categorias) > 0 and categorias <@ array['Sub-15', 'Sub-16', 'Sub-17', 'Sub-20']));
alter table public.team_invites add constraint leitura_com_categorias check (role <> 'leitura' or categorias is not null);
comment on column public.team_members.categorias is 'Categorias que o membro vê. NULL = todas. Ignorado para admin.';

-- ---------- funções de acesso (fora da API) ----------
create function private.can_see_category(t uuid, cat text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.team_id = t and m.user_id = (select auth.uid())
    and (m.role = 'admin' or m.categorias is null or cat = any (m.categorias)));
$$;
create function private.can_write_category(t uuid, cat text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.team_id = t and m.user_id = (select auth.uid())
    and m.role in ('admin', 'treinador', 'analista')
    and (m.role = 'admin' or m.categorias is null or cat = any (m.categorias)));
$$;
create function private.can_see_match(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches x where x.id = mid and private.can_see_category(x.team_id, x.category));
$$;
create function private.can_write_match(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches x where x.id = mid and private.can_write_category(x.team_id, x.category));
$$;
create function private.can_see_athlete(t uuid, atleta text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a where a.team_id = t and a.id = atleta and private.can_see_category(a.team_id, a.category));
$$;
revoke all on function private.can_see_category(uuid, text), private.can_write_category(uuid, text), private.can_see_match(uuid),
  private.can_write_match(uuid), private.can_see_athlete(uuid, text) from public, anon;
grant execute on function private.can_see_category(uuid, text), private.can_write_category(uuid, text), private.can_see_match(uuid),
  private.can_write_match(uuid), private.can_see_athlete(uuid, text) to authenticated;

-- ---------- tabelas com coluna category ----------
do $$
declare t text;
begin
  foreach t in array array['athletes', 'calendar_events', 'scout_sessions', 'athlete_evaluations'] loop
    execute format('drop policy %1$s_select on public.%1$I', t);
    execute format('drop policy %1$s_insert on public.%1$I', t);
    execute format('drop policy %1$s_update on public.%1$I', t);
    execute format('drop policy %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (private.can_see_category(team_id, category))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (private.can_write_category(team_id, category))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (private.can_write_category(team_id, category)) with check (private.can_write_category(team_id, category))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (private.can_write_category(team_id, category))', t);
  end loop;
end $$;

drop policy matches_select on public.matches;
drop policy matches_insert on public.matches;
drop policy matches_update on public.matches;
create policy matches_select on public.matches for select to authenticated using (private.can_see_category(team_id, category));
create policy matches_insert on public.matches for insert to authenticated with check (private.can_write_category(team_id, category));
create policy matches_update on public.matches for update to authenticated using (private.can_write_category(team_id, category)) with check (private.can_write_category(team_id, category));
-- matches_delete continua só admin

-- ---------- relação e eventos: a categoria vem do jogo ----------
drop policy match_players_select on public.match_players;
drop policy match_players_insert on public.match_players;
drop policy match_players_update on public.match_players;
drop policy match_players_delete on public.match_players;
create policy match_players_select on public.match_players for select to authenticated using (private.can_see_match(match_id));
create policy match_players_insert on public.match_players for insert to authenticated with check (private.can_write_match(match_id));
create policy match_players_update on public.match_players for update to authenticated using (private.can_write_match(match_id)) with check (private.can_write_match(match_id));
create policy match_players_delete on public.match_players for delete to authenticated using (private.can_write_match(match_id));

drop policy match_events_select on public.match_events;
drop policy match_events_insert on public.match_events;
drop policy match_events_update on public.match_events;
create policy match_events_select on public.match_events for select to authenticated using (private.can_see_match(match_id));
create policy match_events_insert on public.match_events for insert to authenticated
  with check (private.can_write_match(match_id) and created_by = (select auth.uid()));
create policy match_events_update on public.match_events for update to authenticated
  using (created_by = (select auth.uid()) and private.can_write_match(match_id))
  with check (created_by = (select auth.uid()) and private.can_write_match(match_id));

-- ---------- LGPD: vínculo e consentimento seguem a categoria do atleta ----------
drop policy responsavel_atleta_select on public.responsavel_atleta;
create policy responsavel_atleta_select on public.responsavel_atleta for select to authenticated using (private.can_see_athlete(clube_id, atleta_id));
drop policy consentimento_select on public.consentimento;
create policy consentimento_select on public.consentimento for select to authenticated using (private.can_see_athlete(clube_id, atleta_id));
-- responsável (nome e contato do pai/mãe): admin vê todos; demais, só os ligados a atleta que enxergam
drop policy responsavel_select on public.responsavel;
create policy responsavel_select on public.responsavel for select to authenticated using (
  private.is_team_admin(clube_id)
  or exists (select 1 from public.responsavel_atleta ra where ra.responsavel_id = responsavel.id and private.can_see_athlete(ra.clube_id, ra.atleta_id)));

-- ---------- convite leva as categorias ----------
create or replace function public.accept_team_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_invite public.team_invites%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'não autenticado'; end if;
  select * into v_invite from public.team_invites where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Convite não encontrado. Confira o código.'; end if;
  if exists (select 1 from public.team_members where team_id = v_invite.team_id and user_id = (select auth.uid())) then
    return v_invite.team_id;
  end if;
  if v_invite.used_at is not null then raise exception 'Este convite já foi usado. Peça um novo.'; end if;
  if v_invite.expires_at < now() then raise exception 'Este convite expirou. Peça um novo.'; end if;
  insert into public.team_members (team_id, user_id, role, categorias) values (v_invite.team_id, (select auth.uid()), v_invite.role, v_invite.categorias);
  update public.team_invites set used_by = (select auth.uid()), used_at = now() where id = v_invite.id;
  return v_invite.team_id;
end $$;

-- lista de membros e clubes passam a devolver as categorias
drop function public.list_team_members(uuid);
create function public.list_team_members(p_team uuid) returns table (user_id uuid, email text, role text, joined_at timestamptz, categorias text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_team_member(p_team) then raise exception 'sem acesso a este time'; end if;
  return query select m.user_id, u.email::text, m.role, m.created_at, m.categorias from public.team_members m join auth.users u on u.id = m.user_id
    where m.team_id = p_team order by m.created_at;
end $$;
revoke all on function public.list_team_members(uuid) from public, anon;
grant execute on function public.list_team_members(uuid) to authenticated;

drop function public.my_clubs();
create function public.my_clubs() returns table (team_id uuid, name text, role text, athletes bigint, sessions bigint, evaluations bigint, joined_at timestamptz, categorias text[])
language sql stable security invoker set search_path = '' as $$
  select m.team_id, t.name, m.role,
    (select count(*) from public.athletes a where a.team_id = m.team_id and a.deleted_at is null),
    (select count(*) from public.scout_sessions s where s.team_id = m.team_id and s.deleted_at is null),
    (select count(*) from public.athlete_evaluations e where e.team_id = m.team_id and e.deleted_at is null),
    m.created_at,
    case when m.role = 'admin' then null else m.categorias end
  from public.team_members m join public.teams t on t.id = m.team_id
  where m.user_id = (select auth.uid())
  order by m.created_at;
$$;
revoke all on function public.my_clubs() from public, anon;
grant execute on function public.my_clubs() to authenticated;
