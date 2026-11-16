-- ScoutHouse v2 · D-M · o sistema não inventa finalização
-- Antes: ao gerar a sessão do jogo, gol sem "no gol" virava "no gol", e "no gol" sem "finalização" virava finalização,
-- só para caber nestes dois CHECKs. Esse número inventado ia para a temporada do atleta e para o relatório da família.
-- Agora: a sessão do jogo grava o que foi registrado; a inconsistência é mostrada na revisão pós-jogo.
-- Os CHECKs do treino de finalização (outro formulário, digitado) continuam.

alter table public.scout_sessions drop constraint game_on_target_le_shots;
alter table public.scout_sessions drop constraint game_goals_le_on_target;

-- corrige as sessões geradas de jogo que têm exatamente o padrão do ajuste antigo e nunca foram editadas
with ev as (
  select match_id, athlete_id,
    count(*) filter (where kind = 'goal') g, count(*) filter (where kind = 'shot_on_target') sot, count(*) filter (where kind = 'shot') sh
  from public.match_events where deleted_at is null and athlete_id is not null group by 1, 2
)
update public.scout_sessions s
set shots = coalesce(e.sh, 0), shots_on_target = coalesce(e.sot, 0), updated_at = now()
from public.scout_sessions s0
left join ev e on e.match_id = s0.match_id and e.athlete_id = s0.athlete_id
where s.team_id = s0.team_id and s.id = s0.id
  and s0.match_id is not null and s0.deleted_at is null and s0.updated_at = s0.created_at
  and s0.goals = coalesce(e.g, 0)
  and (s0.shots <> coalesce(e.sh, 0) or s0.shots_on_target <> coalesce(e.sot, 0))
  and s0.shots_on_target = greatest(coalesce(e.g, 0), coalesce(e.sot, 0))
  and s0.shots = greatest(coalesce(e.g, 0), coalesce(e.sot, 0), coalesce(e.sh, 0));
