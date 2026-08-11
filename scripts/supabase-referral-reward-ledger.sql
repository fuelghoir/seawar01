-- Idempotent referral reward ledger only.
-- Safe to run on an existing referral installation: this script does not
-- clean, delete, or rewrite referral rows.

begin;

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
alter table public.referral_reward_events force row level security;
revoke all on table public.referral_reward_events from public, anon, authenticated;
grant select, insert, update, delete on table public.referral_reward_events to service_role;

create or replace function public.award_referral_game_points(
  p_referee text,
  p_earned_points integer,
  p_source_key text
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
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
