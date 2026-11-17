drop trigger if exists teams_recurso_partida_v2 on public.teams;
drop function if exists private.clube_novo_recurso();
drop table if exists public.espelho_falha;
-- reaplicar private.matches_espelho / periodos_espelho de 20261117120000 e 20261117140000 (sem o bloco de exceção)
