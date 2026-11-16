-- ScoutHouse v2 · Fase 2.2 · catálogo de tipos de evento (EXPAND)
-- O CHECK de 18 valores em match_events.kind continua valendo; o app ainda não lê este catálogo.
-- clube_id nulo = catálogo global.

create table public.tipo_evento (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  clube_id uuid references public.teams(id) on delete cascade,
  nome text not null,
  nome_curto text not null,
  escopo text not null check (escopo in ('individual', 'coletivo', 'ambos')),
  exige_atleta boolean not null default false,
  familia_metrica text not null default '',
  afeta_placar boolean not null default false,
  afeta_disciplina boolean not null default false,
  encerra_participacao boolean not null default false,
  janela_dedupe_s smallint check (janela_dedupe_s > 0),
  derivavel_automaticamente boolean not null default false,
  ativo boolean not null default true,
  ordem smallint not null default 0,
  cor_token text not null default '',
  vigente_de timestamptz not null default now(),
  vigente_ate timestamptz,
  check (vigente_ate is null or vigente_ate > vigente_de)
);
create unique index tipo_evento_global_idx on public.tipo_evento (codigo) where clube_id is null;
create unique index tipo_evento_clube_idx on public.tipo_evento (clube_id, codigo) where clube_id is not null;
comment on table public.tipo_evento is 'Catálogo de tipos de evento de partida. Desativar (ativo = false) não apaga: eventos antigos continuam com nome e cor.';

alter table public.tipo_evento enable row level security;
create policy tipo_evento_select on public.tipo_evento for select to authenticated using (clube_id is null or private.is_team_member(clube_id));
create policy tipo_evento_insert on public.tipo_evento for insert to authenticated with check (clube_id is not null and private.is_team_admin(clube_id));
create policy tipo_evento_update on public.tipo_evento for update to authenticated using (clube_id is not null and private.is_team_admin(clube_id)) with check (clube_id is not null and private.is_team_admin(clube_id));
-- sem policy de DELETE; o catálogo global só muda por migration

-- os 18 tipos atuais, com os rótulos e tons que o app usa hoje (src/lib/match.ts)
insert into public.tipo_evento (codigo, nome, nome_curto, escopo, exige_atleta, familia_metrica, afeta_placar, janela_dedupe_s, ordem, cor_token) values
  ('pass_ok',         'Passe certo',        'Passe ✓',    'individual', true,  'passe',        false, 3,    1,  'green'),
  ('pass_bad',        'Passe errado',       'Passe ✗',    'individual', true,  'passe',        false, 3,    2,  'red'),
  ('tackle',          'Desarme',            'Desarme',    'individual', true,  'defesa',       false, 4,    3,  'purple'),
  ('interception',    'Interceptação',      'Intercep.',  'individual', true,  'defesa',       false, 4,    4,  'purple'),
  ('possession_loss', 'Perda de posse',     'Perda',      'individual', true,  'posse',        false, null, 5,  'orange'),
  ('shot',            'Finalização',        'Final.',     'individual', true,  'finalizacao',  false, 6,    6,  'blue'),
  ('shot_on_target',  'Finalização no gol', 'No gol',     'individual', true,  'finalizacao',  false, 6,    7,  'blue'),
  ('goal',            'Gol',                'Gol',        'individual', true,  'finalizacao',  true,  15,   8,  'yellow'),
  ('assist',          'Assistência',        'Assist.',    'individual', true,  'criacao',      false, null, 9,  'yellow'),
  ('foul_committed',  'Falta cometida',     'Falta com.', 'individual', true,  'falta',        false, null, 10, 'red'),
  ('foul_suffered',   'Falta sofrida',      'Falta sof.', 'individual', true,  'falta',        false, null, 11, 'green'),
  ('corner_for',      'Escanteio a favor',  'Esc. favor', 'coletivo',   false, 'bola_parada',  false, null, 12, ''),
  ('corner_against',  'Escanteio contra',   'Esc. contra','coletivo',   false, 'bola_parada',  false, null, 13, ''),
  ('opponent_goal',   'Gol do adversário',  'Gol adv.',   'coletivo',   false, 'placar',       true,  15,   14, ''),
  ('sub_out',         'Saiu',               'Saiu',       'individual', true,  'substituicao', false, null, 15, ''),
  ('sub_in',          'Entrou',             'Entrou',     'individual', true,  'substituicao', false, null, 16, ''),
  ('period_start',    'Início de período',  'Início',     'coletivo',   false, 'periodo',      false, null, 17, ''),
  ('period_end',      'Fim de período',     'Fim',        'coletivo',   false, 'periodo',      false, null, 18, '');
