-- ActionLog v2.3 · sincronização com Supabase
-- Times (comissão técnica), elenco, calendário MD e sessões de scout por categoria.
-- Contagens brutas no banco; taxas só em views (nunca gravadas).

-- ---------- times e membros ----------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'treinador' check (role in ('admin', 'treinador', 'analista', 'leitura')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members(user_id);

-- Quem cria o time vira admin automaticamente.
create function public.add_team_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.team_members(team_id, user_id, role) values (new.id, new.created_by, 'admin');
  return new;
end $$;
create trigger teams_add_creator after insert on public.teams
  for each row execute function public.add_team_creator();

create function public.is_team_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members where team_id = t and user_id = (select auth.uid()));
$$;

create function public.can_write_team(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members where team_id = t and user_id = (select auth.uid()) and role in ('admin', 'treinador', 'analista'));
$$;

create function public.is_team_admin(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members where team_id = t and user_id = (select auth.uid()) and role = 'admin');
$$;

-- ---------- dados por categoria ----------
-- ids são gerados no aparelho (local-first); a chave é (team_id, id).
create table public.athletes (
  team_id uuid not null references public.teams(id) on delete cascade,
  id text not null,
  category text not null check (category in ('Sub-15', 'Sub-16', 'Sub-17', 'Sub-20')),
  name text not null,
  number text not null default '',
  positions text not null default '',
  age text not null default '',
  height text not null default '',
  weight text not null default '',
  dominant_foot text not null default 'Direita' check (dominant_foot in ('Direita', 'Esquerda', 'Ambidestro')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (team_id, id)
);

create table public.calendar_events (
  team_id uuid not null references public.teams(id) on delete cascade,
  id text not null,
  category text not null check (category in ('Sub-15', 'Sub-16', 'Sub-17', 'Sub-20')),
  type text not null check (type in ('Jogo', 'Treino')),
  title text not null,
  date date not null,
  opponent text not null default '',
  location text not null default '',
  md_tag text not null default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (team_id, id)
);
create index calendar_events_date_idx on public.calendar_events(team_id, category, date);

create table public.scout_sessions (
  team_id uuid not null references public.teams(id) on delete cascade,
  id text not null,
  category text not null check (category in ('Sub-15', 'Sub-16', 'Sub-17', 'Sub-20')),
  mode text not null check (mode in ('game', 'finishing')),
  athlete_id text not null,
  athlete_name text not null default '',
  dominant_foot_snapshot text not null check (dominant_foot_snapshot in ('Direita', 'Esquerda', 'Ambidestro')),
  calendar_date date not null,
  periodization_tag text not null default '',
  event_id text not null default '',
  event_title text not null default '',
  event_type text not null default '' check (event_type in ('', 'Jogo', 'Treino')),
  -- partida
  goals int not null default 0 check (goals >= 0),
  assists int not null default 0 check (assists >= 0),
  shots int not null default 0 check (shots >= 0),
  shots_on_target int not null default 0 check (shots_on_target >= 0),
  accurate_passes int not null default 0 check (accurate_passes >= 0),
  wrong_passes int not null default 0 check (wrong_passes >= 0),
  passes_total int generated always as (accurate_passes + wrong_passes) stored,
  tackles int not null default 0 check (tackles >= 0),
  possession_loss int not null default 0 check (possession_loss >= 0),
  fouls_committed int not null default 0 check (fouls_committed >= 0),
  fouls_suffered int not null default 0 check (fouls_suffered >= 0),
  -- treino de finalização (ambidestro: dominant = direita, non_dominant = esquerda)
  dominant_finishes int not null default 0 check (dominant_finishes >= 0),
  dominant_on_target int not null default 0 check (dominant_on_target >= 0),
  dominant_goals int not null default 0 check (dominant_goals >= 0),
  non_dominant_finishes int not null default 0 check (non_dominant_finishes >= 0),
  non_dominant_on_target int not null default 0 check (non_dominant_on_target >= 0),
  non_dominant_goals int not null default 0 check (non_dominant_goals >= 0),
  legacy_passes int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (team_id, id),
  constraint game_on_target_le_shots check (shots_on_target <= shots),
  constraint game_goals_le_on_target check (goals <= shots_on_target),
  constraint dom_on_target_le_finishes check (dominant_on_target <= dominant_finishes),
  constraint dom_goals_le_on_target check (dominant_goals <= dominant_on_target),
  constraint nondom_on_target_le_finishes check (non_dominant_on_target <= non_dominant_finishes),
  constraint nondom_goals_le_on_target check (non_dominant_goals <= non_dominant_on_target)
);
create index scout_sessions_date_idx on public.scout_sessions(team_id, category, calendar_date);
create index scout_sessions_athlete_idx on public.scout_sessions(team_id, athlete_id);

-- ---------- RLS ----------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.athletes enable row level security;
alter table public.calendar_events enable row level security;
alter table public.scout_sessions enable row level security;

create policy teams_select on public.teams for select to authenticated using (public.is_team_member(id) or created_by = (select auth.uid()));
create policy teams_insert on public.teams for insert to authenticated with check (created_by = (select auth.uid()));
create policy teams_update on public.teams for update to authenticated using (public.is_team_admin(id)) with check (public.is_team_admin(id));
create policy teams_delete on public.teams for delete to authenticated using (public.is_team_admin(id));

create policy members_select on public.team_members for select to authenticated using (public.is_team_member(team_id));
create policy members_insert on public.team_members for insert to authenticated with check (public.is_team_admin(team_id));
create policy members_update on public.team_members for update to authenticated using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
create policy members_delete on public.team_members for delete to authenticated using (public.is_team_admin(team_id) or user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['athletes', 'calendar_events', 'scout_sessions'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_team_member(team_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_write_team(team_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.can_write_team(team_id)) with check (public.can_write_team(team_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.can_write_team(team_id))', t);
  end loop;
end $$;

revoke execute on function public.is_team_member(uuid), public.can_write_team(uuid), public.is_team_admin(uuid) from anon;
revoke execute on function public.add_team_creator() from anon, authenticated;

-- ---------- indicadores (calculados, respeitam RLS) ----------
create view public.v_scout_session_rates with (security_invoker = true) as
select
  s.team_id, s.id, s.category, s.mode, s.athlete_id, s.athlete_name, s.dominant_foot_snapshot, s.calendar_date, s.event_id,
  round(100.0 * s.shots_on_target / nullif(s.shots, 0), 1) as game_shot_accuracy_pct,
  round(100.0 * s.goals / nullif(s.shots, 0), 1) as game_conversion_pct,
  round(100.0 * s.accurate_passes / nullif(s.passes_total, 0), 1) as pass_accuracy_pct,
  round(100.0 * (s.dominant_on_target + s.non_dominant_on_target) / nullif(s.dominant_finishes + s.non_dominant_finishes, 0), 1) as finishing_accuracy_pct,
  round(100.0 * (s.dominant_goals + s.non_dominant_goals) / nullif(s.dominant_finishes + s.non_dominant_finishes, 0), 1) as finishing_conversion_pct,
  case when s.dominant_foot_snapshot <> 'Ambidestro' then round(100.0 * s.dominant_goals / nullif(s.dominant_finishes, 0), 1) end as dominant_efficiency_pct,
  case when s.dominant_foot_snapshot <> 'Ambidestro' then round(100.0 * s.non_dominant_goals / nullif(s.non_dominant_finishes, 0), 1) end as non_dominant_efficiency_pct
from public.scout_sessions s
where s.deleted_at is null;

-- Agregado por atleta: soma as contagens antes de dividir.
create view public.v_athlete_totals with (security_invoker = true) as
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
        / nullif(sum(s.non_dominant_finishes) filter (where s.dominant_foot_snapshot <> 'Ambidestro'), 0), 1) as non_dominant_efficiency_pct
from public.scout_sessions s
where s.deleted_at is null
group by s.team_id, s.category, s.athlete_id;
