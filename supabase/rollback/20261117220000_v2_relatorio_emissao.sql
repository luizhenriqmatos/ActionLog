-- ATENÇÃO: apagar relatorio_emissao apaga a prova de a quem os relatórios foram entregues. Exporte antes.
drop function if exists public.relatorio_publico(text), public.revogar_relatorio(uuid), public.emitir_relatorio(uuid, text, uuid, text, jsonb, boolean);
drop table if exists public.relatorio_emissao;
