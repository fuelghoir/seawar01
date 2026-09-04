-- Cumulative Fleet Season points.
-- Positive player_stats gains count toward the active fleet season; spending never subtracts.

begin;

create or replace function public.sync_player_stats_points_to_active_fleet_season()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_wallet text := lower(btrim(coalesce(new.wallet, '')));
  v_points_gain integer := 0;
  v_season_key text;
begin
  if tg_op = 'INSERT' then
    v_points_gain := greatest(0, coalesce(new.points, 0));
  else
    v_points_gain := greatest(0, coalesce(new.points, 0) - coalesce(old.points, 0));
  end if;

  if v_points_gain = 0 or v_wallet !~ '^0x[a-f0-9]{40}$' then
    return new;
  end if;

  select season.season_key
    into v_season_key
  from public.fleet_seasons season
  join public.fleet_season_members member
    on member.season_key = season.season_key
   and member.wallet = v_wallet
   and member.joined_at <= statement_timestamp()
  where season.status = 'active'
    and season.starts_at <= statement_timestamp()
    and season.ends_at > statement_timestamp()
  order by season.starts_at desc
  limit 1;

  if v_season_key is null then
    return new;
  end if;

  insert into public.season_progress (
    wallet,
    season_key,
    xp,
    claimed_levels,
    points,
    updated_at
  ) values (
    v_wallet,
    v_season_key,
    0,
    '{}'::integer[],
    v_points_gain,
    statement_timestamp()
  )
  on conflict (wallet, season_key) do update
    set points = coalesce(season_progress.points, 0) + excluded.points,
        updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists trigger_sync_player_stats_fleet_season_points
  on public.player_stats;
create trigger trigger_sync_player_stats_fleet_season_points
after insert or update of points on public.player_stats
for each row
execute function public.sync_player_stats_points_to_active_fleet_season();

-- Rebuild a conservative floor for points earned before this ledger existed.
-- It uses the larger of the current net gain and verified game points, so
-- rerunning the migration never doubles a player's score.
with valid_members as (
  select
    member.wallet,
    member.season_key,
    member.joined_at,
    member.points_at_join,
    season.ends_at
  from public.fleet_season_members member
  join public.fleet_seasons season
    on season.season_key = member.season_key
  where member.season_key = 'S3'
    and member.joined_at >= '2026-09-01T16:33:00.000Z'::timestamptz
    and season.status in ('active', 'ended', 'snapshotted')
),
base_app_wallets as (
  select distinct lower(claim.wallet) as wallet
  from public.daily_checkin_claims claim
  where claim.is_base_app = true
  union
  select distinct lower(link.wallet) as wallet
  from public.acquisition_wallet_links link
  join public.acquisition_sessions session
    on session.id = link.session_id
  where session.platform = 'base_app'
),
game_points as (
  select
    member.wallet,
    member.season_key,
    coalesce(sum(
      case
        when lower(game.player1) = member.wallet then greatest(0, coalesce(game.player1_hits, 0))
        when lower(coalesce(game.player2, '')) = member.wallet then greatest(0, coalesce(game.player2_hits, 0))
        else 0
      end
      + case when lower(coalesce(game.winner, '')) = member.wallet then 50 else 0 end
      + case
          when game.id is not null and base_app.wallet is not null then 1000
          else 0
        end
    ), 0)::integer as points
  from valid_members member
  left join public.games game
    on game.state = 3
   and game.created_at >= member.joined_at
   and game.created_at < member.ends_at
   and (
     lower(game.player1) = member.wallet
     or lower(coalesce(game.player2, '')) = member.wallet
   )
  left join base_app_wallets base_app
    on base_app.wallet = member.wallet
  group by member.wallet, member.season_key
),
miner_points as (
  select
    member.wallet,
    member.season_key,
    coalesce(sum(claim.points), 0)::integer as points
  from valid_members member
  left join public.fleet_nft_point_claims claim
    on lower(claim.wallet) = member.wallet
   and claim.created_at >= member.joined_at
   and claim.created_at < member.ends_at
  group by member.wallet, member.season_key
),
backfill as (
  select
    member.wallet,
    member.season_key,
    greatest(
      0,
      coalesce(stats.points, 0) - member.points_at_join,
      coalesce(game_points.points, 0) + coalesce(miner_points.points, 0)
    )::integer as points
  from valid_members member
  left join public.player_stats stats
    on lower(stats.wallet) = member.wallet
  left join game_points
    on game_points.wallet = member.wallet
   and game_points.season_key = member.season_key
  left join miner_points
    on miner_points.wallet = member.wallet
   and miner_points.season_key = member.season_key
)
insert into public.season_progress (
  wallet,
  season_key,
  xp,
  claimed_levels,
  points,
  updated_at
)
select
  wallet,
  season_key,
  0,
  '{}'::integer[],
  points,
  statement_timestamp()
from backfill
on conflict (wallet, season_key) do update
  set points = greatest(coalesce(season_progress.points, 0), excluded.points),
      updated_at = case
        when excluded.points > coalesce(season_progress.points, 0) then excluded.updated_at
        else season_progress.updated_at
      end;

commit;

select pg_notify('pgrst', 'reload schema');
