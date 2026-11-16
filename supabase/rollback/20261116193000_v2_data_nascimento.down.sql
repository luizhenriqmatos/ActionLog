-- DOWN da data de nascimento. ATENÇÃO: apaga as datas cadastradas.
drop trigger if exists consentimento_fim_maioridade on public.consentimento;
drop function if exists private.consentimento_fim_maioridade();
drop function if exists private.data_maioridade(uuid, text);
alter table public.athletes drop column if exists birth_date;
-- reaplicar a versão de anonimizar_atleta/athlete_keep_anonymized de 20261116183000_v2_lgpd.sql
