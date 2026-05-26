-- Season + shop inventory MVP.
-- Run this in Supabase SQL Editor before using Featured items and season rewards.

create table if not exists player_items (
  wallet text not null,
  item_slug text not null,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (wallet, item_slug),
  constraint player_items_nonnegative check (quantity >= 0)
);

create index if not exists idx_player_items_wallet
  on player_items(wallet);

create table if not exists player_boosters (
  wallet text not null,
  booster_slug text not null,
  active_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (wallet, booster_slug)
);

create index if not exists idx_player_boosters_active
  on player_boosters(wallet, booster_slug, active_until);

create table if not exists season_progress (
  wallet text not null,
  season_key text not null,
  xp integer not null default 0,
  claimed_levels integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (wallet, season_key),
  constraint season_progress_nonnegative check (xp >= 0)
);

create index if not exists idx_season_progress_wallet
  on season_progress(wallet);

create table if not exists user_quest_rerolls (
  wallet text not null,
  week_key text not null,
  old_quest_id integer not null,
  new_quest_id integer not null,
  updated_at timestamptz not null default now(),
  primary key (wallet, week_key, old_quest_id)
);

create index if not exists idx_user_quest_rerolls_wallet_week
  on user_quest_rerolls(wallet, week_key);

-- One points purchase of Quest Reroll per wallet per ISO week.
-- Paid repeats are recorded separately after an on-chain USDC transfer.
create table if not exists shop_weekly_point_purchases (
  wallet text not null,
  week_key text not null,
  item_slug text not null,
  created_at timestamptz not null default now(),
  primary key (wallet, week_key, item_slug)
);

create index if not exists idx_shop_weekly_point_purchases_wallet_week
  on shop_weekly_point_purchases(wallet, week_key);

create table if not exists shop_usdc_purchases (
  tx_hash text primary key,
  wallet text not null,
  item_slug text not null,
  amount_usdc_micro bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_shop_usdc_purchases_wallet_item
  on shop_usdc_purchases(wallet, item_slug, created_at);

alter table shop_usdc_purchases
  add column if not exists granted_at timestamptz;

create or replace function record_paid_quest_reroll(
  p_wallet text,
  p_tx_hash text,
  p_amount_usdc_micro bigint,
  p_quantity integer default 1
) returns boolean
language plpgsql
security definer
as $$
declare
  did_grant boolean := false;
  grant_quantity integer := greatest(1, least(99, coalesce(p_quantity, 1)));
begin
  p_wallet := lower(p_wallet);
  p_tx_hash := lower(p_tx_hash);

  insert into shop_usdc_purchases (
    wallet,
    tx_hash,
    item_slug,
    amount_usdc_micro,
    granted_at
  ) values (
    p_wallet,
    p_tx_hash,
    'quest_reroll',
    p_amount_usdc_micro,
    now()
  )
  on conflict (tx_hash) do update
    set granted_at = coalesce(shop_usdc_purchases.granted_at, excluded.granted_at)
    where shop_usdc_purchases.granted_at is null
  returning true into did_grant;

  if coalesce(did_grant, false) then
    insert into player_items (wallet, item_slug, quantity, updated_at)
    values (p_wallet, 'quest_reroll', grant_quantity, now())
    on conflict (wallet, item_slug) do update
      set quantity = player_items.quantity + grant_quantity,
          updated_at = now();
  end if;

  return coalesce(did_grant, false);
end;
$$;

-- Force PostgREST/Supabase API to see newly created tables immediately.
select pg_notify('pgrst', 'reload schema');
