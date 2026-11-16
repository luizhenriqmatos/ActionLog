-- ScoutHouse v2 · Fase 2.4 · camada LGPD (EXPAND, tudo novo)
-- Estrutura para: responsável do atleta, texto legal versionado, consentimento POR FINALIDADE,
-- política de retenção e anonimização que preserva os agregados de equipe.
-- Nenhum texto legal é gravado aqui: a redação é do controlador (clube) e precisa de revisão jurídica.
-- O id do atleta nasce no aparelho e a chave é (team_id, id): por isso atleta_id é texto, sem FK.

create table public.responsavel (
  id uuid primary key default gen_random_uuid(),
  clube_id uuid not null references public.teams(id) on delete cascade,
  nome text not null,
  email text not null default '',
  telefone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index responsavel_clube_idx on public.responsavel (clube_id);

create table public.responsavel_atleta (
  id uuid primary key default gen_random_uuid(),
  clube_id uuid not null references public.teams(id) on delete cascade,
  responsavel_id uuid not null references public.responsavel(id) on delete cascade,
  atleta_id text not null,
  tipo_representacao text not null check (tipo_representacao in ('mae', 'pai', 'tutor_legal', 'outro')),
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  created_at timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create index responsavel_atleta_idx on public.responsavel_atleta (clube_id, atleta_id);

-- texto versionado: uma versão publicada nunca muda; publicar de novo cria outra linha
create table public.texto_legal (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  versao int not null check (versao > 0),
  conteudo text not null,
  vigente_de timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (chave, versao)
);
create function private.texto_legal_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'texto legal publicado não pode ser alterado nem apagado; publique uma nova versão';
end $$;
revoke all on function private.texto_legal_imutavel() from public, anon, authenticated;
create trigger texto_legal_imutavel before update or delete on public.texto_legal
  for each row execute function private.texto_legal_imutavel();

-- um consentimento por finalidade; revogar um não afeta os outros
create table public.consentimento (
  id uuid primary key default gen_random_uuid(),
  clube_id uuid not null references public.teams(id) on delete cascade,
  atleta_id text not null,
  finalidade text not null check (finalidade in ('desempenho_interno', 'relatorio_familia', 'imagem_interna', 'imagem_divulgacao', 'compartilhamento_externo', 'contato')),
  base_legal text not null,
  texto_legal_id uuid not null references public.texto_legal(id),
  -- quem outorgou: o responsável (atleta menor) ou o próprio atleta (maior de idade)
  outorgado_por text not null check (outorgado_por in ('responsavel', 'atleta')),
  responsavel_id uuid references public.responsavel(id),
  vigencia_inicio timestamptz not null default now(),
  -- consentimento dado pelo responsável EXPIRA na maioridade do atleta: quem registra informa a data aqui
  vigencia_fim timestamptz,
  revogado_em timestamptz,
  evidencia jsonb not null default '{}'::jsonb,
  registrado_por uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((outorgado_por = 'responsavel') = (responsavel_id is not null)),
  check (vigencia_fim is null or vigencia_fim > vigencia_inicio)
);
create index consentimento_atleta_idx on public.consentimento (clube_id, atleta_id, finalidade);

-- consentimento não se edita: só se revoga. O resto é registro histórico.
create function private.consentimento_so_revoga() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.clube_id, new.atleta_id, new.finalidade, new.base_legal, new.texto_legal_id, new.outorgado_por, new.responsavel_id, new.vigencia_inicio, new.vigencia_fim, new.evidencia, new.created_at)
     is distinct from (old.id, old.clube_id, old.atleta_id, old.finalidade, old.base_legal, old.texto_legal_id, old.outorgado_por, old.responsavel_id, old.vigencia_inicio, old.vigencia_fim, old.evidencia, old.created_at) then
    raise exception 'consentimento não pode ser alterado; revogue e registre um novo';
  end if;
  if old.revogado_em is not null and new.revogado_em is distinct from old.revogado_em then
    raise exception 'consentimento já revogado';
  end if;
  return new;
end $$;
revoke all on function private.consentimento_so_revoga() from public, anon, authenticated;
create trigger consentimento_so_revoga before update on public.consentimento
  for each row execute function private.consentimento_so_revoga();

create view public.consentimento_vigente with (security_invoker = true) as
select c.* from public.consentimento c
where c.revogado_em is null and c.vigencia_inicio <= now() and (c.vigencia_fim is null or c.vigencia_fim > now());

create table public.politica_retencao (
  clube_id uuid not null references public.teams(id) on delete cascade,
  camada text not null check (camada in ('atleta', 'avaliacao', 'imagem', 'relatorio')),
  prazo interval not null check (prazo > interval '0'),
  acao text not null check (acao in ('anonimizar', 'excluir', 'arquivar')),
  updated_at timestamptz not null default now(),
  primary key (clube_id, camada)
);
-- padrão: 2 anos após a saída do atleta, anonimizar preservando o agregado de equipe
insert into public.politica_retencao (clube_id, camada, prazo, acao)
select id, 'atleta', interval '2 years', 'anonimizar' from public.teams on conflict do nothing;

create function private.seed_politica_retencao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.politica_retencao (clube_id, camada, prazo, acao) values (new.id, 'atleta', interval '2 years', 'anonimizar') on conflict do nothing;
  return new;
end $$;
revoke all on function private.seed_politica_retencao() from public, anon, authenticated;
create trigger teams_seed_retencao after insert on public.teams
  for each row execute function private.seed_politica_retencao();

-- ---------- RLS ----------
alter table public.responsavel enable row level security;
alter table public.responsavel_atleta enable row level security;
alter table public.texto_legal enable row level security;
alter table public.consentimento enable row level security;
alter table public.politica_retencao enable row level security;

create policy responsavel_select on public.responsavel for select to authenticated using (private.is_team_member(clube_id));
create policy responsavel_insert on public.responsavel for insert to authenticated with check (private.can_write_team(clube_id));
create policy responsavel_update on public.responsavel for update to authenticated using (private.can_write_team(clube_id)) with check (private.can_write_team(clube_id));

create policy responsavel_atleta_select on public.responsavel_atleta for select to authenticated using (private.is_team_member(clube_id));
create policy responsavel_atleta_insert on public.responsavel_atleta for insert to authenticated with check (private.can_write_team(clube_id));
create policy responsavel_atleta_update on public.responsavel_atleta for update to authenticated using (private.can_write_team(clube_id)) with check (private.can_write_team(clube_id));

-- texto legal: qualquer usuário autenticado lê; publicação só por migration
create policy texto_legal_select on public.texto_legal for select to authenticated using (true);

create policy consentimento_select on public.consentimento for select to authenticated using (private.is_team_member(clube_id));
create policy consentimento_insert on public.consentimento for insert to authenticated with check (private.can_write_team(clube_id));
create policy consentimento_update on public.consentimento for update to authenticated using (private.can_write_team(clube_id)) with check (private.can_write_team(clube_id));

create policy politica_retencao_select on public.politica_retencao for select to authenticated using (private.is_team_member(clube_id));
create policy politica_retencao_update on public.politica_retencao for update to authenticated using (private.is_team_admin(clube_id)) with check (private.is_team_admin(clube_id));

-- ---------- anonimização ----------
alter table public.athletes add column anonimizado_em timestamptz;

create table public.anonimizacao_log (
  id uuid primary key default gen_random_uuid(),
  clube_id uuid not null references public.teams(id) on delete cascade,
  atleta_id text not null,
  motivo text not null default '',
  executado_por uuid references auth.users(id) on delete set null,
  executado_em timestamptz not null default now()
);
alter table public.anonimizacao_log enable row level security;
create policy anonimizacao_log_select on public.anonimizacao_log for select to authenticated using (private.is_team_admin(clube_id));

/**
 * Anonimiza um atleta: apaga o que identifica (nome, número, idade, altura, peso, textos livres de avaliação),
 * e mantém ids, eventos, minutos e contadores. Nenhum total de equipe nem placar muda.
 * Marca updated_at = agora para os aparelhos receberem a versão anonimizada na próxima sincronização.
 * Fora da API (schema private, sem grant): só roda por operação administrativa.
 */
create function private.anonimizar_atleta(clube uuid, atleta text, motivo text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare rotulo constant text := 'Atleta anonimizado';
begin
  if not exists (select 1 from public.athletes where team_id = clube and id = atleta) then
    raise exception 'atleta não encontrado neste clube';
  end if;
  update public.athletes set name = rotulo, number = '', age = '', height = '', weight = '', anonimizado_em = now(), updated_at = now()
    where team_id = clube and id = atleta;
  update public.scout_sessions set athlete_name = rotulo, updated_at = now() where team_id = clube and athlete_id = atleta;
  update public.match_players set athlete_name = rotulo, number = '', updated_at = now() where team_id = clube and athlete_id = atleta;
  update public.athlete_evaluations set athlete_name = rotulo, strengths = '', improvements = '', goals = '', coach_note = '', updated_at = now()
    where team_id = clube and athlete_id = atleta;
  update public.responsavel_atleta set vigencia_fim = current_date where clube_id = clube and atleta_id = atleta and (vigencia_fim is null or vigencia_fim > current_date);
  update public.consentimento set revogado_em = now() where clube_id = clube and atleta_id = atleta and revogado_em is null;
  insert into public.anonimizacao_log (clube_id, atleta_id, motivo, executado_por) values (clube, atleta, motivo, (select auth.uid()));
end $$;
revoke all on function private.anonimizar_atleta(uuid, text, text) from public, anon, authenticated;

-- aparelho antigo com a ficha em cache não pode devolver o dado pessoal: no atleta anonimizado o servidor vence
create function private.athlete_keep_anonymized() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.anonimizado_em is not null then
    new.name := old.name; new.number := old.number; new.age := old.age; new.height := old.height; new.weight := old.weight;
    new.anonimizado_em := old.anonimizado_em;
  end if;
  return new;
end $$;
revoke all on function private.athlete_keep_anonymized() from public, anon, authenticated;
create trigger athletes_keep_anonymized before update on public.athletes
  for each row execute function private.athlete_keep_anonymized();
