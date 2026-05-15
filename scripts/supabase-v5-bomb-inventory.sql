-- V5 migration: per-account bomb inventory.
-- Bombs are now an off-chain consumable. The contract tracks total purchased
-- (bombs[player] counter); these columns track which games actually fired one.
-- "Available bombs" for a player =
--   contract.bombs[addr] - count(games where they fired a bomb)

alter table games
  add column if not exists bomb_used_p1 boolean not null default false,
  add column if not exists bomb_used_p2 boolean not null default false;

-- Helpful for the count(games where bomb fired) query in Shop
create index if not exists idx_games_bomb_used_p1
  on games(player1) where bomb_used_p1 = true;

create index if not exists idx_games_bomb_used_p2
  on games(player2) where bomb_used_p2 = true;
