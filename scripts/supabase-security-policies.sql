-- Security Policies and Secure Functions Migration
-- Run this script in the Supabase SQL Editor.

-- =========================================================================
-- 1. Enable Row Level Security (RLS) on Critical Tables
-- =========================================================================

ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunk_reports ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 2. Define RLS Policies for Public Anon Role
-- =========================================================================

-- player_stats: Anyone can read (leaderboard), no one can directly insert/update/delete.
DROP POLICY IF EXISTS select_player_stats ON player_stats;
CREATE POLICY select_player_stats ON player_stats 
  FOR SELECT TO anon, authenticated USING (true);

-- referrals: Anyone can view referrals and insert new referrals. Updates/Deletes are blocked.
DROP POLICY IF EXISTS select_referrals ON referrals;
CREATE POLICY select_referrals ON referrals 
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS insert_referrals ON referrals;
CREATE POLICY insert_referrals ON referrals 
  FOR INSERT TO anon, authenticated WITH CHECK (lower(referrer) <> lower(referee));

-- games: Anyone can create (insert) games and read all games. 
-- Update is allowed so players can commit boards and update state.
DROP POLICY IF EXISTS select_games ON games;
CREATE POLICY select_games ON games 
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS insert_games ON games;
CREATE POLICY insert_games ON games 
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS update_games ON games;
CREATE POLICY update_games ON games 
  FOR UPDATE TO anon, authenticated USING (true);

-- shots: Anyone can view shots, insert shots, and update shots (critical for Friend PvP pings).
DROP POLICY IF EXISTS select_shots ON shots;
CREATE POLICY select_shots ON shots 
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS insert_shots ON shots;
CREATE POLICY insert_shots ON shots 
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS update_shots ON shots;
CREATE POLICY update_shots ON shots 
  FOR UPDATE TO anon, authenticated USING (true);

-- sunk_reports: Anyone can read and insert sunk ship reports.
DROP POLICY IF EXISTS select_sunk_reports ON sunk_reports;
CREATE POLICY select_sunk_reports ON sunk_reports 
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS insert_sunk_reports ON sunk_reports;
CREATE POLICY insert_sunk_reports ON sunk_reports 
  FOR INSERT TO anon, authenticated WITH CHECK (true);


-- =========================================================================
-- 3. Create resolved_games table to prevent double-spending points
-- =========================================================================

CREATE TABLE IF NOT EXISTS resolved_games (
  game_id bigint PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- 4. Create secure claim_daily_checkin function (SECURITY DEFINER)
-- =========================================================================

CREATE OR REPLACE FUNCTION claim_daily_checkin(
  p_wallet text
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
BEGIN
  -- Validate wallet format
  IF v_wallet !~ '^0x[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'Invalid wallet address';
  END IF;

  SELECT * INTO v_stats FROM player_stats WHERE wallet = v_wallet;

  -- 1. If player stats do not exist, create profile and award initial reward
  IF v_stats IS NULL THEN
    v_streak := 1;
    v_reward := 5; -- getCheckinReward(1) = ceil(1/5)*5 = 5
    
    INSERT INTO player_stats (wallet, points, checkin_streak, last_checkin, total_checkins, updated_at)
    VALUES (v_wallet, v_reward, v_streak, v_today, 1, now());
    
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

  v_reward := ceil(v_streak::numeric / 5.0) * 5;

  -- 4. Update stats atomically
  UPDATE player_stats
    SET points = points + v_reward,
        checkin_streak = v_streak,
        last_checkin = v_today,
        total_checkins = coalesce(total_checkins, 0) + 1,
        updated_at = now()
    WHERE wallet = v_wallet;

  RETURN json_build_object('points', v_reward, 'streak', v_streak, 'usedFreeze', v_used_freeze);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_daily_checkin(text) TO anon, authenticated;


-- =========================================================================
-- 5. Create secure resolve_offchain_game_stats function (SECURITY DEFINER)
-- =========================================================================

CREATE OR REPLACE FUNCTION resolve_offchain_game_stats(
  p_game_id bigint,
  p_player text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id bigint := p_game_id;
  v_player text := lower(trim(p_player));
  v_game record;
  v_is_player1 boolean;
  v_player_num smallint;
  v_hits integer := 0;
  v_points_to_award integer := 0;
  v_won boolean;
  v_stats_exist boolean;
BEGIN
  -- Prevent double claim on the same game
  IF EXISTS (SELECT 1 FROM resolved_games WHERE game_id = v_game_id) THEN
    RAISE EXCEPTION 'Game points already resolved';
  END IF;

  SELECT * INTO v_game FROM games WHERE id = v_game_id;
  IF v_game IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game.state <> 3 THEN
    RAISE EXCEPTION 'Game is not finished';
  END IF;

  v_is_player1 := (v_game.player1 = v_player);
  IF NOT v_is_player1 AND coalesce(v_game.player2, '') <> v_player THEN
    RAISE EXCEPTION 'Not a player in this game';
  END IF;

  v_player_num := CASE WHEN v_is_player1 THEN 1 ELSE 2 END;
  v_won := (coalesce(v_game.winner, '') = v_player);

  -- Count actual verified hits in the shots table for this player
  SELECT count(*)::integer INTO v_hits
    FROM shots
    WHERE game_id = v_game_id
      AND player_num = v_player_num
      AND is_hit = true;

  -- Validate wins: if marked as winner, must have at least 20 hits
  IF v_won AND v_hits < 20 THEN
    RAISE EXCEPTION 'Invalid win: player has only % hits, needs 20', v_hits;
  END IF;

  -- Calculate points: +1 per hit, +50 for win
  v_points_to_award := v_hits + (CASE WHEN v_won THEN 50 ELSE 0 END);

  -- Insert/Update player_stats atomically
  SELECT exists(SELECT 1 FROM player_stats WHERE wallet = v_player) INTO v_stats_exist;

  IF v_stats_exist THEN
    UPDATE player_stats
      SET points = points + v_points_to_award,
          games_played = games_played + 1,
          wins = wins + (CASE WHEN v_won THEN 1 ELSE 0 END),
          total_hits = coalesce(total_hits, 0) + v_hits,
          updated_at = now()
      WHERE wallet = v_player;
  ELSE
    INSERT INTO player_stats (wallet, points, games_played, wins, total_hits, updated_at)
    VALUES (v_player, v_points_to_award, 1, CASE WHEN v_won THEN 1 ELSE 0 END, v_hits, now());
  END IF;

  -- Record that this game is resolved
  INSERT INTO resolved_games (game_id) VALUES (v_game_id);

  RETURN json_build_object(
    'pointsAwarded', v_points_to_award,
    'hits', v_hits,
    'won', v_won
  );
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_offchain_game_stats(bigint, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
