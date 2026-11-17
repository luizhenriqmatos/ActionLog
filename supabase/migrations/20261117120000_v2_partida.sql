-- ScoutHouse v2 · Fase 3.1 · sessao, partida, partida_participante (EXPAND, atrás de flag)
-- Só adição. O modelo antigo (matches) continua sendo a fonte de verdade e nada do app lê estas tabelas ainda.
-- A partida ganha DOIS participantes simétricos (mandante/visitante); placar não é gravado, é derivado.
-- O espelho matches → partida é idempotente: o backfill roda uma vez para tudo, e depois o trigger só
-- espelha os clubes com o recurso 'partida_v2' ligado (dupla escrita da Fase 3.5).

-- ---------- recursos ligáveis por clube (feature flag) ----------
create table public.clube_recurso (
  clube_id uuid not null references public.teams(id) on delete cascade,
  recurso text not null,
  ligado boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (clube_id, recurso)
);
alter table public.clube_recurso enable row level security;
create policy clube_recurso_select on public.clube_recurso for select to authenticated using (private.is_team_member(clube_id));
create policy clube_recurso_insert on public.clube_recurso for insert to authenticated with check (private.is_team_admin(clube_id));
create policy clube_recurso_update on public.clube_recurso for update to authenticated using (private.is_team_admin(clube_id)) with check (private.is_team_admin(clube_id));

-- ---------- equipe externa (criada vazia: os agrupamentos de adversário esperam aprovação) ----------
create table public.equipe_externa (
  id uuid primary key default gen_random_uuid(),
  clube_id uuid not null references public.teams(id) on delete cascade,
  nome text not null,
  nome_normalizado text not null,
  criado_em timestamptz not null default now(),
  unique (clube_id, nome_normalizado)
);
alter table public.equipe_externa enable row level security;
create policy equipe_externa_select on public.equipe_externa for select to authenticated using (private.is_team_member(clube_id));
create policy equipe_externa_insert on public.equipe_externa for insert to authenticated with check (private.is_team_admin(clube_id));
create policy equipe_externa_update on public.equipe_externa for update to authenticated using (private.is_team_admin(clube_id)) with check (private.is_team_admin(clube_id));

-- ---------- sessao (superclasse fina) ----------
create table public.sessao (
  id uuid primary key default gen_random_uuid(),
  clube_id uuid not null references public.teams(id) on delete cascade,
  tipo text not null check (tipo in ('partida', 'treino')),
  inicio_previsto timestamptz not null,
  local text not null default '',
  criado_em timestamptz not null default now()
);
create index sessao_clube_idx on public.sessao (clube_id, inicio_previsto);
alter table public.sessao enable row level security;
create policy sessao_select on public.sessao for select to authenticated using (private.is_team_member(clube_id));

-- ---------- partida ----------
-- Sem categoria_id, sem adversário, sem placar. hora_presumida: a v1 só tinha DATA; a hora é convencional (12:00 de Bahia).
create table public.partida (
  sessao_id uuid primary key references public.sessao(id) on delete cascade,
  clube_id uuid not null references public.teams(id) on delete cascade,
  tipo_partida_codigo text references public.tipo_partida(codigo),
  competicao_id uuid,
  inicio_previsto timestamptz not null,
  hora_presumida boolean not null default true,
  status text not null default 'preparando' check (status in ('preparando', 'ao_vivo', 'encerrada')),
  n_periodos smallint not null default 2 check (n_periodos between 1 and 6),
  duracao_prevista_periodo_min smallint,
  rotulo text not null default '',
  lados_registrados text not null default 'um' check (lados_registrados in ('um', 'dois')),
  politica_contagem_efetiva jsonb,
  fechada_em timestamptz,
  versao int not null default 1,
  id_legado uuid unique references public.matches(id) on delete set null
);
create index partida_clube_idx on public.partida (clube_id, inicio_previsto);
alter table public.partida enable row level security;
create policy partida_select on public.partida for select to authenticated using (private.is_team_member(clube_id));

-- ---------- participantes ----------
-- inicio_previsto e hora_presumida são cópias da partida, mantidas por trigger, só para a trava de identidade.
create table public.partida_participante (
  id uuid primary key default gen_random_uuid(),
  partida_id uuid not null references public.partida(sessao_id) on delete cascade,
  lado text not null check (lado in ('mandante', 'visitante')),
  tipo text not null check (tipo in ('categoria_interna', 'equipe_externa')),
  categoria_id uuid references public.categoria(id),
  equipe_externa_id uuid references public.equipe_externa(id),
  nome_exibicao text not null,
  inicio_previsto timestamptz not null,
  hora_presumida boolean not null default true,
  unique (partida_id, lado),
  -- equipe_externa_id pode ficar nulo enquanto os agrupamentos de adversário não forem aprovados
  check ((tipo = 'categoria_interna' and categoria_id is not null and equipe_externa_id is null)
      or (tipo = 'equipe_externa' and categoria_id is null))
);
create index partida_participante_categoria_idx on public.partida_participante (categoria_id);
-- Identidade da partida: a mesma categoria não joga duas vezes no mesmo instante. Só vale para hora REAL;
-- partidas com hora presumida (v1 só tinha a data) são sinalizadas para revisão, não bloqueadas.
-- PROIBIDO trocar isto por UNIQUE(categoria, data): foi o que causou a perda de dado da Fase 1.
create unique index partida_participante_identidade
  on public.partida_participante (categoria_id, inicio_previsto)
  where tipo = 'categoria_interna' and not hora_presumida;
alter table public.partida_participante enable row level security;
create policy partida_participante_select on public.partida_participante for select to authenticated
  using (exists (select 1 from public.partida p where p.sessao_id = partida_id and private.is_team_member(p.clube_id)));

-- sem policy de insert/update/delete: só o servidor escreve (espelho de matches). O app ainda não grava aqui.

-- ---------- invariantes (checados no COMMIT, depois que os dois participantes entraram) ----------
create function private.valida_participantes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_partida uuid := coalesce(new.partida_id, old.partida_id); n int; m int; v int; cats int; distintas int;
begin
  if not exists (select 1 from public.partida where sessao_id = v_partida) then return null; end if; -- partida apagada em cascata
  select count(*), count(*) filter (where lado = 'mandante'), count(*) filter (where lado = 'visitante'),
         count(categoria_id), count(distinct categoria_id)
    into n, m, v, cats, distintas from public.partida_participante where partida_id = v_partida;
  if n <> 2 then raise exception 'partida % precisa de exatamente 2 participantes (tem %)', v_partida, n using errcode = 'check_violation'; end if;
  if m <> 1 or v <> 1 then raise exception 'partida % precisa de 1 mandante e 1 visitante', v_partida using errcode = 'check_violation'; end if;
  if cats = 2 and distintas = 1 then raise exception 'partida % tem a mesma categoria nos dois lados', v_partida using errcode = 'check_violation'; end if;
  return null;
end $$;
revoke all on function private.valida_participantes() from public, anon, authenticated;
create constraint trigger partida_participantes_validos after insert or update or delete on public.partida_participante
  deferrable initially deferred for each row execute function private.valida_participantes();

-- a partida sem nenhum participante também é inválida: checa quando a própria partida é criada
create function private.valida_partida_tem_lados() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.partida_participante where partida_id = new.sessao_id) <> 2 then
    raise exception 'partida % precisa de exatamente 2 participantes', new.sessao_id using errcode = 'check_violation';
  end if;
  return null;
end $$;
revoke all on function private.valida_partida_tem_lados() from public, anon, authenticated;
create constraint trigger partida_tem_lados after insert on public.partida
  deferrable initially deferred for each row execute function private.valida_partida_tem_lados();

-- cópia de inicio/hora_presumida da partida para os participantes
create function private.sync_participante_inicio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.partida_participante set inicio_previsto = new.inicio_previsto, hora_presumida = new.hora_presumida
   where partida_id = new.sessao_id and (inicio_previsto, hora_presumida) is distinct from (new.inicio_previsto, new.hora_presumida);
  return null;
end $$;
revoke all on function private.sync_participante_inicio() from public, anon, authenticated;
create trigger partida_sync_participante_inicio after update of inicio_previsto, hora_presumida on public.partida
  for each row execute function private.sync_participante_inicio();

-- ---------- placar derivado (nunca gravado): gols por participante a partir dos eventos ----------
-- Nesta fase só existe o lado interno (mandante); o visitante conta os eventos opponent_goal.
create function public.partida_placar(p_partida uuid)
returns table (mandante int, visitante int)
language sql stable security invoker set search_path = '' as $$
  select
    (select count(*)::int from public.match_events e join public.partida p on p.id_legado = e.match_id
      where p.sessao_id = p_partida and e.kind = 'goal' and e.deleted_at is null),
    (select count(*)::int from public.match_events e join public.partida p on p.id_legado = e.match_id
      where p.sessao_id = p_partida and e.kind = 'opponent_goal' and e.deleted_at is null);
$$;

-- ---------- espelho matches → partida (idempotente) ----------
create function private.espelhar_partida(m public.matches) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sessao uuid; v_inicio timestamptz := ((m.match_date + time '12:00') at time zone 'America/Bahia');
        v_status text := case m.status when 'live' then 'ao_vivo' when 'finished' then 'encerrada' else 'preparando' end;
        v_nome text;
begin
  select sessao_id into v_sessao from public.partida where id_legado = m.id;
  if v_sessao is null then
    insert into public.sessao (clube_id, tipo, inicio_previsto) values (m.team_id, 'partida', v_inicio) returning id into v_sessao;
    insert into public.partida (sessao_id, clube_id, tipo_partida_codigo, inicio_previsto, hora_presumida, status, rotulo,
                                politica_contagem_efetiva, fechada_em, id_legado)
      values (v_sessao, m.team_id, m.tipo_partida_codigo, v_inicio, true, v_status, m.competition, m.politica_contagem_efetiva, m.finished_at, m.id);
    -- mandante = a categoria interna; visitante = o adversário, com o texto original preservado.
    -- equipe_externa_id fica nulo até os agrupamentos serem aprovados. (A v1 não sabia quem era mandante: convenção.)
    insert into public.partida_participante (partida_id, lado, tipo, categoria_id, nome_exibicao, inicio_previsto, hora_presumida)
      values (v_sessao, 'mandante', 'categoria_interna', m.categoria_id, m.category, v_inicio, true);
    insert into public.partida_participante (partida_id, lado, tipo, nome_exibicao, inicio_previsto, hora_presumida)
      values (v_sessao, 'visitante', 'equipe_externa', m.opponent, v_inicio, true);
  else
    -- a hora só é recalculada enquanto for presumida; hora real (futuro) não é sobrescrita
    update public.partida set status = v_status, rotulo = m.competition, fechada_em = m.finished_at,
           politica_contagem_efetiva = m.politica_contagem_efetiva,
           inicio_previsto = case when hora_presumida then v_inicio else inicio_previsto end
     where sessao_id = v_sessao;
    update public.sessao set inicio_previsto = (select inicio_previsto from public.partida where sessao_id = v_sessao) where id = v_sessao;
    update public.partida_participante set nome_exibicao = m.opponent where partida_id = v_sessao and lado = 'visitante';
  end if;
end $$;
revoke all on function private.espelhar_partida(public.matches) from public, anon, authenticated;

-- backfill: todas as partidas existentes (nada lê estas tabelas ainda; é só dado novo ao lado)
do $$ declare m public.matches; begin
  for m in select * from public.matches loop perform private.espelhar_partida(m); end loop;
end $$;

-- dupla escrita: só para clubes com o recurso ligado
create function private.matches_espelho() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.clube_recurso where clube_id = new.team_id and recurso = 'partida_v2' and ligado) then
    perform private.espelhar_partida(new);
  end if;
  return null;
end $$;
revoke all on function private.matches_espelho() from public, anon, authenticated;
create trigger matches_espelho after insert or update on public.matches
  for each row execute function private.matches_espelho();
