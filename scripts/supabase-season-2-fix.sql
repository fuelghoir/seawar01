-- Run this script in the Supabase SQL Editor

-- 1. Add bp_season_key to allow Battle Pass to operate on a different season than the main reward pool
ALTER TABLE public.season_config 
ADD COLUMN IF NOT EXISTS bp_season_key text DEFAULT 'S1';

-- 2. Reset points for S2 in season_progress
-- The points were erroneously synced from the global leaderboard due to an auto-heal bug.
UPDATE public.season_progress 
SET points = 0 
WHERE season_key = 'S2';
