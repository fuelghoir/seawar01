-- Optimizes the season reward estimate endpoint by performing the calculation in the database
-- instead of downloading all rows to the Node.js backend.
-- Run this in Supabase SQL Editor.

create or replace function get_season_reward_estimate(p_wallet text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_points integer := 0;
  v_wallet_transactions integer := 0;
  v_eligible boolean := false;
  v_total_points bigint := 0;
  v_eligible_players integer := 0;
  v_higher_eligible_players integer := 0;
  v_rank integer := null;
  v_min_points integer := 3000;
  v_min_transactions integer := 10;
  v_active_season text;
begin
  -- 0. Get active season key and min tx count
  select season_key, coalesce(min_tx_count, 10) 
  into v_active_season, v_min_transactions 
  from season_config where id = 'default';
  
  if v_active_season is null then
    v_active_season := 'S1';
  end if;

  -- 1. Get requested wallet stats
  select
    coalesce(sp.points, 0),
    coalesce(ps.games_played, 0) + coalesce(ps.total_checkins, 0)
  into v_wallet_points, v_wallet_transactions
  from player_stats ps
  left join season_progress sp on lower(sp.wallet) = lower(ps.wallet) and sp.season_key = v_active_season
  where lower(ps.wallet) = lower(p_wallet);

  if v_wallet_points is null then
    v_wallet_points := 0;
  end if;
  if v_wallet_transactions is null then
    v_wallet_transactions := 0;
  end if;

  if v_wallet_points >= v_min_points and v_wallet_transactions >= v_min_transactions then
    v_eligible := true;
  end if;

  -- 2. Calculate global aggregates for eligible players
  select
    coalesce(sum(sp.points::bigint), 0),
    count(ps.wallet)
  into v_total_points, v_eligible_players
  from player_stats ps
  join season_progress sp on lower(sp.wallet) = lower(ps.wallet) and sp.season_key = v_active_season
  where
    sp.points >= v_min_points
    and
    (coalesce(ps.games_played, 0) + coalesce(ps.total_checkins, 0)) >= v_min_transactions;

  -- 3. Calculate rank if eligible
  if v_eligible then
    select count(ps.wallet)
    into v_higher_eligible_players
    from player_stats ps
    join season_progress sp on lower(sp.wallet) = lower(ps.wallet) and sp.season_key = v_active_season
    where
      sp.points > v_wallet_points
      and
      sp.points >= v_min_points
      and
      (coalesce(ps.games_played, 0) + coalesce(ps.total_checkins, 0)) >= v_min_transactions;

    v_rank := v_higher_eligible_players + 1;
  end if;

  return json_build_object(
    'walletPoints', v_wallet_points,
    'walletTransactions', v_wallet_transactions,
    'eligible', v_eligible,
    'minPoints', v_min_points,
    'minTransactions', v_min_transactions,
    'totalPoints', v_total_points,
    'rank', v_rank,
    'eligiblePlayers', v_eligible_players,
    'playersScanned', v_eligible_players
  );
end;
$$;
