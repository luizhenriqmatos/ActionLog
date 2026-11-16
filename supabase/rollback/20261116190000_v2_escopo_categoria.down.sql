-- DOWN do D-K: volta todas as policies para "membro vê tudo do clube".
do $$
declare t text;
begin
  foreach t in array array['athletes', 'calendar_events', 'scout_sessions', 'athlete_evaluations'] loop
    execute format('drop policy %1$s_select on public.%1$I', t);
    execute format('drop policy %1$s_insert on public.%1$I', t);
    execute format('drop policy %1$s_update on public.%1$I', t);
    execute format('drop policy %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (private.is_team_member(team_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (private.can_write_team(team_id))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (private.can_write_team(team_id)) with check (private.can_write_team(team_id))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (private.can_write_team(team_id))', t);
  end loop;
end $$;
drop policy matches_select on public.matches; drop policy matches_insert on public.matches; drop policy matches_update on public.matches;
create policy matches_select on public.matches for select to authenticated using (private.is_team_member(team_id));
create policy matches_insert on public.matches for insert to authenticated with check (private.can_write_team(team_id));
create policy matches_update on public.matches for update to authenticated using (private.can_write_team(team_id)) with check (private.can_write_team(team_id));
drop policy match_players_select on public.match_players; drop policy match_players_insert on public.match_players;
drop policy match_players_update on public.match_players; drop policy match_players_delete on public.match_players;
create policy match_players_select on public.match_players for select to authenticated using (private.is_team_member(team_id));
create policy match_players_insert on public.match_players for insert to authenticated with check (private.can_write_team(team_id));
create policy match_players_update on public.match_players for update to authenticated using (private.can_write_team(team_id)) with check (private.can_write_team(team_id));
create policy match_players_delete on public.match_players for delete to authenticated using (private.can_write_team(team_id));
drop policy match_events_select on public.match_events; drop policy match_events_insert on public.match_events; drop policy match_events_update on public.match_events;
create policy match_events_select on public.match_events for select to authenticated using (private.is_team_member(team_id));
create policy match_events_insert on public.match_events for insert to authenticated with check (private.can_write_team(team_id) and created_by = (select auth.uid()));
create policy match_events_update on public.match_events for update to authenticated
  using (created_by = (select auth.uid()) and private.can_write_team(team_id)) with check (created_by = (select auth.uid()) and private.can_write_team(team_id));
drop policy responsavel_atleta_select on public.responsavel_atleta;
create policy responsavel_atleta_select on public.responsavel_atleta for select to authenticated using (private.is_team_member(clube_id));
drop policy consentimento_select on public.consentimento;
create policy consentimento_select on public.consentimento for select to authenticated using (private.is_team_member(clube_id));
drop policy responsavel_select on public.responsavel;
create policy responsavel_select on public.responsavel for select to authenticated using (private.is_team_member(clube_id));
-- funções e colunas podem ficar (não restringem nada sem as policies); para remover de vez:
-- drop function private.can_see_athlete(uuid, text), private.can_write_match(uuid), private.can_see_match(uuid), private.can_write_category(uuid, text), private.can_see_category(uuid, text);
-- alter table public.team_invites drop constraint leitura_com_categorias, drop column categorias; alter table public.team_members drop column categorias;
