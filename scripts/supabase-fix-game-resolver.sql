-- 1. Modify resolve_offchain_game_stats to use bp_season_key for XP and season_key for Points

create or replace function resolve_offchain_game_stats(
  p_game_id bigint,
  p_player text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game record;
  v_player text := lower(trim(p_player));
  v_winner text;
  v_player1_hits integer := 0;
  v_player2_hits integer := 0;
  v_player_hits integer := 0;
  v_wallet text;
  v_won boolean;
  v_raw_points integer;
  v_points integer;
  v_multiplier integer;
  v_players jsonb := '[]'::jsonb;
  v_bot_wallet constant text := '0x0000000000000000000000000000000000000001';
  v_bp_season_key text;
  v_season_key text;
begin
  if v_player !~ '^0x[a-f0-9]{40}$' then
    raise exception 'Invalid wallet address';
  end if;

  select * into v_game from games where id = p_game_id;
  if v_game is null then
    raise exception 'Game not found';
  end if;

  if v_game.state <> 3 or v_game.winner is null then
    raise exception 'Game is not finished';
  end if;

  if coalesce(v_game.game_mode, 'friend') = 'challenge' then
    raise exception 'Challenge stats are resolved by challenge APIs';
  end if;

  if v_player <> lower(v_game.player1) and v_player <> lower(coalesce(v_game.player2, '')) then
    raise exception 'Not a player in this game';
  end if;

  if exists (select 1 from resolved_games where game_id = p_game_id) then
    return json_build_object('alreadyResolved', true, 'players', json_build_array());
  end if;

  v_winner := lower(v_game.winner);
  if v_winner <> lower(v_game.player1) and v_winner <> lower(coalesce(v_game.player2, '')) then
    raise exception 'Winner is not a game player';
  end if;

  select greatest(
    coalesce(v_game.player1_hits, 0),
    coalesce(count(*) filter (where player_num = 1 and is_hit = true), 0)
  )::integer,
  greatest(
    coalesce(v_game.player2_hits, 0),
    coalesce(count(*) filter (where player_num = 2 and is_hit = true), 0)
  )::integer
    into v_player1_hits, v_player2_hits
    from shots
    where game_id = p_game_id;

  if (v_winner = lower(v_game.player1) and v_player1_hits < 20)
    or (v_winner = lower(coalesce(v_game.player2, '')) and v_player2_hits < 20) then
    raise exception 'Winner does not have enough hits';
  end if;

  insert into resolved_games (game_id) values (p_game_id);

  select coalesce(season_key, 'S1'), coalesce(bp_season_key, 'S1') 
    into v_season_key, v_bp_season_key 
    from season_config 
    where id = 'default';

  for v_wallet, v_player_hits in
    select lower(v_game.player1), v_player1_hits
    union all
    select lower(v_game.player2), v_player2_hits
  loop
    if v_wallet is null or v_wallet = '' or v_wallet = v_bot_wallet then
      continue;
    end if;

    v_won := v_wallet = v_winner;
    v_raw_points := v_player_hits + case when v_won then 50 else 0 end;
    select case
      when exists (
        select 1
        from player_boosters
        where wallet = v_wallet
          and booster_slug = 'double_points'
          and active_until > now()
      ) then 2
      else 1
    end into v_multiplier;
    v_points := v_raw_points * v_multiplier;

    insert into player_stats (wallet, points, games_played, wins, total_hits, updated_at)
    values (v_wallet, v_points, 1, case when v_won then 1 else 0 end, v_player_hits, now())
    on conflict (wallet) do update
      set points = player_stats.points + excluded.points,
          games_played = player_stats.games_played + 1,
          wins = player_stats.wins + excluded.wins,
          total_hits = coalesce(player_stats.total_hits, 0) + excluded.total_hits,
          updated_at = now();

    -- Update BP XP
    insert into season_progress (wallet, season_key, xp, claimed_levels, updated_at)
    values (v_wallet, v_bp_season_key, v_raw_points, '{}'::integer[], now())
    on conflict (wallet, season_key) do update
      set xp = coalesce(season_progress.xp, 0) + excluded.xp,
          updated_at = now();

    -- Update Season Points
    insert into season_progress (wallet, season_key, points, updated_at)
    values (v_wallet, v_season_key, v_points, now())
    on conflict (wallet, season_key) do update
      set points = coalesce(season_progress.points, 0) + excluded.points,
          updated_at = now();

    v_players := v_players || jsonb_build_object(
      'wallet', v_wallet,
      'hits', v_player_hits,
      'won', v_won,
      'points', v_points
    );
  end loop;

  return json_build_object(
    'alreadyResolved', false,
    'gameId', p_game_id,
    'players', v_players
  );
end;
$$;
