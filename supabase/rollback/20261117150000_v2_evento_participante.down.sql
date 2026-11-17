drop trigger if exists match_events_participante on public.match_events;
drop function if exists private.match_event_participante();
alter table public.match_events drop column if exists participante_id;
-- reaplicar private.match_event_immutable de 20261116184000_v2_match_events_colunas.sql (sem a checagem de participante_id)
