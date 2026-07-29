-- Short referral codes with stable aliases and one primary code per wallet.
-- Run once in Supabase SQL Editor before using the admin short-code controls.

begin;

create table if not exists public.referral_codes (
  code text primary key,
  wallet text not null,
  is_primary boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_codes_code_format check (
    code = lower(trim(code))
    and code ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
  ),
  constraint referral_codes_wallet_format check (
    wallet = lower(trim(wallet))
    and wallet ~ '^0x[a-f0-9]{40}$'
  ),
  constraint referral_codes_created_by_format check (
    created_by is null
    or (
      created_by = lower(trim(created_by))
      and created_by ~ '^0x[a-f0-9]{40}$'
    )
  )
);

create unique index if not exists referral_codes_one_primary_per_wallet
  on public.referral_codes (wallet)
  where is_primary;

create index if not exists referral_codes_wallet_idx
  on public.referral_codes (wallet);

alter table public.referral_codes enable row level security;
revoke all on table public.referral_codes from public, anon, authenticated;
grant all on table public.referral_codes to service_role;

-- Referral creation now goes through the signature-verified server route only.
drop policy if exists insert_referrals on public.referrals;
revoke insert, update, delete on table public.referrals from public, anon, authenticated;
grant select, insert, update, delete on table public.referrals to service_role;

-- Clean and deduplicate legacy rows before adding case-insensitive guarantees.
delete from public.referrals
where lower(trim(referrer)) !~ '^0x[a-f0-9]{40}$'
   or lower(trim(referee)) !~ '^0x[a-f0-9]{40}$'
   or lower(trim(referrer)) = lower(trim(referee));

delete from public.referrals duplicate
using public.referrals keeper
where lower(trim(duplicate.referee)) = lower(trim(keeper.referee))
  and duplicate.id > keeper.id;

update public.referrals
set referrer = lower(trim(referrer)),
    referee = lower(trim(referee))
where referrer is distinct from lower(trim(referrer))
   or referee is distinct from lower(trim(referee));

create unique index if not exists referrals_referee_lower_unique
  on public.referrals (lower(referee));

create index if not exists referrals_referrer_lower_idx
  on public.referrals (lower(referrer));

alter table public.referrals
  drop constraint if exists referrals_referrer_wallet_format,
  drop constraint if exists referrals_referee_wallet_format;

alter table public.referrals
  add constraint referrals_referrer_wallet_format check (
    referrer = lower(trim(referrer))
    and referrer ~ '^0x[a-f0-9]{40}$'
  ),
  add constraint referrals_referee_wallet_format check (
    referee = lower(trim(referee))
    and referee ~ '^0x[a-f0-9]{40}$'
  );

create or replace function public.set_primary_referral_code(
  p_wallet text,
  p_code text,
  p_created_by text default null
) returns table (
  code text,
  wallet text,
  is_primary boolean,
  created_by text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_wallet text := lower(trim(coalesce(p_wallet, '')));
  v_code text := lower(trim(coalesce(p_code, '')));
  v_created_by text := nullif(lower(trim(coalesce(p_created_by, ''))), '');
begin
  if v_wallet !~ '^0x[a-f0-9]{40}$' then
    raise exception 'Invalid referral wallet' using errcode = '22023';
  end if;

  if v_code !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    raise exception 'Invalid referral code' using errcode = '22023';
  end if;

  if v_created_by is not null and v_created_by !~ '^0x[a-f0-9]{40}$' then
    raise exception 'Invalid admin wallet' using errcode = '22023';
  end if;

  -- Serialize changes for the same wallet. A code collision for different
  -- wallets is still protected by the primary key and rolls back atomically.
  perform pg_advisory_xact_lock(hashtextextended(v_wallet, 0));

  if exists (
    select 1
    from public.referral_codes existing
    where existing.code = v_code
      and existing.wallet <> v_wallet
  ) then
    raise exception 'Referral code is already assigned' using errcode = '23505';
  end if;

  update public.referral_codes existing
  set is_primary = false,
      updated_at = now()
  where existing.wallet = v_wallet
    and existing.is_primary
    and existing.code <> v_code;

  insert into public.referral_codes as existing (
    code,
    wallet,
    is_primary,
    created_by,
    created_at,
    updated_at
  ) values (
    v_code,
    v_wallet,
    true,
    v_created_by,
    now(),
    now()
  )
  on conflict on constraint referral_codes_pkey do update
  set is_primary = true,
      created_by = coalesce(excluded.created_by, existing.created_by),
      updated_at = now()
  where existing.wallet = excluded.wallet;

  if not found then
    raise exception 'Referral code is already assigned' using errcode = '23505';
  end if;

  return query
  select
    result.code,
    result.wallet,
    result.is_primary,
    result.created_by,
    result.created_at,
    result.updated_at
  from public.referral_codes result
  where result.code = v_code;
end;
$$;

revoke all on function public.set_primary_referral_code(text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_primary_referral_code(text, text, text)
  to service_role;

-- Each completed game/challenge can award the 10% bonus at most once. The
-- ledger insert and player_stats increment happen in one database transaction.
create table if not exists public.referral_reward_events (
  source_key text primary key,
  referrer text not null,
  referee text not null,
  earned_points integer not null,
  bonus_points integer not null,
  created_at timestamptz not null default now(),
  constraint referral_reward_events_source_key_format check (
    char_length(source_key) between 1 and 160
    and source_key = lower(trim(source_key))
    and source_key ~ '^[a-z0-9:_-]+$'
  ),
  constraint referral_reward_events_referrer_format check (
    referrer = lower(trim(referrer))
    and referrer ~ '^0x[a-f0-9]{40}$'
  ),
  constraint referral_reward_events_referee_format check (
    referee = lower(trim(referee))
    and referee ~ '^0x[a-f0-9]{40}$'
  ),
  constraint referral_reward_events_points_check check (
    earned_points >= 10
    and bonus_points = earned_points / 10
    and bonus_points > 0
  )
);

create index if not exists referral_reward_events_referrer_idx
  on public.referral_reward_events (referrer, created_at desc);

create index if not exists referral_reward_events_referee_idx
  on public.referral_reward_events (referee, created_at desc);

alter table public.referral_reward_events enable row level security;
revoke all on table public.referral_reward_events from public, anon, authenticated;
grant all on table public.referral_reward_events to service_role;

create or replace function public.award_referral_game_points(
  p_referee text,
  p_earned_points integer,
  p_source_key text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referee text := lower(trim(coalesce(p_referee, '')));
  v_source_key text := lower(trim(coalesce(p_source_key, '')));
  v_referrer text;
  v_bonus integer;
  v_inserted integer;
begin
  if v_referee !~ '^0x[a-f0-9]{40}$' then
    raise exception 'Invalid referral referee' using errcode = '22023';
  end if;

  if p_earned_points is null or p_earned_points < 10 then
    return 0;
  end if;

  if char_length(v_source_key) < 1
     or char_length(v_source_key) > 160
     or v_source_key !~ '^[a-z0-9:_-]+$' then
    raise exception 'Invalid referral reward source key' using errcode = '22023';
  end if;

  select lower(referral.referrer)
  into v_referrer
  from public.referrals referral
  where lower(referral.referee) = v_referee
  limit 1;

  if v_referrer is null or v_referrer = v_referee then
    return 0;
  end if;

  v_bonus := p_earned_points / 10;

  insert into public.referral_reward_events (
    source_key,
    referrer,
    referee,
    earned_points,
    bonus_points
  ) values (
    v_source_key,
    v_referrer,
    v_referee,
    p_earned_points,
    v_bonus
  )
  on conflict (source_key) do nothing
  returning 1 into v_inserted;

  if v_inserted is null then
    return 0;
  end if;

  insert into public.player_stats as stats (
    wallet,
    points,
    updated_at
  ) values (
    v_referrer,
    v_bonus,
    now()
  )
  on conflict (wallet) do update
  set points = coalesce(stats.points, 0) + excluded.points,
      updated_at = now();

  return v_bonus;
end;
$$;

revoke all on function public.award_referral_game_points(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.award_referral_game_points(text, integer, text)
  to service_role;

commit;

select pg_notify('pgrst', 'reload schema');
