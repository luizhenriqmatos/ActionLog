-- DOWN da Fase 2.5. Não aplicar em dia de jogo.
drop index if exists public.match_events_ordem_idx;
create or replace function private.match_event_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.match_id, new.team_id, new.kind, new.athlete_id, new.period, new.clock_seconds, new.created_by, new.created_at)
     is distinct from (old.id, old.match_id, old.team_id, old.kind, old.athlete_id, old.period, old.clock_seconds, old.created_by, old.created_at) then
    raise exception 'evento não pode ser alterado; use desfazer';
  end if;
  return new;
end $$;
drop trigger if exists match_events_stamp on public.match_events;
drop function if exists private.match_event_stamp();
alter table public.match_events
  drop column if exists metadados, drop column if exists evento_pai_id, drop column if exists grupo_duplicata_id, drop column if exists status,
  drop column if exists origem, drop column if exists ts_servidor, drop column if exists ts_cliente, drop column if exists sessao_registro_id, drop column if exists dispositivo_id;
