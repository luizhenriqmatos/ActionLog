-- ScoutHouse v2 · Fase 2.6 · contrato (EXPAND, tabela vazia)
-- `teams` é o clube. Os limites de plano hoje são constantes em trigger (10 clubes por admin, 100 atletas por categoria);
-- este é o lugar onde passarão a morar. As triggers não mudam nesta fase.
-- Fim de vigência muda o modo de acesso para leitura e exportação. Nunca apaga dado.

create table public.contrato (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  vigencia_inicio date not null,
  vigencia_fim date,
  plano text not null,
  limites jsonb not null default '{}'::jsonb,
  status text not null default 'ativo' check (status in ('ativo', 'suspenso', 'encerrado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create index contrato_team_idx on public.contrato (team_id);
alter table public.contrato enable row level security;
create policy contrato_select on public.contrato for select to authenticated using (private.is_team_admin(team_id));
-- sem policy de escrita: contrato é lançado por operação administrativa
