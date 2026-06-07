-- Convert async challenge mode from 10x10 winner-takes-all to quick 5x5 cashout.
-- Run only if scripts/supabase-challenges.sql was already applied before this update.

alter table challenge_games
  drop constraint if exists challenge_games_status_check;

alter table challenge_games
  add constraint challenge_games_status_check check (
    status in ('open', 'joined', 'cashed_out', 'challenger_won', 'creator_won', 'settled', 'cancelled')
  );

alter table challenge_games
  add column if not exists creator_payout bigint not null default 0,
  add column if not exists challenger_payout bigint not null default 0,
  add column if not exists drop_fee bigint not null default 0,
  add column if not exists cashout_bps smallint not null default 0;

alter table challenge_games
  drop constraint if exists challenge_games_max_moves_check,
  drop constraint if exists challenge_games_moves_used_check,
  drop constraint if exists challenge_games_hits_check,
  drop constraint if exists challenge_games_creator_payout_check,
  drop constraint if exists challenge_games_challenger_payout_check,
  drop constraint if exists challenge_games_drop_fee_check,
  drop constraint if exists challenge_games_cashout_bps_check;

alter table challenge_games
  add constraint challenge_games_max_moves_check check (max_moves between 1 and 25),
  add constraint challenge_games_moves_used_check check (moves_used between 0 and 25),
  add constraint challenge_games_hits_check check (hits between 0 and 8),
  add constraint challenge_games_creator_payout_check check (creator_payout >= 0),
  add constraint challenge_games_challenger_payout_check check (challenger_payout >= 0),
  add constraint challenge_games_drop_fee_check check (drop_fee >= 0),
  add constraint challenge_games_cashout_bps_check check (cashout_bps between 0 and 10000);

alter table challenge_boards
  drop constraint if exists challenge_boards_board_check;

alter table challenge_boards
  add constraint challenge_boards_board_check
  check (jsonb_typeof(board) = 'array' and jsonb_array_length(board) = 25);
