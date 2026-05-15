-- Referral tracking table.
-- Run this in Supabase SQL Editor before enabling referral rewards.

create table if not exists referrals (
  id bigserial primary key,
  referrer text not null,
  referee text not null unique,
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (lower(referrer) <> lower(referee))
);

create index if not exists idx_referrals_referrer
  on referrals(referrer);

create index if not exists idx_referrals_referee
  on referrals(referee);
