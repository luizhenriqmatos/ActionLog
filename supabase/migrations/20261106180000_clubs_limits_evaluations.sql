-- ActionLog v3.0 · perfil com clubes, limites e avaliações periódicas

-- ---------- limite de clubes administrados por usuário (regra interna, não exibida) ----------
create function private.enforce_admin_club_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'admin' and (tg_op = 'INSERT' or old.role <> 'admin') then
    if (select count(*) from public.team_members where user_id = new.user_id and role = 'admin') >= 10 then
      raise exception 'Não foi possível concluir. Fale com o suporte do ActionLog.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_admin_club_limit() from public, anon, authenticated;
create trigger team_members_admin_limit before insert or update on public.team_members
  for each row execute function private.enforce_admin_club_limit();

-- Só responde se pode criar mais um clube (sem revelar o número).
create function public.can_create_club() returns boolean
language sql stable security invoker set search_path = '' as $$
  select (select count(*) from public.team_members where user_id = (select auth.uid()) and role = 'admin') < 10;
$$;
revoke all on function public.can_create_club() from public, anon;
grant execute on function public.can_create_club() to authenticated;

-- ---------- limite de 100 atletas por categoria em cada clube ----------
create function private.enforce_athlete_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null or old.category <> new.category) then
    if (select count(*) from public.athletes where team_id = new.team_id and category = new.category and deleted_at is null and id <> new.id) >= 100 then
      raise exception 'Esta categoria atingiu o limite de atletas.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_athlete_limit() from public, anon, authenticated;
create trigger athletes_limit before insert or update on public.athletes
  for each row execute function private.enforce_athlete_limit();

-- ---------- avaliações periódicas (notas de 1 a 5 por critério) ----------
create table public.athlete_evaluations (
  team_id uuid not null references public.teams(id) on delete cascade,
  id text not null,
  category text not null check (category in ('Sub-15', 'Sub-16', 'Sub-17', 'Sub-20')),
  athlete_id text not null,
  athlete_name text not null default '',
  date date not null,
  period text not null default '',
  scores jsonb not null default '{}'::jsonb,
  strengths text not null default '',
  improvements text not null default '',
  goals text not null default '',
  coach_note text not null default '',
  evaluator text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (team_id, id),
  constraint scores_is_object check (jsonb_typeof(scores) = 'object'),
  constraint scores_between_1_and_5 check (not jsonb_path_exists(scores, '$.* ? (@.type() != "number" || @ < 1 || @ > 5)'))
);
create index athlete_evaluations_athlete_idx on public.athlete_evaluations(team_id, athlete_id, date);
alter table public.athlete_evaluations enable row level security;
create policy athlete_evaluations_select on public.athlete_evaluations for select to authenticated using (private.is_team_member(team_id));
create policy athlete_evaluations_insert on public.athlete_evaluations for insert to authenticated with check (private.can_write_team(team_id));
create policy athlete_evaluations_update on public.athlete_evaluations for update to authenticated using (private.can_write_team(team_id)) with check (private.can_write_team(team_id));
create policy athlete_evaluations_delete on public.athlete_evaluations for delete to authenticated using (private.can_write_team(team_id));

-- ---------- clubes do usuário com contagens (tela de perfil) ----------
create function public.my_clubs() returns table (team_id uuid, name text, role text, athletes bigint, sessions bigint, evaluations bigint, joined_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select m.team_id, t.name, m.role,
    (select count(*) from public.athletes a where a.team_id = m.team_id and a.deleted_at is null),
    (select count(*) from public.scout_sessions s where s.team_id = m.team_id and s.deleted_at is null),
    (select count(*) from public.athlete_evaluations e where e.team_id = m.team_id and e.deleted_at is null),
    m.created_at
  from public.team_members m join public.teams t on t.id = m.team_id
  where m.user_id = (select auth.uid())
  order by m.created_at;
$$;
revoke all on function public.my_clubs() from public, anon;
grant execute on function public.my_clubs() to authenticated;
