-- ScoutHouse v2 · Fase 2.1 · categoria como entidade (EXPAND)
-- Só adição: tabela nova e coluna categoria_id ANULÁVEL ao lado de cada `category text`.
-- Os cinco CHECKs de category continuam valendo e o app continua lendo `category`.
-- O aparelho não conhece categoria_id: quem preenche é um trigger no servidor, a partir de (team_id, category).

create table public.categoria (
  id uuid primary key default gen_random_uuid(),
  clube_id uuid not null references public.teams(id) on delete cascade,
  nome text not null,
  ordem smallint not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clube_id, nome)
);
comment on table public.categoria is 'Categoria de um clube (teams). Substituirá o texto `category` na fase de contract.';

alter table public.categoria enable row level security;
create policy categoria_select on public.categoria for select to authenticated using (private.is_team_member(clube_id));
create policy categoria_insert on public.categoria for insert to authenticated with check (private.is_team_admin(clube_id));
create policy categoria_update on public.categoria for update to authenticated using (private.is_team_admin(clube_id)) with check (private.is_team_admin(clube_id));
-- sem policy de DELETE: categoria é desativada (ativo = false), nunca apagada

-- as quatro categorias atuais, para cada clube existente
insert into public.categoria (clube_id, nome, ordem)
select t.id, c.nome, c.ordem
from public.teams t
cross join (values ('Sub-15', 1), ('Sub-16', 2), ('Sub-17', 3), ('Sub-20', 4)) as c(nome, ordem)
on conflict (clube_id, nome) do nothing;

-- clube novo já nasce com as quatro
create function private.seed_categorias() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.categoria (clube_id, nome, ordem)
  values (new.id, 'Sub-15', 1), (new.id, 'Sub-16', 2), (new.id, 'Sub-17', 3), (new.id, 'Sub-20', 4)
  on conflict (clube_id, nome) do nothing;
  return new;
end $$;
revoke all on function private.seed_categorias() from public, anon, authenticated;
create trigger teams_seed_categorias after insert on public.teams
  for each row execute function private.seed_categorias();

alter table public.athletes add column categoria_id uuid references public.categoria(id);
alter table public.calendar_events add column categoria_id uuid references public.categoria(id);
alter table public.scout_sessions add column categoria_id uuid references public.categoria(id);
alter table public.athlete_evaluations add column categoria_id uuid references public.categoria(id);
alter table public.matches add column categoria_id uuid references public.categoria(id);

-- backfill pelo par (team_id, category). Não toca em updated_at: os aparelhos não enxergam mudança.
do $$
declare t text;
begin
  foreach t in array array['athletes', 'calendar_events', 'scout_sessions', 'athlete_evaluations', 'matches'] loop
    execute format('update public.%1$I x set categoria_id = c.id from public.categoria c where c.clube_id = x.team_id and c.nome = x.category and x.categoria_id is null', t);
    execute format('create index %1$s_categoria_idx on public.%1$I (categoria_id)', t);
  end loop;
end $$;

-- daqui em diante: toda linha gravada pelo app recebe categoria_id coerente com `category`
create function private.fill_categoria_id() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.categoria_id := (select c.id from public.categoria c where c.clube_id = new.team_id and c.nome = new.category);
  return new;
end $$;
revoke all on function private.fill_categoria_id() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['athletes', 'calendar_events', 'scout_sessions', 'athlete_evaluations', 'matches'] loop
    execute format('create trigger %1$s_fill_categoria before insert or update on public.%1$I for each row execute function private.fill_categoria_id()', t);
  end loop;
end $$;
