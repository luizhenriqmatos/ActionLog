-- DOWN do D-L: desliga as recusas. Para só desligar sem perder o histórico de setores, basta o primeiro comando.
drop trigger if exists match_events_escopo on public.match_events;
drop function if exists private.match_event_escopo();
drop function if exists public.assumir_setor(uuid, text, text, boolean);
drop trigger if exists matches_comando_track on public.matches;
drop function if exists private.match_comando_track();
drop table if exists public.match_comando;
alter table public.match_events drop constraint if exists match_events_sessao_fk;
drop table if exists public.sessao_registro;
