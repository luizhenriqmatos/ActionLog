-- ScoutHouse v2 · Fase 2.5 · colunas novas em match_events (EXPAND)
-- Todas anuláveis ou com default compatível: o app atual continua gravando sem conhecê-las.
-- NÃO aplicar em dia de jogo: a tabela recebe escrita ao vivo de vários celulares.
-- Nenhuma recusa nova é ligada aqui.

alter table public.match_events
  add column dispositivo_id text,
  add column sessao_registro_id uuid,
  add column ts_cliente timestamptz,
  add column ts_servidor timestamptz,
  add column origem text check (origem in ('ao_vivo', 'pos_jogo', 'correcao', 'importacao', 'legado')),
  add column status text check (status in ('confirmado', 'duplicata_suspeita', 'anulado')),
  add column grupo_duplicata_id uuid,
  add column evento_pai_id uuid references public.match_events(id),
  add column metadados jsonb not null default '{}'::jsonb;

-- histórico: origem 'legado'. O único horário disponível é created_at (enviado pelo aparelho, já corrigido
-- pelo desvio do servidor), então ele entra nos dois carimbos; 'legado' marca que não há carimbo real do servidor.
update public.match_events
set origem = 'legado', ts_cliente = created_at, ts_servidor = created_at,
    status = case when deleted_at is null then 'confirmado' else 'anulado' end
where origem is null;

-- daqui em diante o servidor carimba o próprio horário (o aparelho não escolhe ts_servidor)
create function private.match_event_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.ts_servidor := now();
    if new.origem is null then new.origem := 'ao_vivo'; end if;
    if new.status is null then new.status := 'confirmado'; end if;
  end if;
  -- desfazer (deleted_at) é a anulação de hoje: os dois campos andam juntos
  if new.deleted_at is not null then new.status := 'anulado'; end if;
  return new;
end $$;
revoke all on function private.match_event_stamp() from public, anon, authenticated;
create trigger match_events_stamp before insert or update on public.match_events
  for each row execute function private.match_event_stamp();

-- imutabilidade: os carimbos e a origem entram na lista do que não muda.
-- status, grupo_duplicata_id e metadados ficam de fora de propósito (revisão de duplicata e correção auditada).
create or replace function private.match_event_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.match_id, new.team_id, new.kind, new.athlete_id, new.period, new.clock_seconds, new.created_by, new.created_at,
      new.dispositivo_id, new.sessao_registro_id, new.ts_cliente, new.ts_servidor, new.origem, new.evento_pai_id)
     is distinct from
     (old.id, old.match_id, old.team_id, old.kind, old.athlete_id, old.period, old.clock_seconds, old.created_by, old.created_at,
      old.dispositivo_id, old.sessao_registro_id, old.ts_cliente, old.ts_servidor, old.origem, old.evento_pai_id) then
    raise exception 'evento não pode ser alterado; use desfazer';
  end if;
  return new;
end $$;

-- ordenação canônica: tempo de partida, carimbo do servidor, id. Relógio de aparelho não ordena.
create index match_events_ordem_idx on public.match_events (match_id, period, clock_seconds, ts_servidor, id);
