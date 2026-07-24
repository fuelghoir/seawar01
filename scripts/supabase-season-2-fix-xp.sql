-- 1. Update the battle pass season to S2
UPDATE season_config SET bp_season_key = 'S2' WHERE id = 'default';

-- 2. Modify claim_daily_checkin to award XP to the battle pass
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
  v_today date := (now() at time zone 'utc')::date;
  v_yesterday date := v_today - 1;
  v_stats record;
  v_streak integer;
  v_reward integer;
  v_freeze_qty integer := 0;
  v_used_freeze boolean := false;
  v_bp_season_key text;
BEGIN
  -- Validate wallet format
  IF v_wallet !~ '^0x[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'Invalid wallet address';
  END IF;

  SELECT coalesce(bp_season_key, 'S2') INTO v_bp_season_key FROM season_config WHERE id = 'default';

  SELECT * INTO v_stats FROM player_stats WHERE wallet = v_wallet;

  -- 1. If player stats do not exist, create profile and award initial reward
  IF v_stats IS NULL THEN
    v_streak := 1;
    IF p_is_base_app THEN
      v_reward := 500;
    ELSE
      v_reward := 5; -- getCheckinReward(1) = ceil(1/5)*5 = 5
    END IF;
    
    INSERT INTO player_stats (wallet, points, checkin_streak, last_checkin, total_checkins, updated_at)
    VALUES (v_wallet, v_reward, v_streak, v_today, 1, now());
    
    INSERT INTO season_progress (wallet, season_key, xp, claimed_levels, updated_at)
    VALUES (v_wallet, v_bp_season_key, v_reward, '{}'::integer[], now())
    ON CONFLICT (wallet, season_key) DO UPDATE
    SET xp = coalesce(season_progress.xp, 0) + excluded.xp, updated_at = now();

    RETURN json_build_object('points', v_reward, 'streak', v_streak, 'usedFreeze', false);
  END IF;

  -- 2. Prevent duplicate check-in today
  IF v_stats.last_checkin = v_today THEN
    RAISE EXCEPTION 'Already checked in today';
  END IF;

  -- 3. Calculate streak
  IF v_stats.last_checkin = v_yesterday THEN
    v_streak := coalesce(v_stats.checkin_streak, 0) + 1;
  ELSIF coalesce(v_stats.checkin_streak, 0) > 0 THEN
    -- Try to consume a streak_freeze item from player_items if they have one
    SELECT quantity INTO v_freeze_qty 
      FROM player_items 
      WHERE wallet = v_wallet AND item_slug = 'streak_freeze';

    IF coalesce(v_freeze_qty, 0) > 0 THEN
      UPDATE player_items 
        SET quantity = v_freeze_qty - 1, updated_at = now()
        WHERE wallet = v_wallet AND item_slug = 'streak_freeze';
      v_used_freeze := true;
      v_streak := coalesce(v_stats.checkin_streak, 0) + 1;
    ELSE
      v_streak := 1;
    END IF;
  ELSE
    v_streak := 1;
  END IF;

  IF p_is_base_app THEN
    -- Starts at 500 points, every 5 days +50 points
    -- Example: day 1-4 = 500, day 5-9 = 550, day 10-14 = 600
    v_reward := 500 + floor((v_streak - 1) / 5) * 50;
  ELSE
    v_reward := ceil(v_streak::numeric / 5.0) * 5;
  END IF;

  -- 4. Update stats atomically
  UPDATE player_stats
    SET points = points + v_reward,
        checkin_streak = v_streak,
        last_checkin = v_today,
        total_checkins = coalesce(total_checkins, 0) + 1,
        updated_at = now()
    WHERE wallet = v_wallet;

  INSERT INTO season_progress (wallet, season_key, xp, claimed_levels, updated_at)
  VALUES (v_wallet, v_bp_season_key, v_reward, '{}'::integer[], now())
  ON CONFLICT (wallet, season_key) DO UPDATE
  SET xp = coalesce(season_progress.xp, 0) + excluded.xp, updated_at = now();

  RETURN json_build_object('points', v_reward, 'streak', v_streak, 'usedFreeze', v_used_freeze);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_daily_checkin(text, boolean) TO anon, authenticated;

-- Reload postgrest
SELECT pg_notify('pgrst', 'reload schema');
