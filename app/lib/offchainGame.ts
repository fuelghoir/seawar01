import { supabase } from "./supabase";

// ─── Offchain game CRUD ───

export async function createOffchainGame(
  playerAddress: string,
  isPrivate: boolean,
  opts?: { game_mode?: string; onchain_game_id?: number; wager_amount?: number }
): Promise<number> {
  const row: Record<string, unknown> = {
    player1: playerAddress.toLowerCase(),
    is_private: isPrivate,
  };
  if (opts?.game_mode) row.game_mode = opts.game_mode;
  if (opts?.onchain_game_id !== undefined) row.onchain_game_id = opts.onchain_game_id;
  if (opts?.wager_amount !== undefined) row.wager_amount = opts.wager_amount;

  const { data, error } = await supabase
    .from("games")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function getGameOnchainId(gameId: number): Promise<number | null> {
  const { data } = await supabase
    .from("games")
    .select("onchain_game_id")
    .eq("id", gameId)
    .single();
  return data?.onchain_game_id ?? null;
}

export async function joinOffchainGame(
  gameId: number,
  playerAddress: string
): Promise<void> {
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");
  if (game.state !== 0) throw new Error("Game not available");
  if (game.player1 === playerAddress.toLowerCase())
    throw new Error("Cannot join own game");

  const { error } = await supabase
    .from("games")
    .update({ player2: playerAddress.toLowerCase(), state: 1 })
    .eq("id", gameId)
    .eq("state", 0);
  if (error) throw new Error(error.message);
}

export async function commitOffchainBoard(
  gameId: number,
  playerAddress: string,
  boardHash: string
): Promise<void> {
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");

  const isPlayer1 = game.player1 === playerAddress.toLowerCase();
  const isPlayer2 = game.player2 === playerAddress.toLowerCase();
  if (!isPlayer1 && !isPlayer2) throw new Error("Not a player");

  const updates: Record<string, unknown> = {};
  if (isPlayer1) {
    if (game.player1_board_hash) throw new Error("Already committed");
    updates.player1_board_hash = boardHash;
  } else {
    if (game.player2_board_hash) throw new Error("Already committed");
    updates.player2_board_hash = boardHash;
  }

  const otherCommitted = isPlayer1
    ? game.player2_board_hash
    : game.player1_board_hash;
  if (otherCommitted) updates.state = 2;

  const { error } = await supabase
    .from("games")
    .update(updates)
    .eq("id", gameId);
  if (error) throw new Error(error.message);
}

export async function shootOffchain(
  gameId: number,
  playerAddress: string,
  x: number,
  y: number
): Promise<void> {
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");
  if (game.state !== 2) throw new Error("Game not active");
  if (game.turn_phase !== 0) throw new Error("Waiting for hit report");

  const addr = playerAddress.toLowerCase();
  const playerNum = game.player1 === addr ? 1 : game.player2 === addr ? 2 : 0;
  if (playerNum === 0) throw new Error("Not a player");
  if (game.current_turn !== playerNum) throw new Error("Not your turn");

  const { data: existing } = await supabase
    .from("shots")
    .select("id")
    .eq("game_id", gameId)
    .eq("player_num", playerNum)
    .eq("x", x)
    .eq("y", y)
    .limit(1);
  if (existing && existing.length > 0) throw new Error("Already shot here");

  await supabase.from("shots").insert({
    game_id: gameId,
    player_num: playerNum,
    x,
    y,
  });

  const { error } = await supabase
    .from("games")
    .update({
      last_shot_x: x,
      last_shot_y: y,
      last_shooter: addr,
      turn_phase: 1,
    })
    .eq("id", gameId);
  if (error) throw new Error(error.message);
}

export async function reportHitOffchain(
  gameId: number,
  playerAddress: string,
  x: number,
  y: number,
  isHit: boolean
): Promise<void> {
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");
  if (game.state !== 2) throw new Error("Game not active");
  if (game.turn_phase !== 1) throw new Error("No shot to report");

  const addr = playerAddress.toLowerCase();
  if (game.last_shooter === addr) throw new Error("Not the opponent");

  const shooterNum = game.player1 === game.last_shooter ? 1 : 2;

  await supabase
    .from("shots")
    .update({ is_hit: isHit })
    .eq("game_id", gameId)
    .eq("player_num", shooterNum)
    .eq("x", x)
    .eq("y", y);

  const updates: Record<string, unknown> = {
    turn_phase: 0,
    current_turn: isHit
      ? game.current_turn
      : game.current_turn === 1
        ? 2
        : 1,
  };

  if (isHit) {
    if (shooterNum === 1) {
      updates.player1_hits = game.player1_hits + 1;
      if (game.player1_hits + 1 >= 20) {
        updates.state = 3;
        updates.winner = game.player1;
      }
    } else {
      updates.player2_hits = game.player2_hits + 1;
      if (game.player2_hits + 1 >= 20) {
        updates.state = 3;
        updates.winner = game.player2;
      }
    }

    const shooterAddr = game.last_shooter;
    if (updates.state === 3 && updates.winner) {
      // Game finished: +1 hit + 50 win for winner, 0 for loser (sequential to avoid race)
      const winnerAddr = updates.winner as string;
      const loserAddr = winnerAddr === game.player1 ? game.player2 : game.player1;
      addPoints(shooterAddr, 51) // +1 hit + 50 win combined
        .then(() => recordGameResult(shooterAddr, true))
        .then(() => recordGameResult(loserAddr, false))
        .catch(() => {});
    } else {
      // Regular hit: +1 point
      addPoints(shooterAddr, 1).catch(() => {});
    }
  }

  const { error } = await supabase
    .from("games")
    .update(updates)
    .eq("id", gameId);
  if (error) throw new Error(error.message);
}

export async function getAvailableGames(
  excludeAddress?: string
): Promise<{ id: number; player1: string }[]> {
  let query = supabase
    .from("games")
    .select("id, player1")
    .eq("state", 0)
    .eq("is_private", false)
    .order("id", { ascending: false })
    .limit(20);

  if (excludeAddress) {
    query = query.neq("player1", excludeAddress.toLowerCase());
  }

  const { data } = await query;
  return data || [];
}

export async function getPlayerShots(
  gameId: number,
  playerNum: number
): Promise<{ x: number; y: number; is_hit: boolean | null }[]> {
  const { data } = await supabase
    .from("shots")
    .select("x, y, is_hit")
    .eq("game_id", gameId)
    .eq("player_num", playerNum);
  return data || [];
}

// ─── Sunk ship reports ───

export interface SunkReport {
  id: number;
  game_key: string;
  ship_cells: number[][]; // [[x,y],...]
  killed_by: string;
}

export async function reportSunkShip(
  gameKey: string,
  shipCells: number[][],
  killedBy: string
): Promise<void> {
  await supabase.from("sunk_reports").insert({
    game_key: gameKey,
    ship_cells: shipCells,
    killed_by: killedBy.toLowerCase(),
  });
}

export async function getSunkReports(
  gameKey: string
): Promise<SunkReport[]> {
  const { data } = await supabase
    .from("sunk_reports")
    .select("id, game_key, ship_cells, killed_by")
    .eq("game_key", gameKey);
  return (data as SunkReport[]) || [];
}

// ─── Points-based leaderboard ───

export async function addPoints(
  wallet: string,
  points: number
): Promise<void> {
  const addr = wallet.toLowerCase();
  const { data: existing } = await supabase
    .from("player_stats")
    .select("points")
    .eq("wallet", addr)
    .single();

  if (existing) {
    await supabase
      .from("player_stats")
      .update({
        points: existing.points + points,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", addr);
  } else {
    await supabase.from("player_stats").insert({
      wallet: addr,
      points,
    });
  }
}

/** Record win/loss stats only (points are added separately via addPoints). */
export async function recordGameResult(
  wallet: string,
  won: boolean
): Promise<void> {
  const addr = wallet.toLowerCase();
  const { data: existing } = await supabase
    .from("player_stats")
    .select("*")
    .eq("wallet", addr)
    .single();

  if (existing) {
    await supabase
      .from("player_stats")
      .update({
        games_played: existing.games_played + 1,
        wins: existing.wins + (won ? 1 : 0),
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", addr);
  } else {
    await supabase.from("player_stats").insert({
      wallet: addr,
      games_played: 1,
      wins: won ? 1 : 0,
    });
  }
}

// ─── Daily check-in ───

export interface CheckinStatus {
  canCheckin: boolean;
  streak: number;
  nextReward: number;
}

function getCheckinReward(streak: number): number {
  return Math.ceil(streak / 5) * 5;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function getCheckinStatus(
  wallet: string
): Promise<CheckinStatus> {
  const addr = wallet.toLowerCase();
  const { data } = await supabase
    .from("player_stats")
    .select("checkin_streak, last_checkin")
    .eq("wallet", addr)
    .single();

  if (!data) {
    return { canCheckin: true, streak: 0, nextReward: 5 };
  }

  const today = todayUTC();
  const yesterday = yesterdayUTC();

  if (data.last_checkin === today) {
    return {
      canCheckin: false,
      streak: data.checkin_streak,
      nextReward: getCheckinReward(data.checkin_streak + 1),
    };
  }

  const streak =
    data.last_checkin === yesterday ? data.checkin_streak : 0;
  return {
    canCheckin: true,
    streak,
    nextReward: getCheckinReward(streak + 1),
  };
}

export async function dailyCheckin(
  wallet: string
): Promise<{ points: number; streak: number }> {
  const addr = wallet.toLowerCase();
  const today = todayUTC();
  const yesterday = yesterdayUTC();

  const { data: existing } = await supabase
    .from("player_stats")
    .select("*")
    .eq("wallet", addr)
    .single();

  let newStreak: number;

  if (!existing) {
    newStreak = 1;
    const reward = getCheckinReward(newStreak);
    await supabase.from("player_stats").insert({
      wallet: addr,
      points: reward,
      checkin_streak: newStreak,
      last_checkin: today,
    });
    return { points: reward, streak: newStreak };
  }

  if (existing.last_checkin === today) {
    throw new Error("Already checked in today");
  }

  newStreak =
    existing.last_checkin === yesterday
      ? existing.checkin_streak + 1
      : 1;

  const reward = getCheckinReward(newStreak);

  await supabase
    .from("player_stats")
    .update({
      points: existing.points + reward,
      checkin_streak: newStreak,
      last_checkin: today,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet", addr);

  return { points: reward, streak: newStreak };
}

// ─── Leaderboard ───

export interface LeaderboardEntry {
  wallet: string;
  points: number;
  wins: number;
  games_played: number;
  total_hits: number;
  checkin_streak: number;
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data } = await supabase
    .from("player_stats")
    .select("wallet, points, wins, games_played, total_hits, checkin_streak")
    .gt("points", 0)
    .order("points", { ascending: false })
    .limit(50);

  return (data as LeaderboardEntry[]) || [];
}
