-- Funções auxiliares de RLS fora do schema exposto pela API (não podem ser chamadas via /rpc).
create schema if not exists private;
alter function public.is_team_member(uuid) set schema private;
alter function public.can_write_team(uuid) set schema private;
alter function public.is_team_admin(uuid) set schema private;
alter function public.add_team_creator() set schema private;

revoke all on function private.is_team_member(uuid), private.can_write_team(uuid), private.is_team_admin(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_team_member(uuid), private.can_write_team(uuid), private.is_team_admin(uuid) to authenticated;
revoke all on function private.add_team_creator() from public, anon, authenticated;
