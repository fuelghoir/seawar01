-- Sea Battle offchain tables

-- Games table
create table games (
  id bigserial primary key,
  player1 text not null,
  player2 text,
  state smallint not null default 0, -- 0=Created, 1=PlacingShips, 2=Active, 3=Finished
  current_turn smallint not null default 1,
  turn_phase smallint not null default 0, -- 0=Shooting, 1=WaitingReport
  player1_hits smallint not null default 0,
  player2_hits smallint not null default 0,
  player1_board_hash text,
  player2_board_hash text,
  last_shot_x smallint,
  last_shot_y smallint,
  last_shooter text,
  winner text,
  is_private boolean not null default false,
  created_at timestamptz not null default now()
);

-- Shots table
create table shots (
  id bigserial primary key,
  game_id bigint not null references games(id),
  player_num smallint not null, -- 1 or 2 (who fired)
  x smallint not null,
  y smallint not null,
  is_hit boolean,
  created_at timestamptz not null default now()
);

-- Index for fast game lookups
create index idx_shots_game on shots(game_id);
create index idx_games_state on games(state);

-- Enable realtime for both tables
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table shots;
