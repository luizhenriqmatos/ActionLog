-- ScoutHouse v2 · data de nascimento do atleta
-- Opcional (atleta antigo não tem). Serve para a idade exata e para o fim do consentimento dado pelo responsável (maioridade).

alter table public.athletes add column birth_date date check (birth_date >= date '1950-01-01');

-- 18 anos depois do nascimento; nulo se a data não foi informada
create function private.data_maioridade(clube uuid, atleta text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (a.birth_date + interval '18 years')::timestamptz from public.athletes a where a.team_id = clube and a.id = atleta;
$$;
revoke all on function private.data_maioridade(uuid, text) from public, anon, authenticated;

-- consentimento do responsável sem fim informado vence na maioridade, quando a data de nascimento existe
create function private.consentimento_fim_maioridade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.outorgado_por = 'responsavel' and new.vigencia_fim is null then
    new.vigencia_fim := private.data_maioridade(new.clube_id, new.atleta_id);
  end if;
  return new;
end $$;
revoke all on function private.consentimento_fim_maioridade() from public, anon, authenticated;
create trigger consentimento_fim_maioridade before insert on public.consentimento
  for each row execute function private.consentimento_fim_maioridade();

-- aparelho antigo não conhece birth_date: o upsert dele não manda a coluna, então ela não é apagada.
-- Na anonimização, a data some junto com o resto.
create or replace function private.anonimizar_atleta(clube uuid, atleta text, motivo text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare rotulo constant text := 'Atleta anonimizado';
begin
  if not exists (select 1 from public.athletes where team_id = clube and id = atleta) then
    raise exception 'atleta não encontrado neste clube';
  end if;
  update public.athletes set name = rotulo, number = '', age = '', height = '', weight = '', birth_date = null, anonimizado_em = now(), updated_at = now()
    where team_id = clube and id = atleta;
  update public.scout_sessions set athlete_name = rotulo, updated_at = now() where team_id = clube and athlete_id = atleta;
  update public.match_players set athlete_name = rotulo, number = '', updated_at = now() where team_id = clube and athlete_id = atleta;
  update public.athlete_evaluations set athlete_name = rotulo, strengths = '', improvements = '', goals = '', coach_note = '', updated_at = now()
    where team_id = clube and athlete_id = atleta;
  update public.responsavel_atleta set vigencia_fim = current_date where clube_id = clube and atleta_id = atleta and (vigencia_fim is null or vigencia_fim > current_date);
  update public.consentimento set revogado_em = now() where clube_id = clube and atleta_id = atleta and revogado_em is null;
  insert into public.anonimizacao_log (clube_id, atleta_id, motivo, executado_por) values (clube, atleta, motivo, (select auth.uid()));
end $$;

create or replace function private.athlete_keep_anonymized() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.anonimizado_em is not null then
    new.name := old.name; new.number := old.number; new.age := old.age; new.height := old.height; new.weight := old.weight;
    new.birth_date := old.birth_date; new.anonimizado_em := old.anonimizado_em;
  end if;
  return new;
end $$;
