-- DOWN da Fase 3.1. Seguro enquanto a flag partida_v2 só espelha: o modelo antigo (matches) nunca deixou de ser a fonte de verdade.
-- ATENÇÃO: apaga sessao, partida, participantes, equipe_externa e as flags. Nada em matches/match_events é tocado.
drop trigger if exists matches_espelho on public.matches;
drop function if exists private.matches_espelho();
drop function if exists private.espelhar_partida(public.matches);
drop function if exists public.partida_placar(uuid);
drop table if exists public.partida_participante;
drop table if exists public.partida;
drop table if exists public.sessao;
drop table if exists public.equipe_externa;
drop table if exists public.clube_recurso;
drop function if exists private.valida_participantes();
drop function if exists private.valida_partida_tem_lados();
drop function if exists private.sync_participante_inicio();
