-- ActionLog v2.4 · convites de membros, time único por usuário e proteção do último admin

-- 1. Garante um único time inicial por usuário, mesmo com duas abas/chamadas simultâneas.
create function public.ensure_my_team(p_name text default '') returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_team uuid;
begin
  if (select auth.uid()) is null then raise exception 'não autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text, 0));
  select team_id into v_team from public.team_members where user_id = (select auth.uid()) order by created_at limit 1;
  if v_team is null then
    insert into public.teams (name) values (coalesce(nullif(trim(p_name), ''), 'Meu time')) returning id into v_team;
  end if;
  return v_team;
end $$;
revoke all on function public.ensure_my_team(text) from public, anon;
grant execute on function public.ensure_my_team(text) to authenticated;

-- 2. Convites: código curto, papel definido, validade de 7 dias, uso único.
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  role text not null default 'treinador' check (role in ('admin', 'treinador', 'analista', 'leitura')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
create index team_invites_team_idx on public.team_invites(team_id);
alter table public.team_invites enable row level security;
create policy invites_select on public.team_invites for select to authenticated using (private.is_team_admin(team_id));
create policy invites_insert on public.team_invites for insert to authenticated with check (private.is_team_admin(team_id) and created_by = (select auth.uid()));
create policy invites_delete on public.team_invites for delete to authenticated using (private.is_team_admin(team_id));

-- Aceitar convite precisa inserir em team_members sem ser admin: por isso security definer,
-- com todas as checagens dentro da função.
create function public.accept_team_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_invite public.team_invites%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'não autenticado'; end if;
  select * into v_invite from public.team_invites where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Convite não encontrado. Confira o código.'; end if;
  if exists (select 1 from public.team_members where team_id = v_invite.team_id and user_id = (select auth.uid())) then
    return v_invite.team_id;
  end if;
  if v_invite.used_at is not null then raise exception 'Este convite já foi usado. Peça um novo.'; end if;
  if v_invite.expires_at < now() then raise exception 'Este convite expirou. Peça um novo.'; end if;
  insert into public.team_members (team_id, user_id, role) values (v_invite.team_id, (select auth.uid()), v_invite.role);
  update public.team_invites set used_by = (select auth.uid()), used_at = now() where id = v_invite.id;
  return v_invite.team_id;
end $$;
revoke all on function public.accept_team_invite(text) from public, anon;
grant execute on function public.accept_team_invite(text) to authenticated;

-- Times do usuário (para escolher entre mais de um).
create function public.my_teams() returns table (team_id uuid, name text, role text)
language sql stable security invoker set search_path = '' as $$
  select m.team_id, t.name, m.role from public.team_members m join public.teams t on t.id = m.team_id
  where m.user_id = (select auth.uid()) order by m.created_at;
$$;
revoke all on function public.my_teams() from public, anon;
grant execute on function public.my_teams() to authenticated;

-- Lista de membros com e-mail (auth.users não é exposto pela API), só para quem é do time.
create function public.list_team_members(p_team uuid) returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_team_member(p_team) then raise exception 'sem acesso a este time'; end if;
  return query select m.user_id, u.email::text, m.role, m.created_at from public.team_members m join auth.users u on u.id = m.user_id
    where m.team_id = p_team order by m.created_at;
end $$;
revoke all on function public.list_team_members(uuid) from public, anon;
grant execute on function public.list_team_members(uuid) to authenticated;

-- 3. O time nunca fica sem admin.
create function private.keep_one_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and exists (select 1 from public.teams where id = old.team_id)
     and not exists (select 1 from public.team_members where team_id = old.team_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'O time precisa de pelo menos um admin. Promova outra pessoa antes.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.keep_one_admin() from public, anon, authenticated;
create trigger team_members_keep_admin before update or delete on public.team_members
  for each row execute function private.keep_one_admin();
