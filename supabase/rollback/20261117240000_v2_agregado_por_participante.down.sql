-- ATENÇÃO: apaga os agregados congelados das partidas fechadas. Só com aval do Luiz.
drop trigger if exists partida_ao_encerrar on public.partida;
drop function if exists public.verificar_fechamento(uuid);
drop function if exists private.partida_ao_encerrar();
drop function if exists private.fechar_partida_agregado(uuid, boolean);
alter table public.partida_fechamento disable trigger partida_fechamento_imutavel;
drop table if exists public.partida_fechamento;
drop function if exists private.partida_fechamento_imutavel();
drop function if exists public.partida_agregado(uuid, timestamptz);
