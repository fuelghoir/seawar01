-- First-wallet training progress. Run before deploying the onboarding UI.

create table if not exists player_onboarding (
  wallet text primary key,
  tour_version integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'grandfathered')),
  stage text not null default 'language'
    check (stage in ('language', 'briefing', 'deployment', 'targeting', 'result', 'checkin', 'complete')),
  language text check (language in ('en', 'ru')),
  started_at timestamptz,
  skipped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_onboarding_wallet_format
    check (wallet ~ '^0x[0-9a-f]{40}$')
);

create index if not exists idx_player_onboarding_status_version
  on player_onboarding(status, tour_version);

alter table player_onboarding enable row level security;
revoke all on table player_onboarding from anon, authenticated;
grant all on table player_onboarding to service_role;

-- Existing players must never be forced through a first-time tour after rollout.
-- Referral rows are intentionally excluded: a referral may be written during a
-- newcomer's first load, before their onboarding status is requested.
insert into player_onboarding (
  wallet,
  tour_version,
  status,
  stage,
  completed_at,
  updated_at
)
select wallet, 1, 'grandfathered', 'complete', now(), now()
from (
  select lower(trim(wallet)) as wallet
  from player_stats
  where updated_at < timestamptz '2026-08-10 21:12:36+00'
  union
  select lower(trim(player1)) from games
  where player1 is not null
    and created_at < timestamptz '2026-08-10 21:12:36+00'
  union
  select lower(trim(player2)) from games
  where player2 is not null
    and created_at < timestamptz '2026-08-10 21:12:36+00'
  union
  select lower(trim(wallet)) from season_progress
  where updated_at < timestamptz '2026-08-10 21:12:36+00'
) existing_players
where wallet ~ '^0x[0-9a-f]{40}$'
on conflict (wallet) do nothing;

-- If the UI reached production before this backfill, an untouched pending row
-- may already exist for a legacy wallet. Grandfather only tours that were never
-- started; active newcomers keep their progress.
update player_onboarding onboarding
set
  status = 'grandfathered',
  stage = 'complete',
  completed_at = coalesce(onboarding.completed_at, now()),
  updated_at = now()
where onboarding.status = 'pending'
  and onboarding.stage = 'language'
  and onboarding.started_at is null
  and onboarding.wallet in (
    select wallet
    from (
      select lower(trim(wallet)) as wallet
      from player_stats
      where updated_at < timestamptz '2026-08-10 21:12:36+00'
      union
      select lower(trim(player1)) from games
      where player1 is not null
        and created_at < timestamptz '2026-08-10 21:12:36+00'
      union
      select lower(trim(player2)) from games
      where player2 is not null
        and created_at < timestamptz '2026-08-10 21:12:36+00'
      union
      select lower(trim(wallet)) from season_progress
      where updated_at < timestamptz '2026-08-10 21:12:36+00'
    ) legacy_players
    where wallet ~ '^0x[0-9a-f]{40}$'
  );
