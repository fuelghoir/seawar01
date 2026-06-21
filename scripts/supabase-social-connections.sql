-- Social account connections for verified quests.
-- Run this in Supabase SQL Editor before enabling X/Telegram verified quests in prod.

create table if not exists social_connections (
  wallet text not null,
  provider text not null,
  provider_user_id text,
  provider_username text,
  base_verify_token text,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (wallet, provider),
  constraint social_connections_wallet_format check (wallet ~ '^0x[0-9a-f]{40}$'),
  constraint social_connections_provider check (provider in ('x', 'telegram'))
);

create unique index if not exists idx_social_connections_base_verify_token
  on social_connections(provider, base_verify_token)
  where base_verify_token is not null;

create unique index if not exists idx_social_connections_provider_user
  on social_connections(provider, provider_user_id)
  where provider_user_id is not null;

create index if not exists idx_social_connections_wallet
  on social_connections(wallet);

create table if not exists social_oauth_states (
  state text primary key,
  wallet text not null,
  provider text not null,
  code_verifier text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint social_oauth_states_wallet_format check (wallet ~ '^0x[0-9a-f]{40}$'),
  constraint social_oauth_states_provider check (provider in ('x'))
);

create index if not exists idx_social_oauth_states_expires
  on social_oauth_states(expires_at);

create table if not exists social_link_codes (
  code text primary key,
  wallet text not null,
  provider text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint social_link_codes_wallet_format check (wallet ~ '^0x[0-9a-f]{40}$'),
  constraint social_link_codes_provider check (provider in ('telegram'))
);

create index if not exists idx_social_link_codes_wallet
  on social_link_codes(wallet, provider);

create index if not exists idx_social_link_codes_expires
  on social_link_codes(expires_at);

select pg_notify('pgrst', 'reload schema');
