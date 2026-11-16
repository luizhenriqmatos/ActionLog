-- ScoutHouse v2 · Fase 2 · testes das regras no banco.
-- Roda tudo dentro de um bloco que SEMPRE termina em exceção: nada fica gravado (rollback garantido).
-- Resultado esperado: erro com a mensagem "FASE2 OK (rollback): ..." . Qualquer outra mensagem é falha.
do $$
declare
  uid uuid; clube uuid; novo_clube uuid; jogo uuid; ev uuid := gen_random_uuid(); atleta text; cat uuid;
  t1 uuid; t2 uuid; c1 uuid; c2 uuid; resp uuid; n int; antes jsonb; depois jsonb; snap jsonb; ok text := '';
  falhou boolean;
begin
  select user_id, team_id into uid, clube from public.team_members where role = 'admin' order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);

  -- 2.1 categoria: linha gravada como o app grava (sem categoria_id) sai preenchida e coerente
  insert into public.athletes (team_id, id, category, name) values (clube, 'teste-fase2', 'Sub-17', 'Teste');
  select a.categoria_id into cat from public.athletes a where a.team_id = clube and a.id = 'teste-fase2';
  if cat is null or not exists (select 1 from public.categoria c where c.id = cat and c.clube_id = clube and c.nome = 'Sub-17') then raise exception 'FALHA 2.1: categoria_id não preenchido no insert'; end if;
  update public.athletes set category = 'Sub-20' where team_id = clube and id = 'teste-fase2';
  if not exists (select 1 from public.athletes a join public.categoria c on c.id = a.categoria_id where a.team_id = clube and a.id = 'teste-fase2' and c.nome = 'Sub-20') then raise exception 'FALHA 2.1: categoria_id não acompanha mudança de category'; end if;
  -- clube novo nasce com 4 categorias, 3 políticas de contagem e a retenção padrão
  insert into public.teams (name, created_by) values ('Clube de teste fase 2', uid) returning id into novo_clube;
  if (select count(*) from public.categoria where clube_id = novo_clube) <> 4 then raise exception 'FALHA 2.1: clube novo sem 4 categorias'; end if;
  if (select count(*) from public.politica_contagem where clube_id = novo_clube) <> 3 then raise exception 'FALHA 2.3: clube novo sem políticas'; end if;
  if (select count(*) from public.politica_retencao where clube_id = novo_clube and prazo = interval '2 years' and acao = 'anonimizar') <> 1 then raise exception 'FALHA 2.4: clube novo sem retenção padrão'; end if;
  ok := ok || '2.1 ';

  -- 2.2 tipo_evento: desativar um tipo não tira nome nem cor dos eventos antigos
  update public.tipo_evento set ativo = false where codigo = 'pass_ok' and clube_id is null;
  select count(*) into n from public.match_events e left join public.tipo_evento t on t.codigo = e.kind and t.clube_id is null where e.kind = 'pass_ok' and (t.nome is distinct from 'Passe certo' or t.cor_token is distinct from 'green');
  if n <> 0 then raise exception 'FALHA 2.2: evento antigo perdeu nome/cor ao desativar o tipo'; end if;
  if (select count(*) from public.match_events e where not exists (select 1 from public.tipo_evento t where t.codigo = e.kind and t.clube_id is null)) <> 0 then raise exception 'FALHA 2.2: há evento sem tipo no catálogo'; end if;
  ok := ok || '2.2 ';

  -- 2.3 política: congelada no jogo; mudar a política do clube depois não reescreve
  insert into public.calendar_events (team_id, id, category, type, title, date) values (clube, 'cal-teste-fase2', 'Sub-17', 'Jogo', 'Jogo-treino de teste', current_date);
  insert into public.matches (team_id, category, calendar_event_id, match_date, tipo_partida_codigo) values (clube, 'Sub-17', 'cal-teste-fase2', current_date, 'jogo_treino') returning id, politica_contagem_efetiva into jogo, snap;
  if not ((snap->>'conta_individual')::boolean and not (snap->>'conta_campanha')::boolean and not (snap->>'visivel_familia')::boolean) then raise exception 'FALHA 2.3: padrão de jogo-treino errado: %', snap; end if;
  update public.politica_contagem set conta_campanha = true, visivel_familia = true where clube_id = clube and tipo_partida_codigo = 'jogo_treino';
  update public.matches set status = 'live' where id = jogo; -- escrita comum do app
  if (select politica_contagem_efetiva from public.matches where id = jogo) is distinct from snap then raise exception 'FALHA 2.3: política do jogo mudou junto com a do clube'; end if;
  -- jogo criado como o app cria (sem tipo) vale oficial e conta tudo
  if exists (select 1 from public.matches where tipo_partida_codigo is null or politica_contagem_efetiva is null) then raise exception 'FALHA 2.3: jogo sem tipo ou sem política'; end if;
  if exists (select 1 from backup_20261116.matches b join public.matches m using (id) where m.tipo_partida_codigo <> 'oficial') then raise exception 'FALHA 2.3: histórico não é oficial'; end if;
  ok := ok || '2.3 ';

  -- 2.5 evento gravado como o app grava: servidor carimba, desfazer anula, o resto não muda
  insert into public.match_events (id, match_id, team_id, kind, athlete_id, period, clock_seconds, created_by, created_by_name, created_at, ts_servidor)
    values (ev, jogo, clube, 'goal', 'teste-fase2', 1, 600, uid, 'Teste', now() - interval '4 minutes', now() - interval '1 day');
  if not exists (select 1 from public.match_events where id = ev and origem = 'ao_vivo' and status = 'confirmado' and ts_servidor > now() - interval '1 minute') then raise exception 'FALHA 2.5: carimbo do servidor não aplicado (aparelho escolheu ts_servidor)'; end if;
  update public.match_events set deleted_at = now() where id = ev;
  if (select status from public.match_events where id = ev) <> 'anulado' then raise exception 'FALHA 2.5: desfazer não anulou'; end if;
  falhou := false;
  begin update public.match_events set kind = 'assist' where id = ev; exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA 2.5: evento aceitou troca de tipo'; end if;
  falhou := false;
  begin update public.match_events set ts_servidor = now() - interval '1 hour' where id = ev; exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA 2.5: evento aceitou troca do carimbo do servidor'; end if;
  falhou := false;
  begin insert into public.match_events (id, match_id, team_id, kind, period, created_by, status) values (gen_random_uuid(), jogo, clube, 'goal', 1, uid, 'inventado'); exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA 2.5: status fora da lista foi aceito'; end if;
  if (select count(*) from public.match_events where origem is null or status is null or ts_servidor is null) <> 0 then raise exception 'FALHA 2.5: evento sem origem/status/carimbo'; end if;
  ok := ok || '2.5 ';

  -- 2.4 texto versionado e consentimento por finalidade
  insert into public.texto_legal (chave, versao, conteudo) values ('termo_teste', 1, 'versão 1') returning id into t1;
  insert into public.responsavel (clube_id, nome) values (clube, 'Responsável de teste') returning id into resp;
  insert into public.consentimento (clube_id, atleta_id, finalidade, base_legal, texto_legal_id, outorgado_por, responsavel_id) values (clube, 'teste-fase2', 'desempenho_interno', 'consentimento', t1, 'responsavel', resp) returning id into c1;
  insert into public.consentimento (clube_id, atleta_id, finalidade, base_legal, texto_legal_id, outorgado_por, responsavel_id) values (clube, 'teste-fase2', 'imagem_divulgacao', 'consentimento', t1, 'responsavel', resp) returning id into c2;
  insert into public.texto_legal (chave, versao, conteudo) values ('termo_teste', 2, 'versão 2') returning id into t2;
  if (select texto_legal_id from public.consentimento where id = c1) <> t1 then raise exception 'FALHA 2.4: consentimento antigo mudou de versão'; end if;
  falhou := false;
  begin update public.texto_legal set conteudo = 'adulterado' where id = t1; exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA 2.4: texto legal publicado foi alterado'; end if;
  falhou := false;
  begin update public.consentimento set finalidade = 'contato' where id = c1; exception when others then falhou := true; end;
  if not falhou then raise exception 'FALHA 2.4: consentimento foi editado'; end if;
  update public.consentimento set revogado_em = now() where id = c2;
  if (select count(*) from public.consentimento_vigente where clube_id = clube and atleta_id = 'teste-fase2') <> 1
     or not exists (select 1 from public.consentimento_vigente where id = c1) then raise exception 'FALHA 2.4: revogar uma finalidade afetou outra'; end if;
  if not exists (select 1 from public.match_events where id = ev) then raise exception 'FALHA 2.4: revogação apagou evento'; end if;
  -- consentimento do responsável com fim na maioridade deixa de valer depois da data
  insert into public.consentimento (clube_id, atleta_id, finalidade, base_legal, texto_legal_id, outorgado_por, responsavel_id, vigencia_inicio, vigencia_fim)
    values (clube, 'teste-fase2', 'contato', 'consentimento', t2, 'responsavel', resp, now() - interval '2 years', now() - interval '1 day');
  if exists (select 1 from public.consentimento_vigente where clube_id = clube and atleta_id = 'teste-fase2' and finalidade = 'contato') then raise exception 'FALHA 2.4: consentimento vencido na maioridade ainda vale'; end if;

  -- anonimização: o atleta com mais jogos deste banco; agregados de equipe e placares idênticos antes e depois
  select s.team_id, s.athlete_id into clube, atleta from public.scout_sessions s where s.match_id is not null group by 1, 2 order by count(*) desc limit 1;
  select jsonb_build_object(
    'sessoes', (select jsonb_agg(jsonb_build_array(team_id, count, g, a, sh, sot, pc, pe, d, i, pp, fc, fs, mn) order by team_id) from (select team_id, count(*), sum(goals) g, sum(assists) a, sum(shots) sh, sum(shots_on_target) sot, sum(accurate_passes) pc, sum(wrong_passes) pe, sum(tackles) d, sum(interceptions) i, sum(possession_loss) pp, sum(fouls_committed) fc, sum(fouls_suffered) fs, sum(minutes_played) mn from public.scout_sessions where deleted_at is null group by 1) x),
    'placares', (select jsonb_agg(jsonb_build_array(match_id, gf, ga) order by match_id) from (select match_id, count(*) filter (where kind = 'goal') gf, count(*) filter (where kind = 'opponent_goal') ga from public.match_events where deleted_at is null group by 1) x),
    'eventos', (select count(*) from public.match_events),
    'do_atleta', (select jsonb_build_array(count(*), sum(goals), sum(minutes_played)) from public.scout_sessions where team_id = clube and athlete_id = atleta)) into antes;
  perform private.anonimizar_atleta(clube, atleta, 'teste');
  select jsonb_build_object(
    'sessoes', (select jsonb_agg(jsonb_build_array(team_id, count, g, a, sh, sot, pc, pe, d, i, pp, fc, fs, mn) order by team_id) from (select team_id, count(*), sum(goals) g, sum(assists) a, sum(shots) sh, sum(shots_on_target) sot, sum(accurate_passes) pc, sum(wrong_passes) pe, sum(tackles) d, sum(interceptions) i, sum(possession_loss) pp, sum(fouls_committed) fc, sum(fouls_suffered) fs, sum(minutes_played) mn from public.scout_sessions where deleted_at is null group by 1) x),
    'placares', (select jsonb_agg(jsonb_build_array(match_id, gf, ga) order by match_id) from (select match_id, count(*) filter (where kind = 'goal') gf, count(*) filter (where kind = 'opponent_goal') ga from public.match_events where deleted_at is null group by 1) x),
    'eventos', (select count(*) from public.match_events),
    'do_atleta', (select jsonb_build_array(count(*), sum(goals), sum(minutes_played)) from public.scout_sessions where team_id = clube and athlete_id = atleta)) into depois;
  if antes is distinct from depois then raise exception 'FALHA 2.4: anonimização mudou agregado: % -> %', antes, depois; end if;
  if exists (select 1 from public.athletes where team_id = clube and id = atleta and (name <> 'Atleta anonimizado' or age <> '' or height <> '' or weight <> '' or number <> '')) then raise exception 'FALHA 2.4: dado pessoal sobrou na ficha'; end if;
  if exists (select 1 from public.scout_sessions where team_id = clube and athlete_id = atleta and athlete_name <> 'Atleta anonimizado') or exists (select 1 from public.match_players where team_id = clube and athlete_id = atleta and athlete_name <> 'Atleta anonimizado') then raise exception 'FALHA 2.4: nome sobrou em sessão ou relação'; end if;
  -- aparelho antigo reenvia a ficha em cache: o servidor mantém o anonimizado
  update public.athletes set name = 'Nome Real', age = '15', height = '170', weight = '60', updated_at = now() + interval '1 hour' where team_id = clube and id = atleta;
  if (select name from public.athletes where team_id = clube and id = atleta) <> 'Atleta anonimizado' then raise exception 'FALHA 2.4: aparelho devolveu o dado pessoal'; end if;
  ok := ok || '2.4 ';

  -- reconciliação com o backup: nada do que existia mudou nas colunas antigas (as linhas de teste acima não estão no backup)
  select (select count(*) from (select team_id, id, category, type, title, date, opponent, location, md_tag, updated_at, deleted_at from backup_20261116.calendar_events except select team_id, id, category, type, title, date, opponent, location, md_tag, updated_at, deleted_at from public.calendar_events) x)
       + (select count(*) from (select id, match_id, team_id, kind, athlete_id, period, clock_seconds, created_by, created_by_name, created_at, deleted_at from backup_20261116.match_events except select id, match_id, team_id, kind, athlete_id, period, clock_seconds, created_by, created_by_name, created_at, deleted_at from public.match_events) x)
       + (select count(*) from (select id, team_id, category, calendar_event_id, opponent, match_date, status, phase, period, clock_base_seconds, opponent_goals, updated_at from backup_20261116.matches except select id, team_id, category, calendar_event_id, opponent, match_date, status, phase, period, clock_base_seconds, opponent_goals, updated_at from public.matches) x)
       + (select count(*) from (select team_id, id, category, athlete_id, goals, assists, shots, shots_on_target, accurate_passes, wrong_passes, tackles, interceptions, minutes_played, match_id, deleted_at from backup_20261116.scout_sessions except select team_id, id, category, athlete_id, goals, assists, shots, shots_on_target, accurate_passes, wrong_passes, tackles, interceptions, minutes_played, match_id, deleted_at from public.scout_sessions) x)
       + (select count(*) from (select team_id, id, category, positions, dominant_foot, deleted_at from backup_20261116.athletes except select team_id, id, category, positions, dominant_foot, deleted_at from public.athletes) x)
    into n;
  if n <> 0 then raise exception 'FALHA reconciliação: % linha(s) do backup diferem do banco atual', n; end if;
  ok := ok || 'reconciliacao ';

  raise exception 'FASE2 OK (rollback): %', ok;
end $$;
