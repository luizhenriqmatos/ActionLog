drop trigger if exists match_events_periodos on public.match_events;
drop function if exists private.periodos_espelho();
drop function if exists private.recalcular_periodos(uuid);
drop table if exists public.periodo_partida;
