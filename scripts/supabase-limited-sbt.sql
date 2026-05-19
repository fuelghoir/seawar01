-- Limited SBT pass.
-- 20 total claims. Wallet must have 100 total wins in player_stats.
-- Holders can claim 10,000 points once per ISO week.

create table if not exists limited_sbt_claims (
  wallet text primary key,
  token_id integer not null unique,
  claimed_at timestamptz not null default now(),
  constraint limited_sbt_token_range check (token_id between 1 and 20)
);

create index if not exists idx_limited_sbt_claims_token_id
  on limited_sbt_claims(token_id);

create table if not exists limited_sbt_weekly_rewards (
  wallet text not null,
  week_key text not null,
  points integer not null default 10000,
  claimed_at timestamptz not null default now(),
  primary key (wallet, week_key),
  constraint limited_sbt_weekly_points_positive check (points > 0)
);

create index if not exists idx_limited_sbt_weekly_rewards_week
  on limited_sbt_weekly_rewards(week_key);

alter table limited_sbt_claims enable row level security;
alter table limited_sbt_weekly_rewards enable row level security;

create or replace function get_limited_sbt_state(
  p_wallet text
) returns table (
  wallet text,
  wins integer,
  token_id integer,
  claimed_at timestamptz,
  claimed_supply integer,
  remaining_supply integer,
  week_key text,
  weekly_claimed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_week_key text := to_char((now() at time zone 'utc'), 'IYYY-"W"IW');
  v_claimed_supply integer := 0;
begin
  select count(*)::integer
    into v_claimed_supply
    from limited_sbt_claims;

  return query
  select
    v_wallet,
    coalesce(ps.wins, 0)::integer,
    claim.token_id,
    claim.claimed_at,
    v_claimed_supply,
    greatest(0, 20 - v_claimed_supply)::integer,
    v_week_key,
    exists (
      select 1
        from limited_sbt_weekly_rewards reward
        where reward.wallet = v_wallet
          and reward.week_key = v_week_key
    )
  from (select 1) seed
  left join player_stats ps
    on ps.wallet = v_wallet
  left join limited_sbt_claims claim
    on claim.wallet = v_wallet;
end;
$$;

create or replace function claim_limited_sbt(
  p_wallet text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_wins integer := 0;
  v_existing_token integer;
  v_token integer;
begin
  select token_id
    into v_existing_token
    from limited_sbt_claims
    where wallet = v_wallet;

  if v_existing_token is not null then
    return v_existing_token;
  end if;

  select coalesce(wins, 0)
    into v_wins
    from player_stats
    where wallet = v_wallet;

  if coalesce(v_wins, 0) < 100 then
    raise exception 'Need 100 wins to claim Limited SBT';
  end if;

  lock table limited_sbt_claims in exclusive mode;

  select token_id
    into v_existing_token
    from limited_sbt_claims
    where wallet = v_wallet;

  if v_existing_token is not null then
    return v_existing_token;
  end if;

  select token
    into v_token
    from generate_series(1, 20) as token
    where not exists (
      select 1
        from limited_sbt_claims
        where token_id = token
    )
    order by token
    limit 1;

  if v_token is null then
    raise exception 'All 20 Limited SBTs have been claimed';
  end if;

  insert into limited_sbt_claims (wallet, token_id)
  values (v_wallet, v_token);

  return v_token;
end;
$$;

create or replace function claim_limited_sbt_weekly_points(
  p_wallet text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_week_key text := to_char((now() at time zone 'utc'), 'IYYY-"W"IW');
  v_points integer := 10000;
  v_inserted boolean := false;
begin
  if not exists (
    select 1
      from limited_sbt_claims
      where wallet = v_wallet
  ) then
    raise exception 'Claim Limited SBT first';
  end if;

  insert into limited_sbt_weekly_rewards (wallet, week_key, points)
  values (v_wallet, v_week_key, v_points)
  on conflict (wallet, week_key) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return 0;
  end if;

  insert into player_stats (wallet, points, updated_at)
  values (v_wallet, v_points, now())
  on conflict (wallet) do update
    set points = player_stats.points + excluded.points,
        updated_at = now();

  return v_points;
end;
$$;

grant execute on function get_limited_sbt_state(text) to anon, authenticated;
grant execute on function claim_limited_sbt(text) to anon, authenticated;
grant execute on function claim_limited_sbt_weekly_points(text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
