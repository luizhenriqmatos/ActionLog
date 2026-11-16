-- DOWN do D-M. Só volta os CHECKs se nenhuma sessão os violar; os valores antigos das sessões corrigidas estão em backup_20261116.scout_sessions.
alter table public.scout_sessions add constraint game_on_target_le_shots check (shots_on_target <= shots) not valid;
alter table public.scout_sessions add constraint game_goals_le_on_target check (goals <= shots_on_target) not valid;
