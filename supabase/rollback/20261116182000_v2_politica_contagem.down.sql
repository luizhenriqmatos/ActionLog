-- DOWN da Fase 2.3.
drop trigger if exists matches_freeze_politica on public.matches;
drop trigger if exists teams_seed_politica on public.teams;
alter table public.matches drop column if exists politica_contagem_efetiva, drop column if exists tipo_partida_codigo;
drop function if exists private.match_freeze_politica();
drop function if exists private.politica_snapshot(uuid, text);
drop function if exists private.seed_politica_trigger();
drop function if exists private.seed_politica_contagem(uuid);
drop table if exists public.politica_contagem;
drop table if exists public.tipo_partida;
