-- SeaBattleV2 migration: add game_mode and onchain_game_id to games table
-- Run this in Supabase SQL Editor

-- Add game mode column (free, hybrid, wager)
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_mode TEXT DEFAULT 'free';

-- Add onchain game ID reference (for hybrid/wager/bot modes)
ALTER TABLE games ADD COLUMN IF NOT EXISTS onchain_game_id BIGINT;

-- Add wager amount tracking (in USDC micro-units, 6 decimals)
ALTER TABLE games ADD COLUMN IF NOT EXISTS wager_amount BIGINT DEFAULT 0;
