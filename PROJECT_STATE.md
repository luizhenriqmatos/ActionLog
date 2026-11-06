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
- Backend: não utilizado nesta etapa; o produto segue local-first.
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
