-- Player stats table (replaces onchain_stats)
-- Run this in Supabase SQL Editor

DROP TABLE IF EXISTS onchain_stats;

CREATE TABLE IF NOT EXISTS player_stats (
  wallet text PRIMARY KEY,
  points integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  total_hits integer NOT NULL DEFAULT 0,
  games_played integer NOT NULL DEFAULT 0,
  checkin_streak integer NOT NULL DEFAULT 0,
  last_checkin date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_stats_points ON player_stats(points DESC);

-- Sunk ship reports (for displaying killed ships on attacker board)
CREATE TABLE IF NOT EXISTS sunk_reports (
  id serial PRIMARY KEY,
  game_key text NOT NULL,
  ship_cells jsonb NOT NULL,
  killed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sunk_reports_game ON sunk_reports(game_key);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE player_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE sunk_reports;
