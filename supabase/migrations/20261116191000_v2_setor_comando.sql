-- ScoutHouse v2 · D-L · prevenção de lance contado em dobro, no servidor
-- 1. O setor do observador vira dado (sessao_registro), com início e fim. Um setor tem no máximo um dono por vez.
-- 2. Evento de atleta cujo setor tem dono só é aceito do dono (no momento do lance).
-- 3. Escanteios, gol do adversário, início/fim de período e substituição: só quem estava no comando no momento.
-- Recusa chega ao aparelho como erro de regra e cai na lista de recusados (Fase 1.5), nunca some.
-- Só vale para eventos novos com origem 'ao_vivo'. Nada do histórico é revalidado.

create table public.sessao_registro (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null default '',
  escopo text not null check (escopo in ('ALL', 'DEF', 'MEI', 'ATA')),
  inicio timestamptz not null default now(),
  fim timestamptz,
  check (fim is null or fim >= inicio)
);
-- no máximo um dono aberto por setor, e uma sessão aberta por pessoa em cada jogo
create unique index sessao_registro_dono_idx on public.sessao_registro (match_id, escopo) where fim is null and escopo <> 'ALL';
create unique index sessao_registro_pessoa_idx on public.sessao_registro (match_id, user_id) where fim is null;
create index sessao_registro_match_idx on public.sessao_registro (match_id, escopo, inicio);
comment on table public.sessao_registro is 'Setor que cada observador cobre em cada jogo. ALL = sem setor (não é dono de nada).';

alter table public.sessao_registro enable row level security;
create policy sessao_registro_select on public.sessao_registro for select to authenticated using (private.can_see_match(match_id));
-- escrita só pela função assumir_setor

alter table public.match_events add constraint match_events_sessao_fk foreign key (sessao_registro_id) references public.sessao_registro(id) on delete set null not valid;

-- ---------- histórico do comando (quem comandava quando) ----------
create table public.match_comando (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  inicio timestamptz not null default now(),
  fim timestamptz
);
create index match_comando_idx on public.match_comando (match_id, user_id, inicio);
alter table public.match_comando enable row level security;
create policy match_comando_select on public.match_comando for select to authenticated using (private.can_see_match(match_id));

insert into public.match_comando (match_id, user_id, inicio)
select id, commander_user_id, created_at from public.matches where commander_user_id is not null;

create function private.match_comando_track() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.commander_user_id is not distinct from old.commander_user_id then return new; end if;
  update public.match_comando set fim = now() where match_id = new.id and fim is null;
  if new.commander_user_id is not null then
    insert into public.match_comando (match_id, user_id) values (new.id, new.commander_user_id);
  end if;
  return new;
end $$;
revoke all on function private.match_comando_track() from public, anon, authenticated;
create trigger matches_comando_track after insert or update of commander_user_id on public.matches
  for each row execute function private.match_comando_track();

-- ---------- assumir setor ----------
-- Devolve a sessão aberta. Se outro observador tem o setor: erro, a menos que p_forcar (aí ele perde o setor).
create function public.assumir_setor(p_match uuid, p_escopo text, p_nome text default '', p_forcar boolean default false)
returns public.sessao_registro
language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches%rowtype;
  v_mine public.sessao_registro%rowtype;
  v_other public.sessao_registro%rowtype;
  v_new public.sessao_registro%rowtype;
  v_label text := case p_escopo when 'DEF' then 'Defesa' when 'MEI' then 'Meio' when 'ATA' then 'Ataque' else 'Todos' end;
begin
  if (select auth.uid()) is null then raise exception 'não autenticado'; end if;
  if p_escopo not in ('ALL', 'DEF', 'MEI', 'ATA') then raise exception 'setor inválido'; end if;
  select * into v_match from public.matches where id = p_match for update;
  if not found or not private.can_write_match(p_match) then raise exception 'sem acesso a este jogo'; end if;

  select * into v_mine from public.sessao_registro where match_id = p_match and user_id = (select auth.uid()) and fim is null;
  if found and v_mine.escopo = p_escopo then return v_mine; end if;

  if p_escopo <> 'ALL' then
    select * into v_other from public.sessao_registro where match_id = p_match and escopo = p_escopo and fim is null and user_id <> (select auth.uid());
    if found then
      if not p_forcar then
        raise exception 'SETOR_OCUPADO:%', coalesce(nullif(v_other.user_name, ''), 'outro observador') using errcode = 'P0001',
          hint = format('O setor %s já está com %s.', v_label, coalesce(nullif(v_other.user_name, ''), 'outro observador'));
      end if;
      update public.sessao_registro set fim = now() where id = v_other.id;
    end if;
  end if;

  update public.sessao_registro set fim = now() where match_id = p_match and user_id = (select auth.uid()) and fim is null;
  insert into public.sessao_registro (match_id, team_id, user_id, user_name, escopo)
    values (p_match, v_match.team_id, (select auth.uid()), coalesce(p_nome, ''), p_escopo)
    returning * into v_new;
  return v_new;
end $$;
revoke all on function public.assumir_setor(uuid, text, text, boolean) from public, anon;
grant execute on function public.assumir_setor(uuid, text, text, boolean) to authenticated;

-- ---------- a regra ----------
create function private.match_event_escopo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(new.created_at, now());
  v_sector text;
  v_owner uuid;
  v_owner_name text;
  v_label text;
begin
  if coalesce(new.origem, 'ao_vivo') <> 'ao_vivo' then return new; end if;

  -- somente comando (folga de 30 s na troca de comando, para fila atrasada)
  if new.kind in ('corner_for', 'corner_against', 'opponent_goal', 'period_start', 'period_end', 'sub_in', 'sub_out') then
    if exists (select 1 from public.match_comando c where c.match_id = new.match_id)
       and not exists (select 1 from public.match_comando c where c.match_id = new.match_id and c.user_id = new.created_by
                       and c.inicio <= v_at + interval '30 seconds' and (c.fim is null or c.fim > v_at - interval '30 seconds')) then
      select nome into v_label from public.tipo_evento where codigo = new.kind and clube_id is null;
      raise exception 'Só o comando do jogo registra "%".', coalesce(v_label, new.kind) using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.athlete_id is null then return new; end if;
  select sector into v_sector from public.match_players where match_id = new.match_id and athlete_id = new.athlete_id;
  if v_sector is null then return new; end if;

  select s.user_id, s.user_name into v_owner, v_owner_name
  from public.sessao_registro s
  where s.match_id = new.match_id and s.escopo = v_sector and s.inicio <= v_at and (s.fim is null or s.fim > v_at)
  order by s.inicio desc limit 1;

  if v_owner is not null and v_owner <> new.created_by then
    v_label := case v_sector when 'DEF' then 'Defesa' when 'MEI' then 'Meio' else 'Ataque' end;
    raise exception 'Atleta do setor % — quem registra é %.', v_label, coalesce(nullif(v_owner_name, ''), 'o dono do setor') using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.match_event_escopo() from public, anon, authenticated;
create trigger match_events_escopo before insert on public.match_events
  for each row execute function private.match_event_escopo();
