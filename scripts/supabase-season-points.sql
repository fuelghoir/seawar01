-- Migration to add spendable points balance to season_progress
-- Run this in the Supabase SQL Editor

-- 1. Alter season_progress table to add points column
ALTER TABLE season_progress 
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;

ALTER TABLE season_progress
  DROP CONSTRAINT IF EXISTS season_progress_points_nonnegative;

ALTER TABLE season_progress
  ADD CONSTRAINT season_progress_points_nonnegative CHECK (points >= 0);

-- Sync trigger function
CREATE OR REPLACE FUNCTION sync_player_stats_points_to_season()
RETURNS TRIGGER AS $$
DECLARE
  v_diff integer;
  v_active_season text;
  v_is_ended boolean;
BEGIN
  -- Get current season config
  SELECT season_key, is_ended INTO v_active_season, v_is_ended FROM season_config WHERE id = 'default';
  
  -- If season is ended, do not accumulate season points
  IF coalesce(v_is_ended, false) = true THEN
    RETURN NEW;
  END IF;

  IF v_active_season IS NULL THEN
    v_active_season := 'S1';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_diff := NEW.points - OLD.points;
    -- Only sync point gains/earnings. Spending (deductions) are managed separately.
    IF v_diff > 0 THEN
      INSERT INTO season_progress (wallet, season_key, xp, claimed_levels, points, updated_at)
      VALUES (NEW.wallet, v_active_season, 0, '{}'::integer[], v_diff, now())
      ON CONFLICT (wallet, season_key)
      DO UPDATE SET 
        points = coalesce(season_progress.points, 0) + v_diff,
        updated_at = now();
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.points > 0 THEN
      INSERT INTO season_progress (wallet, season_key, xp, claimed_levels, points, updated_at)
      VALUES (NEW.wallet, v_active_season, 0, '{}'::integer[], NEW.points, now())
      ON CONFLICT (wallet, season_key)
      DO UPDATE SET 
        points = coalesce(season_progress.points, 0) + NEW.points,
        updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Drop existing trigger if it exists and create new
DROP TRIGGER IF EXISTS trigger_sync_player_stats_points ON player_stats;
CREATE TRIGGER trigger_sync_player_stats_points
AFTER INSERT OR UPDATE ON player_stats
FOR EACH ROW
EXECUTE FUNCTION sync_player_stats_points_to_season();

-- 4. Copy current points balances to S1 season points for existing active players
INSERT INTO season_progress (wallet, season_key, xp, claimed_levels, points, updated_at)
SELECT wallet, 'S1', 0, '{}'::integer[], points, now()
FROM player_stats
WHERE points > 0
ON CONFLICT (wallet, season_key)
DO UPDATE SET 
  points = excluded.points,
  updated_at = now();

-- 5. Create season_config table and insert default row
CREATE TABLE IF NOT EXISTS season_config (
  id text NOT NULL PRIMARY KEY,
  season_key text NOT NULL DEFAULT 'S1',
  end_date timestamptz NOT NULL DEFAULT '2026-07-18 00:00:00+00',
  is_ended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE season_config ADD COLUMN IF NOT EXISTS season_key text NOT NULL DEFAULT 'S1';

INSERT INTO season_config (id, season_key, end_date, is_ended)
VALUES ('default', 'S1', '2026-07-18 00:00:00+00', false)
ON CONFLICT (id) DO UPDATE SET season_key = excluded.season_key;

-- Enable RLS
ALTER TABLE season_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public select season_config" ON season_config;
CREATE POLICY "Public select season_config" ON season_config
  FOR SELECT TO anon, authenticated USING (true);

-- 6. Allow updating shot results in shots table (fixes PvP play-with-friend mode RLS error)
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS update_shots ON shots;
CREATE POLICY update_shots ON shots 
  FOR UPDATE TO anon, authenticated USING (true);

-- 7. Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');


