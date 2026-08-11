-- Atomic, idempotent daily check-in claims.
-- Safe standalone migration: no existing rows are deleted or rewritten.
-- Run once in the Supabase SQL Editor before relying on the atomic RPC.

begin;

alter table public.player_stats
  add column if not exists total_checkins integer not null default 0;

create table if not exists public.daily_checkin_claims (
  wallet text not null,
  claim_day date not null,
  points integer not null,
  season_xp integer not null,
  streak integer not null,
  used_freeze boolean not null default false,
  is_base_app boolean not null default false,
  bp_season_key text not null,
  legacy_backfill boolean not null default false,
  claimed_at timestamptz not null default now(),
  primary key (wallet, claim_day),
  constraint daily_checkin_claims_wallet_format
    check (wallet ~ '^0x[0-9a-f]{40}$'),
  constraint daily_checkin_claims_points_nonnegative
    check (points >= 0),
  constraint daily_checkin_claims_xp_nonnegative
    check (season_xp >= 0),
  constraint daily_checkin_claims_streak_nonnegative
    check (streak >= 0)
);

create index if not exists idx_daily_checkin_claims_day
  on public.daily_checkin_claims (claim_day desc);

alter table public.daily_checkin_claims enable row level security;
alter table public.daily_checkin_claims force row level security;
revoke all on table public.daily_checkin_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.daily_checkin_claims to service_role;

create or replace function public.claim_daily_checkin_atomic(
  p_wallet text,
  p_is_base_app boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_wallet text := lower(btrim(coalesce(p_wallet, '')));
  v_now timestamptz := statement_timestamp();
  v_today date := (statement_timestamp() at time zone 'utc')::date;
  v_yesterday date := ((statement_timestamp() at time zone 'utc')::date - 1);
  v_existing public.daily_checkin_claims%rowtype;
  v_last_checkin date;
  v_current_streak integer := 0;
  v_streak integer := 1;
  v_reward integer;
  v_freeze_quantity integer := 0;
  v_used_freeze boolean := false;
  v_bp_season_key text;
  v_checkin_xp constant integer := 20;
begin
  if v_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Invalid wallet address' using errcode = '22023';
  end if;

  -- One transaction per wallet at a time, including the first claim before a
  -- player_stats row exists. Hash collisions only serialize unrelated wallets.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_wallet, 734119025::bigint)
  );

  select *
    into v_existing
    from public.daily_checkin_claims
    where wallet = v_wallet and claim_day = v_today;

  if found then
    return pg_catalog.jsonb_build_object(
      'points', v_existing.points,
      'streak', v_existing.streak,
      'usedFreeze', v_existing.used_freeze,
      'alreadyClaimed', true,
      'claimDay', v_existing.claim_day
    );
  end if;

  select coalesce(bp_season_key, 'S1')
    into v_bp_season_key
    from public.season_config
    where id = 'default';
  v_bp_season_key := coalesce(v_bp_season_key, 'S1');

  insert into public.player_stats (wallet, updated_at)
  values (v_wallet, v_now)
  on conflict (wallet) do nothing;

  select last_checkin, coalesce(checkin_streak, 0)
    into v_last_checkin, v_current_streak
    from public.player_stats
    where wallet = v_wallet
    for update;

  -- A check-in completed earlier today before this ledger was installed is
  -- recorded without another reward. This makes migration-day retries safe.
  if v_last_checkin = v_today then
    insert into public.daily_checkin_claims (
      wallet,
      claim_day,
      points,
      season_xp,
      streak,
      used_freeze,
      is_base_app,
      bp_season_key,
      legacy_backfill,
      claimed_at
    ) values (
      v_wallet,
      v_today,
      0,
      0,
      greatest(0, v_current_streak),
      false,
      coalesce(p_is_base_app, false),
      v_bp_season_key,
      true,
      v_now
    );

    return pg_catalog.jsonb_build_object(
      'points', 0,
      'streak', greatest(0, v_current_streak),
      'usedFreeze', false,
      'alreadyClaimed', true,
      'claimDay', v_today
    );
  end if;

  if v_last_checkin = v_yesterday then
    v_streak := greatest(0, v_current_streak) + 1;
  elsif v_last_checkin is not null and v_current_streak > 0 then
    select quantity
      into v_freeze_quantity
      from public.player_items
      where wallet = v_wallet and item_slug = 'streak_freeze'
      for update;

    if coalesce(v_freeze_quantity, 0) > 0 then
      update public.player_items
        set quantity = quantity - 1,
            updated_at = v_now
        where wallet = v_wallet
          and item_slug = 'streak_freeze';
      v_streak := v_current_streak + 1;
      v_used_freeze := true;
    end if;
  end if;

  if coalesce(p_is_base_app, false) then
    v_reward := 500 + (floor((greatest(1, v_streak) - 1)::numeric / 5) * 50)::integer;
  else
    v_reward := (ceil(greatest(1, v_streak)::numeric / 5) * 5)::integer;
  end if;

  update public.player_stats
    set points = coalesce(points, 0) + v_reward,
        checkin_streak = v_streak,
        last_checkin = v_today,
        total_checkins = coalesce(total_checkins, 0) + 1,
        updated_at = v_now
    where wallet = v_wallet;

  insert into public.season_progress (
    wallet,
    season_key,
    xp,
    claimed_levels,
    updated_at
  ) values (
    v_wallet,
    v_bp_season_key,
    v_checkin_xp,
    '{}'::integer[],
    v_now
  )
  on conflict (wallet, season_key) do update
    set xp = coalesce(season_progress.xp, 0) + excluded.xp,
        updated_at = excluded.updated_at;

  insert into public.daily_checkin_claims (
    wallet,
    claim_day,
    points,
    season_xp,
    streak,
    used_freeze,
    is_base_app,
    bp_season_key,
    legacy_backfill,
    claimed_at
  ) values (
    v_wallet,
    v_today,
    v_reward,
    v_checkin_xp,
    v_streak,
    v_used_freeze,
    coalesce(p_is_base_app, false),
    v_bp_season_key,
    false,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'points', v_reward,
    'streak', v_streak,
    'usedFreeze', v_used_freeze,
    'alreadyClaimed', false,
    'claimDay', v_today
  );
end;
$$;

-- SECURITY DEFINER claims must only be called by the server API.
revoke all on function public.claim_daily_checkin_atomic(text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_daily_checkin_atomic(text, boolean)
  to service_role;

-- Retire direct access to the legacy non-ledger RPC once the atomic function
-- is present. Existing server code can migrate to the explicit atomic name.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.claim_daily_checkin(text,boolean)') is not null then
    execute 'revoke all on function public.claim_daily_checkin(text, boolean) from public, anon, authenticated';
  end if;
  if pg_catalog.to_regprocedure('public.claim_daily_checkin(text)') is not null then
    execute 'revoke all on function public.claim_daily_checkin(text) from public, anon, authenticated';
  end if;
end;
$migration$;

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
