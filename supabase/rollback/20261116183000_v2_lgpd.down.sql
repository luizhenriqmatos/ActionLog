-- DOWN da Fase 2.4. ATENÇÃO: apaga consentimentos e responsáveis registrados. Exporte antes se houver linhas.
-- Anonimização já executada NÃO é desfeita por este script (o dado pessoal não existe mais).
drop trigger if exists athletes_keep_anonymized on public.athletes;
drop function if exists private.athlete_keep_anonymized();
drop function if exists private.anonimizar_atleta(uuid, text, text);
drop table if exists public.anonimizacao_log;
alter table public.athletes drop column if exists anonimizado_em;
drop trigger if exists teams_seed_retencao on public.teams;
drop function if exists private.seed_politica_retencao();
drop table if exists public.politica_retencao;
drop view if exists public.consentimento_vigente;
drop table if exists public.consentimento;
drop function if exists private.consentimento_so_revoga();
drop table if exists public.texto_legal;
drop function if exists private.texto_legal_imutavel();
drop table if exists public.responsavel_atleta;
drop table if exists public.responsavel;
