-- Sea Battle recruit training v2.
-- Safe to run on a fresh database or over the v1 onboarding table.

create table if not exists player_onboarding (
  wallet text primary key,
  tour_version integer not null default 2,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'grandfathered')),
  stage text not null default 'language',
  language text check (language in ('en', 'ru')),
  started_at timestamptz,
  skipped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_onboarding_wallet_format
    check (wallet ~ '^0x[0-9a-f]{40}$')
);

-- The v1 check constraint contains briefing/deployment/targeting/result/checkin.
-- Drop it before translating active rows to the v2 objective names.
alter table player_onboarding
  drop constraint if exists player_onboarding_stage_check;

alter table player_onboarding
  alter column tour_version set default 2;

update player_onboarding
set
  tour_version = 2,
  stage = case
    when status in ('completed', 'grandfathered') then 'complete'
    when stage = 'language' then 'language'
    when stage = 'briefing' then 'checkin'
    when stage in ('deployment', 'targeting', 'result', 'checkin') then 'loadout'
    else 'language'
  end,
  updated_at = now()
where tour_version < 2
   or stage not in ('language', 'checkin', 'loadout', 'battle', 'debrief', 'complete');

alter table player_onboarding
  add constraint player_onboarding_stage_check
  check (stage in ('language', 'checkin', 'loadout', 'battle', 'debrief', 'complete'));

create index if not exists idx_player_onboarding_status_version
  on player_onboarding(status, tour_version);

alter table player_onboarding enable row level security;
revoke all on table player_onboarding from anon, authenticated;
grant all on table player_onboarding to service_role;

-- Existing players must never be forced through a first-wallet tutorial.
-- Referral rows are intentionally excluded because one can be created during
-- a newcomer's first launch before onboarding is read.
insert into player_onboarding (
  wallet,
  tour_version,
  status,
  stage,
  completed_at,
  updated_at
)
select wallet, 2, 'grandfathered', 'complete', now(), now()
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

-- A legacy wallet may already have received an untouched pending row before
-- this backfill. Only untouched language rows are grandfathered.
update player_onboarding onboarding
set
  tour_version = 2,
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

select pg_notify('pgrst', 'reload schema');
