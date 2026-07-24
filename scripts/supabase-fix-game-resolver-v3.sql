-- =========================================================================
-- FIX BATTLE PASS vs USDC SEASON SEPARATION & AUTOMATIC XP/POINTS AWARDING
-- =========================================================================

-- 1. Modify resolve_offchain_game_stats to award XP to BP (bp_season_key) and Points to USDC Leaderboard (season_key)
CREATE OR REPLACE FUNCTION resolve_offchain_game_stats(
  p_game_id bigint,
  p_player text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game record;
  v_player text := lower(trim(p_player));
  v_winner text;
  v_player1_hits integer := 0;
  v_player2_hits integer := 0;
  v_player_hits integer := 0;
  v_wallet text;
  v_won boolean;
  v_raw_points integer;
  v_points integer;
  v_multiplier integer;
  v_players jsonb := '[]'::jsonb;
  v_bot_wallet constant text := '0x0000000000000000000000000000000000000001';
  v_bp_season_key text;
  v_season_key text;
BEGIN
  IF v_player !~ '^0x[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'Invalid wallet address';
  END IF;

  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF v_game IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game.state <> 3 OR v_game.winner IS NULL THEN
    RAISE EXCEPTION 'Game is not finished';
  END IF;

  IF coalesce(v_game.game_mode, 'friend') = 'challenge' THEN
    RAISE EXCEPTION 'Challenge stats are resolved by challenge APIs';
  END IF;

  IF v_player <> lower(v_game.player1) AND v_player <> lower(coalesce(v_game.player2, '')) THEN
    RAISE EXCEPTION 'Not a player in this game';
  END IF;

  IF EXISTS (SELECT 1 FROM resolved_games WHERE game_id = p_game_id) THEN
    RETURN json_build_object('alreadyResolved', true, 'players', json_build_array());
  END IF;

  v_winner := lower(v_game.winner);
  IF v_winner <> lower(v_game.player1) AND v_winner <> lower(coalesce(v_game.player2, '')) THEN
    RAISE EXCEPTION 'Winner is not a game player';
  END IF;

  SELECT greatest(
    coalesce(v_game.player1_hits, 0),
    coalesce(count(*) FILTER (WHERE player_num = 1 AND is_hit = true), 0)
  )::integer,
  greatest(
    coalesce(v_game.player2_hits, 0),
    coalesce(count(*) FILTER (WHERE player_num = 2 AND is_hit = true), 0)
  )::integer
    INTO v_player1_hits, v_player2_hits
    FROM shots
    WHERE game_id = p_game_id;

  IF (v_winner = lower(v_game.player1) AND v_player1_hits < 20)
    OR (v_winner = lower(coalesce(v_game.player2, '')) AND v_player2_hits < 20) THEN
    RAISE EXCEPTION 'Winner does not have enough hits';
  END IF;

  INSERT INTO resolved_games (game_id) VALUES (p_game_id);

  SELECT coalesce(season_key, 'S2'), coalesce(bp_season_key, 'S1') 
    INTO v_season_key, v_bp_season_key 
    FROM season_config 
    WHERE id = 'default';

  IF v_season_key IS NULL THEN v_season_key := 'S2'; END IF;
  IF v_bp_season_key IS NULL THEN v_bp_season_key := 'S1'; END IF;

  FOR v_wallet, v_player_hits IN
    SELECT lower(v_game.player1), v_player1_hits
    UNION ALL
    SELECT lower(v_game.player2), v_player2_hits
  LOOP
    IF v_wallet IS NULL OR v_wallet = '' OR v_wallet = v_bot_wallet THEN
      CONTINUE;
    END IF;

    v_won := v_wallet = v_winner;
    v_raw_points := v_player_hits + CASE WHEN v_won THEN 50 ELSE 0 END;
    
    SELECT CASE
      WHEN EXISTS (
        SELECT 1
        FROM player_boosters
        WHERE wallet = v_wallet
          AND booster_slug = 'double_points'
          AND active_until > now()
      ) THEN 2
      ELSE 1
    END INTO v_multiplier;

    v_points := v_raw_points * v_multiplier;

    INSERT INTO player_stats (wallet, points, games_played, wins, total_hits, updated_at)
    VALUES (v_wallet, v_points, 1, CASE WHEN v_won THEN 1 ELSE 0 END, v_player_hits, now())
    ON CONFLICT (wallet) DO UPDATE
      SET points = player_stats.points + excluded.points,
          games_played = player_stats.games_played + 1,
          wins = player_stats.wins + excluded.wins,
          total_hits = coalesce(player_stats.total_hits, 0) + excluded.total_hits,
          updated_at = now();

    -- 1. Award Battle Pass XP to bp_season_key (S1)
    INSERT INTO season_progress (wallet, season_key, xp, claimed_levels, updated_at)
    VALUES (v_wallet, v_bp_season_key, v_raw_points, '{}'::integer[], now())
    ON CONFLICT (wallet, season_key) DO UPDATE
      SET xp = coalesce(season_progress.xp, 0) + excluded.xp,
          updated_at = now();

    -- 2. Award Leaderboard Points to season_key (S2)
    INSERT INTO season_progress (wallet, season_key, points, updated_at)
    VALUES (v_wallet, v_season_key, v_points, now())
    ON CONFLICT (wallet, season_key) DO UPDATE
      SET points = coalesce(season_progress.points, 0) + excluded.points,
          updated_at = now();

    v_players := v_players || jsonb_build_object(
      'wallet', v_wallet,
      'hits', v_player_hits,
      'won', v_won,
      'points', v_points,
      'xp', v_raw_points
    );
  END LOOP;

  RETURN json_build_object(
    'alreadyResolved', false,
    'gameId', p_game_id,
    'players', v_players
  );
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_offchain_game_stats(bigint, text) TO anon, authenticated;


-- 2. Modify claim_daily_checkin to award XP to BP (bp_season_key) and Points to USDC Leaderboard (season_key)
CREATE OR REPLACE FUNCTION claim_daily_checkin(
  p_wallet text,
  p_is_base_app boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet text := lower(trim(p_wallet));
  v_last_checkin date;
  v_streak integer := 0;
  v_reward integer := 0;
  v_today date := current_date;
  v_used_freeze boolean := false;
  v_freeze_count integer := 0;
  v_bp_season_key text;
  v_season_key text;
BEGIN
  IF v_wallet !~ '^0x[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'Invalid wallet address';
  END IF;

  SELECT coalesce(season_key, 'S2'), coalesce(bp_season_key, 'S1')
    INTO v_season_key, v_bp_season_key
    FROM season_config
    WHERE id = 'default';

  IF v_season_key IS NULL THEN v_season_key := 'S2'; END IF;
  IF v_bp_season_key IS NULL THEN v_bp_season_key := 'S1'; END IF;

  SELECT last_checkin_date, streak_count
    INTO v_last_checkin, v_streak
    FROM player_checkins
    WHERE wallet = v_wallet;

  IF v_last_checkin IS NOT NULL AND v_last_checkin = v_today THEN
    RAISE EXCEPTION 'Already checked in today';
  END IF;

  IF v_last_checkin IS NULL THEN
    v_streak := 1;
  ELSIF v_last_checkin = v_today - 1 THEN
    v_streak := v_streak + 1;
  ELSE
    SELECT coalesce(quantity, 0) INTO v_freeze_count
      FROM player_items
      WHERE wallet = v_wallet AND item_slug = 'streak_freeze';

    IF v_freeze_count > 0 THEN
      UPDATE player_items
        SET quantity = quantity - 1, updated_at = now()
        WHERE wallet = v_wallet AND item_slug = 'streak_freeze';
      v_streak := v_streak + 1;
      v_used_freeze := true;
    ELSE
      v_streak := 1;
    END IF;
  END IF;

  IF v_streak = 1 THEN v_reward := 20;
  ELSIF v_streak = 2 THEN v_reward := 25;
  ELSIF v_streak = 3 THEN v_reward := 30;
  ELSIF v_streak = 4 THEN v_reward := 40;
  ELSIF v_streak = 5 THEN v_reward := 50;
  ELSIF v_streak = 6 THEN v_reward := 60;
  ELSE v_reward := 80;
  END IF;

  IF p_is_base_app THEN
    v_reward := v_reward * 2;
  END IF;

  INSERT INTO player_checkins (wallet, last_checkin_date, streak_count, updated_at)
  VALUES (v_wallet, v_today, v_streak, now())
  ON CONFLICT (wallet) DO UPDATE
    SET last_checkin_date = excluded.last_checkin_date,
        streak_count = excluded.streak_count,
        updated_at = now();

  INSERT INTO player_stats (wallet, points, updated_at)
  VALUES (v_wallet, v_reward, now())
  ON CONFLICT (wallet) DO UPDATE
    SET points = player_stats.points + excluded.points,
        updated_at = now();

  -- 1. Award Battle Pass XP to bp_season_key (S1)
  INSERT INTO season_progress (wallet, season_key, xp, claimed_levels, updated_at)
  VALUES (v_wallet, v_bp_season_key, v_reward, '{}'::integer[], now())
  ON CONFLICT (wallet, season_key) DO UPDATE
    SET xp = coalesce(season_progress.xp, 0) + excluded.xp,
        updated_at = now();

  -- 2. Award Leaderboard Points to season_key (S2)
  INSERT INTO season_progress (wallet, season_key, points, updated_at)
  VALUES (v_wallet, v_season_key, v_reward, now())
  ON CONFLICT (wallet, season_key) DO UPDATE
    SET points = coalesce(season_progress.points, 0) + excluded.points,
        updated_at = now();

  RETURN json_build_object(
    'points', v_reward,
    'xp', v_reward,
    'streak', v_streak,
    'usedFreeze', v_used_freeze
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_daily_checkin(text, boolean) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
