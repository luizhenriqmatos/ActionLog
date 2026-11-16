-- ScoutHouse v2 · Fase 2.3 · tipo de partida e política de contagem (EXPAND)
-- Três decisões independentes por tipo de partida: conta no atleta, conta na campanha, aparece para a família.
-- O valor efetivo é congelado no jogo quando ele é criado: mudar a política depois não reescreve o passado.

create table public.tipo_partida (
  codigo text primary key,
  nome text not null,
  ordem smallint not null default 0,
  ativo boolean not null default true
);
insert into public.tipo_partida (codigo, nome, ordem) values
  ('oficial', 'Jogo oficial', 1), ('amistoso', 'Amistoso', 2), ('jogo_treino', 'Jogo-treino', 3);

alter table public.tipo_partida enable row level security;
create policy tipo_partida_select on public.tipo_partida for select to authenticated using (true);

create table public.politica_contagem (
  clube_id uuid not null references public.teams(id) on delete cascade,
  tipo_partida_codigo text not null references public.tipo_partida(codigo),
  conta_individual boolean not null,
  conta_campanha boolean not null,
  visivel_familia boolean not null,
  updated_at timestamptz not null default now(),
  primary key (clube_id, tipo_partida_codigo)
);
alter table public.politica_contagem enable row level security;
create policy politica_contagem_select on public.politica_contagem for select to authenticated using (private.is_team_member(clube_id));
create policy politica_contagem_update on public.politica_contagem for update to authenticated using (private.is_team_admin(clube_id)) with check (private.is_team_admin(clube_id));

-- padrões: oficial conta tudo; jogo-treino conta só no atleta e não vai para a família;
-- amistoso conta no atleta e aparece para a família, sem campanha (padrão proposto, editável por clube).
create function private.seed_politica_contagem(clube uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.politica_contagem (clube_id, tipo_partida_codigo, conta_individual, conta_campanha, visivel_familia) values
    (clube, 'oficial', true, true, true),
    (clube, 'amistoso', true, false, true),
    (clube, 'jogo_treino', true, false, false)
  on conflict do nothing;
$$;
revoke all on function private.seed_politica_contagem(uuid) from public, anon, authenticated;
select private.seed_politica_contagem(id) from public.teams;

create function private.seed_politica_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_politica_contagem(new.id);
  return new;
end $$;
revoke all on function private.seed_politica_trigger() from public, anon, authenticated;
create trigger teams_seed_politica after insert on public.teams
  for each row execute function private.seed_politica_trigger();

-- no jogo: tipo e política congelada. Anuláveis; o app ainda não envia nem lê.
alter table public.matches
  add column tipo_partida_codigo text references public.tipo_partida(codigo),
  add column politica_contagem_efetiva jsonb;

create function private.politica_snapshot(clube uuid, tipo text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tipo_partida', p.tipo_partida_codigo, 'conta_individual', p.conta_individual,
                            'conta_campanha', p.conta_campanha, 'visivel_familia', p.visivel_familia, 'congelada_em', now())
  from public.politica_contagem p where p.clube_id = clube and p.tipo_partida_codigo = tipo;
$$;
revoke all on function private.politica_snapshot(uuid, text) from public, anon, authenticated;

-- todo o histórico existente é 'oficial'
update public.matches m
set tipo_partida_codigo = 'oficial', politica_contagem_efetiva = private.politica_snapshot(m.team_id, 'oficial')
where m.tipo_partida_codigo is null;

-- jogo novo: sem tipo informado vale 'oficial'; a política é congelada na criação e só é refeita se o tipo mudar
create function private.match_freeze_politica() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tipo_partida_codigo is null then new.tipo_partida_codigo := 'oficial'; end if;
  if tg_op = 'INSERT' or new.tipo_partida_codigo is distinct from old.tipo_partida_codigo then
    new.politica_contagem_efetiva := private.politica_snapshot(new.team_id, new.tipo_partida_codigo);
  else
    new.politica_contagem_efetiva := old.politica_contagem_efetiva;
  end if;
  return new;
end $$;
revoke all on function private.match_freeze_politica() from public, anon, authenticated;
create trigger matches_freeze_politica before insert or update on public.matches
  for each row execute function private.match_freeze_politica();
