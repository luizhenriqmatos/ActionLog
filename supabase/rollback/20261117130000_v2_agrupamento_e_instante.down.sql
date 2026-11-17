drop trigger if exists calendar_events_fill_inicio on public.calendar_events;
drop function if exists private.fill_inicio_previsto();
alter table public.calendar_events drop column if exists inicio_previsto, drop column if exists hora_presumida;
update public.partida_participante set equipe_externa_id = null;
delete from public.equipe_externa;
