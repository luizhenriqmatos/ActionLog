-- DOWN da Fase 2.1. Seguro enquanto o app não lê categoria_id (nenhuma versão publicada lê).
do $$
declare t text;
begin
  foreach t in array array['athletes', 'calendar_events', 'scout_sessions', 'athlete_evaluations', 'matches'] loop
    execute format('drop trigger if exists %1$s_fill_categoria on public.%1$I', t);
    execute format('alter table public.%1$I drop column if exists categoria_id', t);
  end loop;
end $$;
drop trigger if exists teams_seed_categorias on public.teams;
drop function if exists private.fill_categoria_id();
drop function if exists private.seed_categorias();
drop table if exists public.categoria;
