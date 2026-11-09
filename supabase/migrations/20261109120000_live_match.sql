-- v4.1 · Jogo ao vivo
-- Um jogo do calendário compartilhado por vários celulares do mesmo clube.
-- Sincronia ao vivo só de: jogo (cronômetro/placar/comando) e relação (quem está em campo).
-- Cada toque vira uma linha em match_events (só inserção; "desfazer" preenche deleted_at).

-- ---------- jogo ----------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  category text not null check (category in ('Sub-15', 'Sub-16', 'Sub-17', 'Sub-20')),
  calendar_event_id text not null,
  opponent text not null default '',
  competition text not null default '',
  match_date date not null,
  status text not null default 'preparing' check (status in ('preparing', 'live', 'finished')),
  -- pre = antes do 1ºT · first = 1ºT · break = intervalo · second = 2ºT · done = encerrado
  phase text not null default 'pre' check (phase in ('pre', 'first', 'break', 'second', 'done')),
  period smallint not null default 1 check (period in (1, 2)),
  clock_running boolean not null default false,
  clock_started_at timestamptz,
  clock_base_seconds int not null default 0 check (clock_base_seconds >= 0),
  opponent_goals int not null default 0 check (opponent_goals >= 0),
  commander_user_id uuid references auth.users(id) on delete set null,
  commander_name text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  sessions_generated_at timestamptz,
  unique (team_id, calendar_event_id)
);
create index matches_team_idx on public.matches(team_id, category, match_date);

-- ---------- relação ----------
create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  athlete_id text not null,
  athlete_name text not null default '',
  number text not null default '',
  positions text not null default '',
  dominant_foot text not null default 'Direita' check (dominant_foot in ('Direita', 'Esquerda', 'Ambidestro')),
  sector text not null check (sector in ('DEF', 'MEI', 'ATA')),
  starter boolean not null default false,
  on_field boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (match_id, athlete_id)
);
create index match_players_team_idx on public.match_players(team_id);

-- ---------- eventos ----------
create table public.match_events (
  id uuid primary key, -- gerado no aparelho: reenviar não duplica
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  kind text not null check (kind in (
    'goal', 'assist', 'shot', 'shot_on_target', 'pass_ok', 'pass_bad', 'tackle', 'interception',
    'possession_loss', 'foul_committed', 'foul_suffered',
    'corner_for', 'corner_against', 'opponent_goal', 'sub_out', 'sub_in', 'period_start', 'period_end')),
  athlete_id text,
  period smallint not null check (period in (1, 2)),
  clock_seconds int not null default 0 check (clock_seconds >= 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index match_events_match_idx on public.match_events(match_id, created_at);
create index match_events_team_idx on public.match_events(team_id);

-- ---------- RLS ----------
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_events enable row level security;

create policy matches_select on public.matches for select to authenticated using (private.is_team_member(team_id));
create policy matches_insert on public.matches for insert to authenticated with check (private.can_write_team(team_id));
create policy matches_update on public.matches for update to authenticated using (private.can_write_team(team_id)) with check (private.can_write_team(team_id));
create policy matches_delete on public.matches for delete to authenticated using (private.is_team_admin(team_id));

create policy match_players_select on public.match_players for select to authenticated using (private.is_team_member(team_id));
create policy match_players_insert on public.match_players for insert to authenticated with check (private.can_write_team(team_id));
create policy match_players_update on public.match_players for update to authenticated using (private.can_write_team(team_id)) with check (private.can_write_team(team_id));
create policy match_players_delete on public.match_players for delete to authenticated using (private.can_write_team(team_id));

create policy match_events_select on public.match_events for select to authenticated using (private.is_team_member(team_id));
create policy match_events_insert on public.match_events for insert to authenticated
  with check (private.can_write_team(team_id) and created_by = (select auth.uid()));
-- só quem registrou pode desfazer (preencher deleted_at)
create policy match_events_update on public.match_events for update to authenticated
  using (created_by = (select auth.uid()) and private.can_write_team(team_id))
  with check (created_by = (select auth.uid()) and private.can_write_team(team_id));

-- o team_id do jogador/evento precisa ser o mesmo do jogo
create function private.match_team_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.matches m where m.id = new.match_id and m.team_id = new.team_id) then
    raise exception 'jogo não pertence a este time';
  end if;
  return new;
end $$;
revoke all on function private.match_team_guard() from public, anon, authenticated;
create trigger match_players_team_guard before insert or update on public.match_players
  for each row execute function private.match_team_guard();
create trigger match_events_team_guard before insert on public.match_events
  for each row execute function private.match_team_guard();

-- eventos: só deleted_at pode mudar
create function private.match_event_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.match_id, new.team_id, new.kind, new.athlete_id, new.period, new.clock_seconds, new.created_by, new.created_at)
     is distinct from (old.id, old.match_id, old.team_id, old.kind, old.athlete_id, old.period, old.clock_seconds, old.created_by, old.created_at) then
    raise exception 'evento não pode ser alterado; use desfazer';
  end if;
  return new;
end $$;
revoke all on function private.match_event_immutable() from public, anon, authenticated;
create trigger match_events_immutable before update on public.match_events
  for each row execute function private.match_event_immutable();

-- hora do servidor, para alinhar o cronômetro entre os celulares
create function public.server_now() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;
revoke execute on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;

-- ---------- scout_sessions ----------
alter table public.scout_sessions
  add column interceptions int not null default 0 check (interceptions >= 0),
  add column minutes_played int check (minutes_played >= 0),
  add column match_id uuid references public.matches(id) on delete set null;
create index scout_sessions_match_idx on public.scout_sessions(match_id);

create or replace view public.v_scout_session_rates with (security_invoker = true) as
select
  s.team_id, s.id, s.category, s.mode, s.athlete_id, s.athlete_name, s.dominant_foot_snapshot, s.calendar_date, s.event_id,
  round(100.0 * s.shots_on_target / nullif(s.shots, 0), 1) as game_shot_accuracy_pct,
  round(100.0 * s.goals / nullif(s.shots, 0), 1) as game_conversion_pct,
  round(100.0 * s.accurate_passes / nullif(s.passes_total, 0), 1) as pass_accuracy_pct,
  round(100.0 * (s.dominant_on_target + s.non_dominant_on_target) / nullif(s.dominant_finishes + s.non_dominant_finishes, 0), 1) as finishing_accuracy_pct,
  round(100.0 * (s.dominant_goals + s.non_dominant_goals) / nullif(s.dominant_finishes + s.non_dominant_finishes, 0), 1) as finishing_conversion_pct,
  case when s.dominant_foot_snapshot <> 'Ambidestro' then round(100.0 * s.dominant_goals / nullif(s.dominant_finishes, 0), 1) end as dominant_efficiency_pct,
  case when s.dominant_foot_snapshot <> 'Ambidestro' then round(100.0 * s.non_dominant_goals / nullif(s.non_dominant_finishes, 0), 1) end as non_dominant_efficiency_pct,
  s.interceptions, s.minutes_played, s.match_id
from public.scout_sessions s
where s.deleted_at is null;

create or replace view public.v_athlete_totals with (security_invoker = true) as
select
  s.team_id, s.category, s.athlete_id, max(s.athlete_name) as athlete_name,
  count(*) filter (where s.mode = 'game') as games,
  count(*) filter (where s.mode = 'finishing') as finishing_sessions,
  sum(s.goals) as goals, sum(s.assists) as assists, sum(s.shots) as shots, sum(s.shots_on_target) as shots_on_target,
  sum(s.accurate_passes) as accurate_passes, sum(s.wrong_passes) as wrong_passes, sum(s.tackles) as tackles,
  sum(s.possession_loss) as possession_loss, sum(s.fouls_committed) as fouls_committed, sum(s.fouls_suffered) as fouls_suffered,
  round(100.0 * sum(s.shots_on_target) / nullif(sum(s.shots), 0), 1) as game_shot_accuracy_pct,
  round(100.0 * sum(s.goals) / nullif(sum(s.shots), 0), 1) as game_conversion_pct,
  round(100.0 * sum(s.accurate_passes) / nullif(sum(s.passes_total), 0), 1) as pass_accuracy_pct,
  round(100.0 * sum(s.dominant_goals) filter (where s.dominant_foot_snapshot <> 'Ambidestro')
        / nullif(sum(s.dominant_finishes) filter (where s.dominant_foot_snapshot <> 'Ambidestro'), 0), 1) as dominant_efficiency_pct,
  round(100.0 * sum(s.non_dominant_goals) filter (where s.dominant_foot_snapshot <> 'Ambidestro')
        / nullif(sum(s.non_dominant_finishes) filter (where s.dominant_foot_snapshot <> 'Ambidestro'), 0), 1) as non_dominant_efficiency_pct,
  sum(s.interceptions) as interceptions,
  sum(s.minutes_played) as minutes_played
from public.scout_sessions s
where s.deleted_at is null
group by s.team_id, s.category, s.athlete_id;
