-- Social share rewards
-- Run this in Supabase SQL Editor before enabling the share buttons in production.

create table if not exists social_share_rewards (
  id bigserial primary key,
  wallet text not null,
  reward_kind text not null,
  reward_key text not null unique,
  game_id bigint references games(id) on delete set null,
  game_mode text,
  points integer not null check (points > 0),
  share_text text,
  tweet_url text,
  created_at timestamptz not null default now(),
  constraint social_share_rewards_kind check (reward_kind in ('profile', 'game'))
);

create index if not exists idx_social_share_rewards_wallet_created
  on social_share_rewards(wallet, created_at desc);

create index if not exists idx_social_share_rewards_kind_wallet
  on social_share_rewards(reward_kind, wallet, created_at desc);
