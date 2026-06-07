-- Async Sea Battle challenge mode.
-- Run in Supabase SQL Editor before enabling /challenge in production.

create extension if not exists pgcrypto;

-- Keep the stats/history table compatible on projects that skipped older migrations.
alter table games add column if not exists game_mode text default 'free';
alter table games add column if not exists onchain_game_id bigint;
alter table games add column if not exists wager_amount bigint default 0;

create table if not exists challenge_games (
  id uuid primary key default gen_random_uuid(),
  stats_game_id bigint references games(id) on delete set null,
  onchain_challenge_id bigint not null unique,
  creator text not null check (creator ~ '^0x[a-f0-9]{40}$'),
  challenger text check (challenger is null or challenger ~ '^0x[a-f0-9]{40}$'),
  creator_amount bigint not null check (creator_amount > 0),
  entry_fee bigint not null check (entry_fee > 0),
  max_moves smallint not null check (max_moves between 1 and 25),
  board_commitment text not null check (board_commitment ~ '^0x[a-fA-F0-9]{64}$'),
  status text not null default 'open' check (
    status in ('open', 'joined', 'cashed_out', 'challenger_won', 'creator_won', 'settled', 'cancelled')
  ),
  winner text check (winner is null or winner ~ '^0x[a-f0-9]{40}$'),
  moves_used smallint not null default 0 check (moves_used between 0 and 25),
  hits smallint not null default 0 check (hits between 0 and 8),
  creator_payout bigint not null default 0 check (creator_payout >= 0),
  challenger_payout bigint not null default 0 check (challenger_payout >= 0),
  drop_fee bigint not null default 0 check (drop_fee >= 0),
  cashout_bps smallint not null default 0 check (cashout_bps between 0 and 10000),
  points_awarded boolean not null default false,
  settled_tx_hash text,
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  finished_at timestamptz,
  settled_at timestamptz
);

create table if not exists challenge_boards (
  challenge_id uuid primary key references challenge_games(id) on delete cascade,
  board jsonb not null check (jsonb_typeof(board) = 'array' and jsonb_array_length(board) = 25),
  salt text not null check (length(salt) between 12 and 160),
  created_at timestamptz not null default now()
);

create table if not exists challenge_shots (
  id bigserial primary key,
  challenge_id uuid not null references challenge_games(id) on delete cascade,
  x smallint not null check (x between 0 and 9),
  y smallint not null check (y between 0 and 9),
  is_hit boolean not null,
  created_at timestamptz not null default now(),
  unique (challenge_id, x, y)
);

create index if not exists idx_challenge_games_status_created
  on challenge_games(status, created_at desc);
create index if not exists idx_challenge_games_creator
  on challenge_games(creator, created_at desc);
create index if not exists idx_challenge_games_challenger
  on challenge_games(challenger, created_at desc);
create index if not exists idx_challenge_shots_challenge
  on challenge_shots(challenge_id, created_at);

alter table challenge_games enable row level security;
alter table challenge_boards enable row level security;
alter table challenge_shots enable row level security;

-- No public policies: challenge boards stay private.
-- The Next.js API uses SUPABASE_SERVICE_ROLE_KEY and returns sanitized data.
