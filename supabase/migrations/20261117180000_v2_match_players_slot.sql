-- Escalação em campo: posição escolhida (formação + lugar, ex.: '433.ZAG1') na relação do jogo.
-- Aplicada em produção como `v2_match_players_slot`. Coluna anulável, aditiva.
alter table public.match_players add column slot text;
