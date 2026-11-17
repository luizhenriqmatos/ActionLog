drop trigger if exists match_events_anular_derivados on public.match_events;
drop trigger if exists match_events_derivar_vermelho on public.match_events;
drop trigger if exists match_events_disciplina on public.match_events;
drop function if exists private.match_event_anular_derivados(), private.match_event_derivar_vermelho(), private.match_event_disciplina();
delete from public.tipo_evento where codigo in ('cartao_amarelo','cartao_vermelho','cartao_vermelho_2o_amarelo','impedimento');
