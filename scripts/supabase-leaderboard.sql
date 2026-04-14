-- Onchain leaderboard table
create table onchain_stats (
  wallet text primary key,
  games_played smallint not null default 0,
  wins smallint not null default 0,
  total_shots smallint not null default 0,
  total_hits smallint not null default 0,
  updated_at timestamptz not null default now()
);

create index idx_onchain_stats_rating on onchain_stats(wins, games_played);

alter publication supabase_realtime add table onchain_stats;
