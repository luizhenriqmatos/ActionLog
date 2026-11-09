# ActionLog — Project State

## Estado da implementação

A aplicação está na versão 2.2 do hub por categoria (estatísticas de partida completas, indicadores calculados e aba Desempenho), com persistência local em `localStorage` e build estático Vite publicado pelo projeto Webdev. O fluxo base permanece: Seletor de Categoria → Hub da categoria → abas Elenco, Calendário MD e Central de Scout.

## Arquitetura do Calendário Tático

Cada categoria (`Sub-15`, `Sub-16`, `Sub-17`, `Sub-20`) possui um `CategoryData` isolado com:

- `athletes[]`: elenco e perfil físico/tático de cada atleta.
- `events[]`: compromissos do calendário com `date`, `type`, `title`, `opponent`, `location` e `mdTag`.
- `stats[athleteId]`: contadores correntes do Scout de Jogo e do Treino de Finalização; são zerados automaticamente ao fechar uma sessão para evitar acúmulo entre Match Days.
- `sessions[]`: histórico das sessões encerradas, incluindo data, etiqueta de periodização e métricas.

O calendário suporta visualização mensal e semanal. Cada data pode ser classificada com `MD`, `MD-1`, `MD-2`, `MD-3`, `MD-4`, `MD-5`, `MD-6` ou `MD-7`. A etiqueta fica persistida junto do evento da data e aparece no calendário como sinal visual de jogo ou preparação.

O `MD` representa o dia do jogo. As etiquetas regressivas representam dias de preparação anteriores ao jogo. O modelo permite classificar qualquer data, associar um jogo ou treino, nomear o foco da sessão, informar adversário e local e editar ou remover a data.

## Fluxo de navegação Match Day

1. O usuário escolhe uma categoria na tela inicial.
2. No Hub, abre a aba **Calendário MD**.
3. Alterna entre **Mês** e **Semana** e navega até a data desejada.
4. Clica em qualquer data para abrir o painel contextual do dia.
5. Define a etiqueta de periodização, o tipo de sessão, o foco, adversário e local.
6. Após salvar uma data rotulada, usa a abertura rápida para escolher **Iniciar Scout de Jogo** ou **Iniciar Scout de Treino de Finalização**.
7. O Scout recebe o contexto da data (`mdTag`, data e compromisso), mantendo a seleção de atleta e os contadores existentes.
8. Ao finalizar, a sessão é salva em `categories[category].sessions[]` e o relatório exibe o formato `Relatório de Treino - Sub-15 - MD-2 (14/11)` ou equivalente para jogo.

## Cadastro estendido

O perfil de atleta agora registra nome completo, número da camisa, posição de atuação, idade, altura em centímetros, peso em quilogramas e pé dominante. Os campos de altura e peso aparecem no elenco e no contexto do atleta ativo dentro do Scout.

Dados legados do MVP continuam sendo lidos como fallback. Atletas antigos recebem valores vazios para altura e peso, sem bloquear a migração para o novo formato.

## Persistência

A chave principal permanece `actionlog_hub_state_v1`. O estado completo é gravado após cada mutação relevante. A leitura normaliza dados existentes e preserva eventos, estatísticas e sessões já gravados. As chaves legadas `actionlog_state`, `actionlog_data` e `actionlog_roster` continuam disponíveis para migração inicial.

A exportação PDF normaliza os acentos apenas no stream técnico do arquivo para manter compatibilidade com a fonte Helvetica Type1; a versão copiada para WhatsApp mantém o texto original em português. Falhas de clipboard são informadas ao usuário em vez de serem tratadas como sucesso.

## Entrega atual

- Build: `pnpm install --frozen-lockfile && pnpm build`
- Saída: `dist`
- Rotas declaradas: `/` e `/hub`
- Backend: Supabase (projeto `flniuxtlodyumvfennyw`, região São Paulo). O app segue local-first e sincroniza quando o usuário entra.
- Próxima ação recomendada: validar o fluxo MD com uma comissão técnica usando uma categoria real e, depois, avaliar sincronização multi-dispositivo.

## v2.2 · Estatísticas e Desempenho

- Scout de Jogo agora registra gols, assistências, finalizações, finalizações no gol, passes certos, passes errados, desarmes, perdas da posse, faltas cometidas e faltas sofridas. O total de passes é derivado (certos + errados); o antigo contador "Passes" foi removido e o valor de sessões antigas fica em `legacyPasses`, só para consulta.
- Cada card tem `+1` (toque) e `−` (desfazer). Indicadores ao vivo aparecem abaixo dos contadores.
- Validação: finalizações no gol ≤ finalizações e gols ≤ no gol (por perna no treino). Com erro, "Finalizar sessão" fica bloqueado.
- Pé dominante aceita `Ambidestro`. A sessão guarda `dominantFootSnapshot`, então mudar o cadastro não reescreve o histórico. Para ambidestro, as pernas viram direita/esquerda e os indicadores dominante/não dominante não se aplicam.
- A sessão guarda `eventId` e `eventType` do compromisso do calendário. Sessões antigas são vinculadas pela data na migração.
- Aba **Desempenho**: filtros por tipo (partidas/finalização), atleta e período (7/30/90 dias, ano, tudo, personalizado); KPIs com variação em p.p. contra o período anterior de mesmo tamanho; gráfico de evolução com média móvel de 5 datas; dominante × não dominante; ranking; comparação de até 4 atletas; histórico com edição e exclusão; exportação CSV/JSON.
- Regras de cálculo em `src/lib/metrics.ts`: denominador zero = "—"; períodos somam contagens antes de dividir; abaixo de 5 tentativas a taxa recebe aviso de amostra pequena e sai da posição no ranking. Testes: `pnpm test`.
- Migração automática na leitura do `localStorage` (mesma chave `actionlog_hub_state_v1`); nenhum dado é apagado.

## v2.3 · Sincronização com Supabase

- Login por e-mail e senha (botão de sincronização no topo). Sem login, tudo continua só no aparelho, como antes.
- Ao entrar pela primeira vez, o app cria um time (nome = "Nome do time") e envia elenco, calendário e sessões finalizadas que já estavam no aparelho.
- Tabelas: `teams`, `team_members` (papéis admin/treinador/analista/leitura), `athletes`, `calendar_events`, `scout_sessions`; views `v_scout_session_rates` e `v_athlete_totals`. Migrations em `supabase/migrations/`.
- RLS: cada usuário só lê e escreve dados do time de que é membro; papel `leitura` só lê. Funções auxiliares ficam no schema `private` (fora da API).
- Mescla: por registro, vence o `updated_at` mais recente. Exclusões viram `deleted_at` no servidor (tombstone) para sumirem nos outros aparelhos.
- Envio automático 1,5 s depois de cada mudança; busca novidades ao voltar para a aba, ao reconectar e a cada minuto.
- Contadores de uma sessão em andamento não sobem; só a sessão finalizada.
- Pendências: convite de outros membros da comissão para o mesmo time; configurar Site URL e Redirect URLs no painel do Supabase (Authentication → URL Configuration) com o endereço publicado.

## v2.4 · Convites, membros e nova senha

- Admin gera convite com papel (admin, treinador, analista, só leitura); cada convite vale para 1 pessoa por 7 dias. O link `/?convite=CÓDIGO` abre o login já com o convite; o código também pode ser digitado em "Entrar em outro time".
- Painel lista a comissão com e-mail e papel; admin troca papel e remove pessoas. O banco impede que o time fique sem admin.
- Usuário em mais de um time escolhe o time ativo; ao trocar, o aparelho envia o que falta e carrega só os dados do outro time.
- Papel "só leitura": baixa os dados, não envia mudanças.
- "Esqueci minha senha": envia link por e-mail; ao abrir, o app pede a senha nova.
- Correção: `ensure_my_team` (RPC com trava por usuário) impede criar dois times no primeiro login.
- E-mail: o servidor padrão do Supabase envia só 2 e-mails por hora e só para endereços da equipe da organização no Supabase. Para a comissão receber confirmação de cadastro e redefinição de senha, configure SMTP próprio (Authentication → Emails → SMTP Settings).

## v3.0 · Login, perfil com clubes, avaliações, histórico e relatório para os pais

- Fluxo: tela de login → perfil (nome do treinador + clubes) → categorias do clube → hub da categoria.
- Limites internos (não exibidos na interface): até 10 clubes administrados por usuário e até 100 atletas por categoria em cada clube. Validados no app e no banco (triggers).
- Número da camisa é opcional no cadastro.
- Avaliações periódicas: notas de 1 a 5 em 11 critérios (técnico, tático, físico, comportamental), pontos fortes, o que está sendo trabalhado, metas e mensagem para os pais. Sugestão de reavaliação a cada 30 dias, com atletas pendentes destacados. Tabela `athlete_evaluations`.
- Histórico do atleta: média da última avaliação e tendência, área por área contra a avaliação anterior, gráfico da média ao longo do tempo, precisão de passe nos jogos e linha do tempo com avaliações e sessões de scout.
- Relatório para os pais: linguagem simples, notas em estrelas com "evoluiu/manteve/caiu", pontos fortes e metas, números de campo do período e mensagem do treinador. Imprimir/salvar PDF, WhatsApp ou copiar texto.

## v4.0 — novo visual e navegação (2026-11-07)
- Visual grafite com acentos pastel (azul #a9d9f5 ação principal, rosa jogo, verde ok), fonte Plus Jakarta Sans, tokens de cor em `:root`.
- Botões: tamanhos padronizados (48px), primário azul com texto escuro, secundário em superfície, ícones em quadrado arredondado de 44px, efeito de toque e foco visível.
- Navegação: botão "voltar" do celular/navegador fecha janelas e volta níveis (clube › categoria › aba); seletor de categoria no topo mantém a aba atual; dock flutuante no mobile.
- Calendário: seletores de mês e ano (ano atual por padrão; ±5 anos e anos com eventos); células listradas para dias de jogo.
- Deploy: `vercel.json` adicionado (Vite + pnpm, rota SPA). Netlify continua ativo.

## v4.1 · Jogo ao vivo (2026-11-09)
- Novo modo **Jogo ao vivo** aberto pelo compromisso do tipo Jogo na Agenda; vários celulares do mesmo clube entram no mesmo `matches` (único por `team_id + calendar_event_id`).
- Tabelas: `matches` (cronômetro guardado como estado: `phase`, `period`, `clock_running`, `clock_started_at`, `clock_base_seconds`; comando), `match_players` (relação, setor, titular, em campo), `match_events` (um toque = uma linha; id gerado no aparelho; desfazer = `deleted_at`, só o autor). RLS com `private.is_team_member` / `private.can_write_team`. RPC `server_now()` corrige o relógio de cada aparelho.
- `scout_sessions` ganhou `interceptions`, `minutes_played`, `match_id`; views atualizadas; interceptação entra em todo o app.
- Escrita por fila no `localStorage` (`actionlog_match_queue_v1`), enviada na hora e em lote; sem rede, reenvia quando volta, sem duplicar. Leitura do jogo a cada 5 s.
- Observador: chips de setor, todos os atletas em campo do setor de uma vez, um toque por ação, desfazer o próprio último, últimas ações com minuto. Comando: cronômetro, ajuste, substituição, escanteios, gol adversário, assumir comando, finalizar.
- Finalizar gera uma `scout_session` (mode game) por atleta que entrou, com minutos; validações viram aviso (gol conta como no gol e finalização quando faltar).
- Regras puras e testadas em `src/lib/match.ts` (setor sugerido, cronômetro, coletivo, minutagem: titular inteiro, sai no 1ºT, entra no 2ºT, troca no intervalo, sai e volta).
- Simulação com 3 navegadores: cronômetro com diferença ≤ 1 s, substituição vista em ~5 s, fila offline sem duplicar, coletivo = soma dos atletas, sessões em Desempenho.
- Guia da comissão: `docs/guia-jogo-ao-vivo.md`.
- Limite conhecido: quem registra logo após o comando mudar o tempo pode ficar até 5 s com o período anterior.

## v4.2 · Painel do Jogo ao vivo (2026-11-09)
- Todos os atletas em campo empilhados na ordem tática (`byTacticalOrder` em `src/lib/match.ts`): Goleiro → LD → ZAG → LE → VOL → MC → MD → ME → MEI → PD → PE → ATA → sem posição; títulos Goleiro/Defesa/Meio-campo/Ataque. Chips de setor viram filtro (padrão Todos). Reservas num bloco recolhível.
- Cada ação com `− | número | +`; o `−` desfaz o último evento daquela ação/atleta registrado pelo próprio celular (regra do banco: só o autor desfaz; sem migration).
- Faixa fixa no topo com placar, período e cronômetro grande; comando controla ali (iniciar/pausar/retomar, encerrar, ajuste Min/Seg em linha, zerar com confirmação).
- Painel: ações coletivas, substituição em linha, tabela 1ºT/2ºT/Total, histórico de todos os aparelhos (Ocultar), rodapé com Desfazer meu último, Resumo, Copiar relatório, Finalizar partida. Tela ≥ 1024 px em 3 colunas (elenco · atletas + estatísticas · coletivo/substituição/histórico).
- Cadastro: posição principal (lista de 12) + secundária opcional, gravadas em `positions`; edição de atleta existente; aviso de atletas sem posição. Setor da relação vem da posição (`sectorOf`).
- Sem mudança de cores, fontes ou tokens; CSS novo só de layout.
