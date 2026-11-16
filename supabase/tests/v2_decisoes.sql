-- ScoutHouse v2 · D-K, D-L, D-M e data de nascimento · testes no banco.
-- Simula três membros reais de um clube (admin + 2 treinadores) com o papel "authenticated", então o RLS vale de verdade.
-- Sempre termina em exceção: nada fica gravado. Saída esperada: "DECISOES OK (rollback): ...".
do $$
declare
  clube uuid; a uuid; b uuid; c uuid; jogo uuid; n int; ok text := ''; falhou boolean; msg text; t1 uuid; resp uuid; v_fim timestamptz;
begin
  select team_id into clube from public.team_members group by team_id having count(*) >= 3 limit 1;
  select user_id into a from public.team_members where team_id = clube and role = 'admin' limit 1;
  select user_id into b from public.team_members where team_id = clube and role <> 'admin' order by user_id limit 1;
  select user_id into c from public.team_members where team_id = clube and role <> 'admin' and user_id <> b order by user_id limit 1;
  if c is null then raise exception 'FALHA preparo: clube sem 3 membros'; end if;
  update public.team_members set role = 'treinador', categorias = null where team_id = clube and user_id = b;
  update public.team_members set role = 'treinador', categorias = array['Sub-16'] where team_id = clube and user_id = c;

  -- dados de teste em duas categorias
  insert into public.athletes (team_id, id, category, name) values
    (clube, 't-x', 'Sub-16', 'X defensor'), (clube, 't-y', 'Sub-16', 'Y meia'), (clube, 't-z', 'Sub-16', 'Z atacante'), (clube, 't-w', 'Sub-15', 'W outra categoria');
  insert into public.calendar_events (team_id, id, category, type, title, date) values (clube, 't-cal16', 'Sub-16', 'Jogo', 'Teste', current_date), (clube, 't-cal15', 'Sub-15', 'Jogo', 'Teste', current_date);
  insert into public.matches (team_id, category, calendar_event_id, match_date, commander_user_id, commander_name) values (clube, 'Sub-16', 't-cal16', current_date, a, 'Admin') returning id into jogo;
  insert into public.matches (team_id, category, calendar_event_id, match_date) values (clube, 'Sub-15', 't-cal15', current_date);
  insert into public.match_players (match_id, team_id, athlete_id, sector, on_field) values (jogo, clube, 't-x', 'DEF', true), (jogo, clube, 't-y', 'MEI', true), (jogo, clube, 't-z', 'ATA', true);
  -- dentro de uma transação now() não anda: recua o início do comando para simular um jogo já em andamento
  update public.match_comando set inicio = now() - interval '1 hour' where match_id = jogo;

  -- ===== D-K =====
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.athletes where category <> 'Sub-16') then raise exception 'FALHA D-K: membro restrito vê outra categoria'; end if;
  if not exists (select 1 from public.athletes where id = 't-x') then raise exception 'FALHA D-K: membro restrito não vê a própria categoria'; end if;
  if exists (select 1 from public.matches where category <> 'Sub-16') or exists (select 1 from public.calendar_events where category <> 'Sub-16') then raise exception 'FALHA D-K: jogo/calendário de outra categoria visível'; end if;
  falhou := false;
  begin insert into public.athletes (team_id, id, category, name) values (clube, 't-proibido', 'Sub-15', 'Não pode'); exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA D-K: escreveu em categoria proibida'; end if;
  falhou := false;
  begin update public.athletes set category = 'Sub-15' where team_id = clube and id = 't-x'; exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA D-K: moveu atleta para categoria proibida'; end if;
  insert into public.athletes (team_id, id, category, name) values (clube, 't-permitido', 'Sub-16', 'Pode');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not exists (select 1 from public.athletes where id = 't-w') then raise exception 'FALHA D-K: admin não vê tudo'; end if;
  falhou := false;
  begin insert into public.team_invites (team_id, role) values (clube, 'leitura'); exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA D-K: convite de leitura sem categorias aceito'; end if;
  insert into public.team_invites (team_id, role, categorias) values (clube, 'leitura', array['Sub-16']);
  reset role;
  ok := ok || 'D-K ';

  -- ===== D-L =====
  -- B fica com a Defesa; C tenta e é barrado; C fica com o Meio
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.assumir_setor(jogo, 'DEF', 'Treinador B');
  reset role;
  update public.sessao_registro set inicio = now() - interval '1 hour' where match_id = jogo and user_id = b;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  msg := '';
  begin perform public.assumir_setor(jogo, 'DEF', 'Treinador C'); exception when others then msg := sqlerrm; end;
  if msg not like 'SETOR_OCUPADO:Treinador B%' then raise exception 'FALHA D-L: setor ocupado não barrou (%)', msg; end if;
  perform public.assumir_setor(jogo, 'MEI', 'Treinador C');
  -- C registra o meia: aceito. C registra o defensor: recusado.
  insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, created_by) values (gen_random_uuid(), jogo, clube, 'pass_ok', 't-y', 1, c);
  msg := '';
  begin insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, created_by) values (gen_random_uuid(), jogo, clube, 'pass_ok', 't-x', 1, c); exception when others then msg := sqlerrm; end;
  if msg not like 'Atleta do setor Defesa%Treinador B%' then raise exception 'FALHA D-L: evento fora do setor aceito (%)', msg; end if;
  -- C não é comando: escanteio recusado
  msg := '';
  begin insert into public.match_events (id, match_id, team_id, kind, period, created_by) values (gen_random_uuid(), jogo, clube, 'corner_for', 1, c); exception when others then msg := sqlerrm; end;
  if msg not like 'Só o comando%' then raise exception 'FALHA D-L: escanteio de quem não comanda aceito (%)', msg; end if;
  reset role;
  -- A (comando, sem setor): escanteio ok; defensor (setor com dono) recusado; atacante (setor sem dono) ok
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.match_events (id, match_id, team_id, kind, period, created_by) values (gen_random_uuid(), jogo, clube, 'corner_for', 1, a);
  falhou := false;
  begin insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, created_by) values (gen_random_uuid(), jogo, clube, 'tackle', 't-x', 1, a); exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA D-L: comando registrou atleta de setor com dono'; end if;
  insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, created_by) values (gen_random_uuid(), jogo, clube, 'shot', 't-z', 1, a);
  -- A passa o comando para B
  update public.matches set commander_user_id = b, commander_name = 'Treinador B' where id = jogo;
  -- escanteio de A marcado 5 min ANTES da troca (fila atrasada): aceito
  insert into public.match_events (id, match_id, team_id, kind, period, created_by, created_at) values (gen_random_uuid(), jogo, clube, 'corner_against', 1, a, now() - interval '5 minutes');
  -- escanteio de A 2 min DEPOIS da troca: recusado
  falhou := false;
  begin insert into public.match_events (id, match_id, team_id, kind, period, created_by, created_at) values (gen_random_uuid(), jogo, clube, 'corner_for', 1, a, now() + interval '2 minutes'); exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA D-L: ex-comando registrou escanteio depois da troca'; end if;
  reset role;
  -- C assume a Defesa à força: lance de B na Defesa ANTES continua aceito; DEPOIS é recusado
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.assumir_setor(jogo, 'DEF', 'Treinador C', true);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, created_by, created_at) values (gen_random_uuid(), jogo, clube, 'tackle', 't-x', 1, b, now() - interval '1 minute');
  falhou := false;
  begin insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, created_by, created_at) values (gen_random_uuid(), jogo, clube, 'tackle', 't-x', 1, b, now() + interval '1 second'); exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA D-L: quem perdeu o setor continuou registrando'; end if;
  -- B ficou sem sessão aberta? (perdeu a Defesa)
  if exists (select 1 from public.sessao_registro where match_id = jogo and user_id = b and fim is null) then raise exception 'FALHA D-L: sessão de quem perdeu o setor continua aberta'; end if;
  reset role;
  -- um dono por setor, sempre
  if exists (select 1 from public.sessao_registro where match_id = jogo and fim is null and escopo <> 'ALL' group by escopo having count(*) > 1) then raise exception 'FALHA D-L: dois donos no mesmo setor'; end if;
  -- evento de origem que não é ao vivo (correção pós-jogo) não passa pela regra
  insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, created_by, origem) values (gen_random_uuid(), jogo, clube, 'goal', 't-x', 1, a, 'correcao');
  ok := ok || 'D-L ';

  -- ===== D-M =====
  insert into public.scout_sessions (team_id, id, category, mode, athlete_id, athlete_name, dominant_foot_snapshot, calendar_date, goals, shots_on_target, shots)
    values (clube, 't-sessao', 'Sub-16', 'game', 't-x', 'X', 'Direita', current_date, 1, 0, 0);
  falhou := false;
  begin insert into public.scout_sessions (team_id, id, category, mode, athlete_id, athlete_name, dominant_foot_snapshot, calendar_date, dominant_finishes, dominant_on_target, dominant_goals)
    values (clube, 't-treino', 'Sub-16', 'finishing', 't-x', 'X', 'Direita', current_date, 1, 0, 1); exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA D-M: CHECK do treino de finalização foi removido junto'; end if;
  with ev as (select match_id, athlete_id, count(*) filter (where kind = 'shot') sh, count(*) filter (where kind = 'shot_on_target') sot
              from public.match_events where deleted_at is null and athlete_id is not null group by 1, 2)
  select count(*) into n from public.scout_sessions s left join ev e on e.match_id = s.match_id and e.athlete_id = s.athlete_id
  where s.match_id is not null and s.deleted_at is null and s.updated_at = s.created_at and (s.shots <> coalesce(e.sh, 0) or s.shots_on_target <> coalesce(e.sot, 0));
  if n <> 0 then raise exception 'FALHA D-M: % sessão(ões) de jogo ainda com finalização inventada', n; end if;
  if (select count(*) from public.scout_sessions s join backup_20261116.scout_sessions b2 using (team_id, id) where s.shots <> b2.shots or s.shots_on_target <> b2.shots_on_target) <> 5 then raise exception 'FALHA D-M: correção não atingiu exatamente as 5 sessões medidas'; end if;
  if exists (select 1 from public.scout_sessions s join backup_20261116.scout_sessions b2 using (team_id, id) where s.goals <> b2.goals or s.accurate_passes <> b2.accurate_passes or s.tackles <> b2.tackles) then raise exception 'FALHA D-M: correção mexeu em outro número'; end if;
  ok := ok || 'D-M ';

  -- ===== data de nascimento =====
  update public.athletes set birth_date = date '2010-03-15' where team_id = clube and id = 't-x';
  insert into public.texto_legal (chave, versao, conteudo) values ('teste', 1, 'teste') returning id into t1;
  insert into public.responsavel (clube_id, nome) values (clube, 'Resp') returning id into resp;
  insert into public.consentimento (clube_id, atleta_id, finalidade, base_legal, texto_legal_id, outorgado_por, responsavel_id)
    values (clube, 't-x', 'desempenho_interno', 'consentimento', t1, 'responsavel', resp) returning vigencia_fim into v_fim;
  if v_fim::date <> date '2028-03-15' then raise exception 'FALHA nascimento: consentimento não vence na maioridade (%)', v_fim; end if;
  -- upsert como o app antigo faz (sem birth_date) não apaga a data
  insert into public.athletes (team_id, id, category, name, updated_at) values (clube, 't-x', 'Sub-16', 'X defensor', now())
    on conflict (team_id, id) do update set name = excluded.name, updated_at = excluded.updated_at;
  if (select birth_date from public.athletes where team_id = clube and id = 't-x') is distinct from date '2010-03-15' then raise exception 'FALHA nascimento: app antigo apagou a data'; end if;
  perform private.anonimizar_atleta(clube, 't-x', 'teste');
  if (select birth_date from public.athletes where team_id = clube and id = 't-x') is not null then raise exception 'FALHA nascimento: anonimização manteve a data'; end if;
  ok := ok || 'nascimento ';

  raise exception 'DECISOES OK (rollback): %', ok;
end $$;
