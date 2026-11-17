-- ScoutHouse v2 · Fase 3.1 · testes no banco: invariantes da partida, identidade, flag e placar derivado.
-- Sempre termina em exceção (rollback): nada fica gravado. Saída esperada: "FASE 3.1 OK (rollback): ...".
do $$
declare
  clube uuid; c1 uuid; c2 uuid; s uuid; s2 uuid; ok text := ''; falhou boolean; jogo uuid; n int; vis text; pl record; u uuid; ini timestamptz := '2031-05-01 15:00-03';
begin
  select id into clube from public.teams order by created_at limit 1;
  select user_id into u from public.team_members where team_id = clube limit 1;
  select id into c1 from public.categoria where clube_id = clube order by ordem limit 1;
  select id into c2 from public.categoria where clube_id = clube and id <> c1 order by ordem limit 1;

  -- 1 participante: rejeita
  falhou := false;
  begin
    insert into public.sessao (clube_id, tipo, inicio_previsto) values (clube, 'partida', ini) returning id into s;
    insert into public.partida (sessao_id, clube_id, inicio_previsto, hora_presumida) values (s, clube, ini, false);
    insert into public.partida_participante (partida_id, lado, tipo, categoria_id, nome_exibicao, inicio_previsto, hora_presumida) values (s, 'mandante', 'categoria_interna', c1, 'A', ini, false);
    set constraints all immediate; set constraints all deferred;
  exception when check_violation then falhou := true; end;
  if not falhou then raise exception 'FALHA: partida com 1 participante foi aceita'; end if;
  ok := ok || '1 participante rejeita; ';

  -- 2 participantes (categoria x equipe externa): aceita
  insert into public.sessao (clube_id, tipo, inicio_previsto) values (clube, 'partida', ini) returning id into s;
  insert into public.partida (sessao_id, clube_id, inicio_previsto, hora_presumida) values (s, clube, ini, false);
  insert into public.partida_participante (partida_id, lado, tipo, categoria_id, nome_exibicao, inicio_previsto, hora_presumida) values
    (s, 'mandante', 'categoria_interna', c1, 'A', ini, false), (s, 'visitante', 'equipe_externa', null, 'Vitória ', ini, false);
  set constraints all immediate; set constraints all deferred;
  ok := ok || '2 aceita; ';

  -- 3º participante / dois mandantes: rejeita
  falhou := false;
  begin
    insert into public.partida_participante (partida_id, lado, tipo, categoria_id, nome_exibicao, inicio_previsto, hora_presumida) values (s, 'mandante', 'categoria_interna', c2, 'B', ini, false);
  exception when unique_violation then falhou := true; end;
  if not falhou then raise exception 'FALHA: 3º participante / segundo mandante aceito'; end if;
  ok := ok || '3º rejeita; ';

  -- mesma categoria nos dois lados: rejeita
  falhou := false;
  begin
    insert into public.sessao (clube_id, tipo, inicio_previsto) values (clube, 'partida', ini + interval '1 day') returning id into s2;
    insert into public.partida (sessao_id, clube_id, inicio_previsto, hora_presumida) values (s2, clube, ini + interval '1 day', true);
    insert into public.partida_participante (partida_id, lado, tipo, categoria_id, nome_exibicao, inicio_previsto, hora_presumida) values
      (s2, 'mandante', 'categoria_interna', c1, 'A', ini + interval '1 day', true), (s2, 'visitante', 'categoria_interna', c1, 'A', ini + interval '1 day', true);
    set constraints all immediate; set constraints all deferred;
  exception when check_violation then falhou := true; end;
  if not falhou then raise exception 'FALHA: mesma categoria nos dois lados aceita'; end if;
  ok := ok || 'mesma categoria rejeita; ';

  -- identidade: mesma categoria, mesmo instante, hora real: rejeita
  falhou := false;
  begin
    insert into public.sessao (clube_id, tipo, inicio_previsto) values (clube, 'partida', ini) returning id into s2;
    insert into public.partida (sessao_id, clube_id, inicio_previsto, hora_presumida) values (s2, clube, ini, false);
    insert into public.partida_participante (partida_id, lado, tipo, categoria_id, nome_exibicao, inicio_previsto, hora_presumida) values
      (s2, 'mandante', 'categoria_interna', c1, 'A', ini, false), (s2, 'visitante', 'equipe_externa', null, 'Outro', ini, false);
  exception when unique_violation then falhou := true; end;
  if not falhou then raise exception 'FALHA: mesmo jogo cadastrado duas vezes foi aceito'; end if;
  ok := ok || 'jogo duplicado rejeita; ';

  -- dois jogos da mesma categoria no mesmo DIA, horas diferentes: aceita
  insert into public.sessao (clube_id, tipo, inicio_previsto) values (clube, 'partida', ini + interval '3 hours') returning id into s2;
  insert into public.partida (sessao_id, clube_id, inicio_previsto, hora_presumida) values (s2, clube, ini + interval '3 hours', false);
  insert into public.partida_participante (partida_id, lado, tipo, categoria_id, nome_exibicao, inicio_previsto, hora_presumida) values
    (s2, 'mandante', 'categoria_interna', c1, 'A', ini + interval '3 hours', false), (s2, 'visitante', 'equipe_externa', null, 'Outro', ini + interval '3 hours', false);
  set constraints all immediate; set constraints all deferred;
  ok := ok || 'dois jogos no mesmo dia aceitos; ';

  -- flag desligada: matches novo NÃO espelha; ligada: espelha e acompanha o adversário
  insert into public.calendar_events (team_id, id, category, type, title, date) select clube, 't-cal', nome, 'Jogo', 'T', current_date from public.categoria where id = c1;
  insert into public.matches (team_id, category, calendar_event_id, match_date, opponent) select clube, nome, 't-cal', current_date, 'Vitória ' from public.categoria where id = c1 returning id into jogo;
  select count(*) into n from public.partida where id_legado = jogo;
  if n <> 0 then raise exception 'FALHA: espelhou com a flag desligada'; end if;
  insert into public.clube_recurso (clube_id, recurso, ligado) values (clube, 'partida_v2', true);
  update public.matches set opponent = 'vitoria' where id = jogo;
  select count(*) into n from public.partida where id_legado = jogo;
  if n <> 1 then raise exception 'FALHA: não espelhou com a flag ligada'; end if;
  select v.nome_exibicao into vis from public.partida p join public.partida_participante v on v.partida_id = p.sessao_id and v.lado = 'visitante' where p.id_legado = jogo;
  if vis <> 'vitoria' then raise exception 'FALHA: adversário não acompanhou (%).', vis; end if;
  update public.matches set opponent = 'Vitória ' where id = jogo;
  select v.nome_exibicao into vis from public.partida p join public.partida_participante v on v.partida_id = p.sessao_id and v.lado = 'visitante' where p.id_legado = jogo;
  if vis <> 'Vitória ' then raise exception 'FALHA: texto original (com espaço) não preservado'; end if;
  ok := ok || 'flag e espelho ok, texto original preservado; ';

  -- placar derivado dos eventos
  insert into public.match_events (id, match_id, team_id, kind, period, clock_seconds, origem, created_by) values
    (gen_random_uuid(), jogo, clube, 'opponent_goal', 1, 60, 'ao_vivo', u), (gen_random_uuid(), jogo, clube, 'opponent_goal', 1, 120, 'ao_vivo', u);
  select * into pl from public.partida_placar((select sessao_id from public.partida where id_legado = jogo));
  if pl.visitante <> 2 or pl.mandante <> 0 then raise exception 'FALHA placar: % x %', pl.mandante, pl.visitante; end if;
  ok := ok || 'placar derivado 0x2; ';

  raise exception 'FASE 3.1 OK (rollback): %', ok;
end $$;
