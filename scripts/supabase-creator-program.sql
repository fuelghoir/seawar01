-- Creator Program + signature drop tables.
-- Run this in Supabase SQL Editor after the base game/shop/referral migrations.

create table if not exists creator_submissions (
  id bigserial primary key,
  wallet text not null,
  url text not null,
  status text not null default 'pending',
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_submissions_wallet_format check (wallet ~ '^0x[a-f0-9]{40}$'),
  constraint creator_submissions_status check (status in ('pending', 'approved', 'rejected', 'rewarded'))
);

create index if not exists idx_creator_submissions_wallet
  on creator_submissions(wallet, created_at desc);

create index if not exists idx_creator_submissions_status
  on creator_submissions(status, created_at desc);

create table if not exists creator_rewards (
  id bigserial primary key,
  wallet text not null,
  source_submission_id bigint references creator_submissions(id) on delete set null,
  reward_kind text not null,
  points integer not null default 0,
  item_slug text,
  quantity integer not null default 0,
  token_address text,
  amount_raw text,
  reward_label text,
  tx_hash text,
  status text not null default 'planned',
  admin_note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_rewards_wallet_format check (wallet ~ '^0x[a-f0-9]{40}$'),
  constraint creator_rewards_kind check (reward_kind in ('points', 'item', 'usdc', 'base', 'token', 'note')),
  constraint creator_rewards_status check (status in ('planned', 'granted', 'claimable', 'paid', 'cancelled')),
  constraint creator_rewards_nonnegative_points check (points >= 0),
  constraint creator_rewards_nonnegative_quantity check (quantity >= 0)
);

create index if not exists idx_creator_rewards_wallet
  on creator_rewards(wallet, created_at desc);

create index if not exists idx_creator_rewards_status
  on creator_rewards(status, created_at desc);

create table if not exists wallet_activity (
  id bigserial primary key,
  wallet text not null,
  tx_hash text not null unique,
  chain_id integer not null default 8453,
  contract_address text,
  action text,
  amount_raw text,
  status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  constraint wallet_activity_wallet_format check (wallet ~ '^0x[a-f0-9]{40}$')
);

create index if not exists idx_wallet_activity_wallet
  on wallet_activity(wallet, created_at desc);

create table if not exists drop_campaigns (
  id text primary key,
  title text not null,
  token_address text not null,
  token_symbol text not null default 'TOKEN',
  decimals integer not null default 18,
  total_amount_raw text not null,
  total_points bigint not null default 0,
  contract_address text,
  signer_address text,
  status text not null default 'draft',
  snapshot_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drop_campaigns_status check (status in ('draft', 'active', 'closed', 'cancelled')),
  constraint drop_campaigns_decimals check (decimals >= 0 and decimals <= 36)
);

create index if not exists idx_drop_campaigns_status
  on drop_campaigns(status, created_at desc);

create table if not exists drop_allocations (
  drop_id text not null references drop_campaigns(id) on delete cascade,
  wallet text not null,
  points bigint not null default 0,
  amount_raw text not null,
  claimed_at timestamptz,
  claim_tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (drop_id, wallet),
  constraint drop_allocations_wallet_format check (wallet ~ '^0x[a-f0-9]{40}$'),
  constraint drop_allocations_nonnegative_points check (points >= 0)
);

create index if not exists idx_drop_allocations_wallet
  on drop_allocations(wallet, created_at desc);

create index if not exists idx_drop_allocations_unclaimed
  on drop_allocations(drop_id, claimed_at)
  where claimed_at is null;

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_creator_submissions_touch on creator_submissions;
create trigger trg_creator_submissions_touch
before update on creator_submissions
for each row execute function touch_updated_at();

drop trigger if exists trg_creator_rewards_touch on creator_rewards;
create trigger trg_creator_rewards_touch
before update on creator_rewards
for each row execute function touch_updated_at();

drop trigger if exists trg_drop_campaigns_touch on drop_campaigns;
create trigger trg_drop_campaigns_touch
before update on drop_campaigns
for each row execute function touch_updated_at();

drop trigger if exists trg_drop_allocations_touch on drop_allocations;
create trigger trg_drop_allocations_touch
before update on drop_allocations
for each row execute function touch_updated_at();

-- Force PostgREST/Supabase API to see newly created tables immediately.
select pg_notify('pgrst', 'reload schema');
