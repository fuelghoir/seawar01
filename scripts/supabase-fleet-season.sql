-- Fleet Season: balanced assignment, win standings, and secret 60/30/10 drop.
-- Run after supabase-creator-program.sql.

begin;

alter table public.season_config
  add column if not exists bp_season_key text default 'S2';

update public.season_config
set bp_season_key = 'S2',
    end_date = '2027-01-01T00:00:00.000Z'
where id = 'default';

create table if not exists public.fleet_seasons (
  season_key text primary key,
  title text not null default 'Fleet Season',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft',
  ranking_metric text not null default 'total_wins',
  -- Legacy column name: stores the minimum games + check-ins eligibility threshold.
  min_games integer not null default 10,
  first_share_bps integer not null default 6000,
  second_share_bps integer not null default 3000,
  third_share_bps integer not null default 1000,
  drop_id text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_seasons_status check (status in ('draft', 'active', 'ended', 'snapshotted')),
  constraint fleet_seasons_metric check (ranking_metric = 'total_wins'),
  constraint fleet_seasons_dates check (ends_at > starts_at),
  constraint fleet_seasons_min_games check (min_games >= 0),
  constraint fleet_seasons_shares check (
    first_share_bps >= 0 and second_share_bps >= 0 and third_share_bps >= 0 and
    first_share_bps + second_share_bps + third_share_bps = 10000
  )
);

alter table public.fleet_seasons alter column min_games set default 10;
comment on column public.fleet_seasons.min_games is
  'Legacy name: minimum games_played + total_checkins required for the fleet drop';

create unique index if not exists idx_fleet_seasons_one_active
  on public.fleet_seasons(status)
  where status = 'active';

create table if not exists public.fleet_season_fleets (
  season_key text not null references public.fleet_seasons(season_key) on delete cascade,
  fleet_id text not null,
  name text not null,
  color text not null,
  image_path text not null,
  display_order integer not null,
  primary key (season_key, fleet_id),
  unique (season_key, display_order),
  constraint fleet_season_fleet_id check (fleet_id in ('tideguard', 'ironwake', 'sunfleet'))
);

create table if not exists public.fleet_season_members (
  season_key text not null,
  wallet text not null,
  fleet_id text not null,
  joined_at timestamptz not null default now(),
  points_at_join bigint not null default 0,
  points_at_end bigint,
  primary key (season_key, wallet),
  foreign key (season_key, fleet_id)
    references public.fleet_season_fleets(season_key, fleet_id) on delete restrict,
  constraint fleet_season_member_wallet check (wallet ~ '^0x[a-f0-9]{40}$'),
  constraint fleet_season_member_points check (
    points_at_join >= 0 and (points_at_end is null or points_at_end >= points_at_join)
  )
);

alter table public.fleet_season_members
  add column if not exists points_at_join bigint not null default 0;
alter table public.fleet_season_members
  add column if not exists points_at_end bigint;

create index if not exists idx_fleet_season_members_fleet
  on public.fleet_season_members(season_key, fleet_id);

create table if not exists public.fleet_season_results (
  season_key text not null references public.fleet_seasons(season_key) on delete cascade,
  fleet_id text not null,
  rank integer not null,
  wins integer not null,
  games integer not null,
  eligible_members integer not null,
  points_earned bigint not null default 0,
  share_bps integer not null,
  amount_raw text not null,
  snapshot_at timestamptz not null default now(),
  primary key (season_key, fleet_id),
  constraint fleet_season_result_rank check (rank between 1 and 3),
  constraint fleet_season_result_values check (
    wins >= 0 and games >= 0 and eligible_members >= 0 and share_bps >= 0
  )
);

alter table public.fleet_season_results
  add column if not exists points_earned bigint not null default 0;

create table if not exists public.fleet_season_payouts (
  season_key text not null references public.fleet_seasons(season_key) on delete cascade,
  wallet text not null,
  fleet_id text not null,
  rank integer not null,
  games integer not null,
  wins integer not null,
  points_earned bigint not null default 0,
  equal_amount_raw text not null default '0',
  points_amount_raw text not null default '0',
  amount_raw text not null,
  created_at timestamptz not null default now(),
  primary key (season_key, wallet),
  constraint fleet_season_payout_wallet check (wallet ~ '^0x[a-f0-9]{40}$'),
  constraint fleet_season_payout_values check (rank between 1 and 3 and games >= 0 and wins >= 0)
);

alter table public.fleet_season_payouts
  add column if not exists points_earned bigint not null default 0;
alter table public.fleet_season_payouts
  add column if not exists equal_amount_raw text not null default '0';
alter table public.fleet_season_payouts
  add column if not exists points_amount_raw text not null default '0';

create index if not exists idx_games_fleet_season_stats
  on public.games(created_at, state, winner);

create or replace function public.touch_fleet_season_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fleet_seasons_touch on public.fleet_seasons;
create trigger trg_fleet_seasons_touch
before update on public.fleet_seasons
for each row execute function public.touch_fleet_season_updated_at();

-- S3 originally launched with automatic assignment. Only explicit choices made
-- after the choice rollout remain valid.
delete from public.fleet_season_members
where season_key = 'S3'
  and joined_at < '2026-09-01T16:33:00.000Z'::timestamptz;

drop function if exists public.join_active_fleet_season(text);
create or replace function public.join_active_fleet_season(p_wallet text, p_fleet_id text)
returns table(season_key text, fleet_id text, joined_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(trim(p_wallet));
  v_season_key text;
  v_fleet_id text := lower(trim(p_fleet_id));
  v_points_at_join bigint := 0;
begin
  if v_wallet !~ '^0x[a-f0-9]{40}$' then
    raise exception 'Invalid wallet';
  end if;

  select fs.season_key
    into v_season_key
  from public.fleet_seasons fs
  where fs.status = 'active'
    and now() >= fs.starts_at
    and now() < fs.ends_at
  order by fs.starts_at desc
  limit 1
  for update;

  if v_season_key is null then
    raise exception 'No active fleet season';
  end if;

  if not exists (
    select 1 from public.fleet_season_fleets f
    where f.season_key = v_season_key and f.fleet_id = v_fleet_id
  ) then
    raise exception 'Invalid fleet choice';
  end if;

  return query
    select m.season_key, m.fleet_id, m.joined_at
    from public.fleet_season_members m
    where m.season_key = v_season_key and m.wallet = v_wallet;
  if found then return; end if;

  select coalesce(ps.points, 0)
    into v_points_at_join
  from public.player_stats ps
  where lower(ps.wallet) = v_wallet
  limit 1;
  v_points_at_join := coalesce(v_points_at_join, 0);

  insert into public.fleet_season_members(season_key, wallet, fleet_id, points_at_join)
  values (v_season_key, v_wallet, v_fleet_id, v_points_at_join)
  on conflict on constraint fleet_season_members_pkey do nothing;

  return query
    select m.season_key, m.fleet_id, m.joined_at
    from public.fleet_season_members m
    where m.season_key = v_season_key and m.wallet = v_wallet;
end;
$$;

create or replace function public.activate_fleet_season(p_season_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.fleet_seasons
    where season_key = p_season_key and status = 'draft'
    for update
  ) then
    raise exception 'Fleet season is not a draft';
  end if;

  update public.season_config
  set is_ended = true
  where id = 'default';

  update public.fleet_seasons
  set status = 'active'
  where season_key = p_season_key;
end;
$$;

create or replace function public.end_fleet_season(p_season_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.fleet_seasons
    where season_key = p_season_key and status = 'active'
    for update
  ) then
    raise exception 'Fleet season is not active';
  end if;

  update public.fleet_season_members
  set points_at_end = points_at_join
  where season_key = p_season_key;

  update public.fleet_season_members m
  set points_at_end = greatest(coalesce(ps.points, m.points_at_join), m.points_at_join)
  from public.player_stats ps
  where m.season_key = p_season_key
    and lower(ps.wallet) = m.wallet;

  update public.fleet_seasons
  set status = 'ended', ends_at = now()
  where season_key = p_season_key;
end;
$$;

create or replace function public.create_fleet_season_snapshot(
  p_season_key text,
  p_drop_id text,
  p_drop_title text,
  p_token_address text,
  p_token_symbol text,
  p_decimals integer,
  p_total_amount_raw text,
  p_contract_address text,
  p_signer_address text,
  p_created_by text,
  p_results jsonb,
  p_payouts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_total numeric;
  v_allocated numeric;
  v_total_points bigint;
begin
  select status into v_status
  from public.fleet_seasons
  where season_key = p_season_key
  for update;

  if v_status is null then raise exception 'Fleet season not found'; end if;
  if v_status <> 'ended' then raise exception 'Fleet season must be ended before snapshot'; end if;
  if exists (select 1 from public.fleet_season_results where season_key = p_season_key) then
    raise exception 'Fleet season snapshot already exists';
  end if;
  if exists (select 1 from public.drop_campaigns where id = p_drop_id) then
    raise exception 'Drop id already exists';
  end if;

  v_total := p_total_amount_raw::numeric;
  if v_total <= 0 or trunc(v_total) <> v_total then raise exception 'Invalid raw drop amount'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payouts) entry
    where (entry->>'pointsEarned')::bigint < 0
      or (entry->>'amountRaw')::numeric < 0
      or (entry->>'equalAmountRaw')::numeric <> 0
      or (entry->>'amountRaw')::numeric <> (entry->>'pointsAmountRaw')::numeric
  ) then
    raise exception 'Invalid points-only member payout breakdown';
  end if;

  select coalesce(sum((entry->>'amountRaw')::numeric), 0)
    into v_allocated
  from jsonb_array_elements(p_payouts) entry;
  select coalesce(sum((entry->>'pointsEarned')::bigint), 0)
    into v_total_points
  from jsonb_array_elements(p_payouts) entry;
  if v_allocated <> v_total then raise exception 'Payout total does not match drop total'; end if;
  if jsonb_array_length(p_results) <> 3 then raise exception 'Snapshot must contain three fleet results'; end if;

  insert into public.drop_campaigns(
    id, title, token_address, token_symbol, decimals, total_amount_raw,
    total_points, contract_address, signer_address, status, snapshot_at, created_by
  ) values (
    p_drop_id, p_drop_title, lower(p_token_address), p_token_symbol, p_decimals,
    p_total_amount_raw, v_total_points, nullif(lower(p_contract_address), ''),
    nullif(lower(p_signer_address), ''), 'draft', now(), p_created_by
  );

  insert into public.drop_allocations(drop_id, wallet, points, amount_raw)
  select
    p_drop_id,
    lower(entry->>'wallet'),
    (entry->>'pointsEarned')::bigint,
    entry->>'amountRaw'
  from jsonb_array_elements(p_payouts) entry;

  insert into public.fleet_season_results(
    season_key, fleet_id, rank, wins, games, eligible_members, points_earned, share_bps, amount_raw
  )
  select
    p_season_key,
    entry->>'fleetId',
    (entry->>'rank')::integer,
    (entry->>'wins')::integer,
    (entry->>'games')::integer,
    (entry->>'eligibleMembers')::integer,
    (entry->>'pointsEarned')::bigint,
    (entry->>'shareBps')::integer,
    entry->>'amountRaw'
  from jsonb_array_elements(p_results) entry;

  insert into public.fleet_season_payouts(
    season_key, wallet, fleet_id, rank, games, wins, points_earned,
    equal_amount_raw, points_amount_raw, amount_raw
  )
  select
    p_season_key,
    lower(entry->>'wallet'),
    entry->>'fleetId',
    (entry->>'rank')::integer,
    (entry->>'games')::integer,
    (entry->>'wins')::integer,
    (entry->>'pointsEarned')::bigint,
    entry->>'equalAmountRaw',
    entry->>'pointsAmountRaw',
    entry->>'amountRaw'
  from jsonb_array_elements(p_payouts) entry;

  update public.fleet_seasons
  set status = 'snapshotted', drop_id = p_drop_id
  where season_key = p_season_key;
end;
$$;

alter table public.fleet_seasons enable row level security;
alter table public.fleet_season_fleets enable row level security;
alter table public.fleet_season_members enable row level security;
alter table public.fleet_season_results enable row level security;
alter table public.fleet_season_payouts enable row level security;

revoke all on public.fleet_seasons from public, anon, authenticated;
revoke all on public.fleet_season_fleets from public, anon, authenticated;
revoke all on public.fleet_season_members from public, anon, authenticated;
revoke all on public.fleet_season_results from public, anon, authenticated;
revoke all on public.fleet_season_payouts from public, anon, authenticated;
grant all on public.fleet_seasons to service_role;
grant all on public.fleet_season_fleets to service_role;
grant all on public.fleet_season_members to service_role;
grant all on public.fleet_season_results to service_role;
grant all on public.fleet_season_payouts to service_role;

revoke all on function public.join_active_fleet_season(text, text) from public, anon, authenticated;
revoke all on function public.activate_fleet_season(text) from public, anon, authenticated;
revoke all on function public.end_fleet_season(text) from public, anon, authenticated;
revoke all on function public.create_fleet_season_snapshot(text, text, text, text, text, integer, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.join_active_fleet_season(text, text) to service_role;
grant execute on function public.activate_fleet_season(text) to service_role;
grant execute on function public.end_fleet_season(text) to service_role;
grant execute on function public.create_fleet_season_snapshot(text, text, text, text, text, integer, text, text, text, text, jsonb, jsonb) to service_role;

-- Secret drops must not be enumerable through the public Supabase client.
drop policy if exists select_drop_campaigns on public.drop_campaigns;
drop policy if exists select_drop_allocations on public.drop_allocations;
revoke select on public.drop_campaigns from public, anon, authenticated;
revoke select on public.drop_allocations from public, anon, authenticated;
grant all on public.drop_campaigns to service_role;
grant all on public.drop_allocations to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
