# TODO - ActionLog

## Implementação Base e Infraestrutura
- [x] Configurar ambiente React/Vite com tipagem robusta (TypeScript)
- [x] Implementar Design System Apple Dark Mode (Canvas Carbon #111111, Cards Absolute Black #000000, 28px radius, Inter)
- [x] Configurar camada de persistência localStorage resiliente com migração de dados do MVP

## Seletor e Navegação Principal
- [x] Criar Seletor de Categoria Inicial (Sub-15, Sub-16, Sub-17, Sub-20)
- [x] Implementar Hub por Categoria com navegação por abas (Elenco, Calendário, Central de Scout)
- [x] Desenvolver estados vazios úteis ("Empty States") para cada aba

## Gestão de Elenco e Calendário
- [x] Tela de Gestão de Elenco: Cadastro/Lista de atletas com nome completo, camisa, posição, idade, altura (cm), peso (kg) e pé dominante
- [x] Calendário semanal/mensal por categoria com classificação MD, MD-1, MD-2, MD-3, MD-4, MD-5, MD-6 e MD-7
- [x] Fluxo de abertura rápida do Scout de Jogo ou Scout de Treino de Finalização a partir de uma data classificada

## Central de Scout
- [x] Painel de Scout de Jogo: seleção de atleta ativo e matriz de ações (passes, desarmes, faltas, etc.)
- [x] Painel de Scout de Treino de Finalização: métricas por perna (dominante/não-dominante) com soma automática
- [x] Implementar zeragem segura e histórico de sessões
- [x] Persistir no histórico a data, a etiqueta Match Day e o compromisso de origem

## Encerramento e Relatórios
- [x] Modal de fechamento com resumo consolidado da sessão
- [x] Exportação de Relatório em PDF
- [x] Função de Copiar para WhatsApp com título `Relatório de [Jogo/Treino] - [Categoria] - [MD-x] (dd/mm)`

## Próxima evolução
- [ ] Validar o calendário MD com uma comissão técnica em uma categoria real
- [ ] Avaliar sincronização multi-dispositivo após validação do fluxo local-first
