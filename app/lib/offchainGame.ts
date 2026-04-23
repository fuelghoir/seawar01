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

export interface GameJoinInfo {
  wager_amount: number | null;
  onchain_game_id: number | null;
  game_mode: string | null;
  state: number;
  player1: string;
  player2: string | null;
}

export async function getGameJoinInfo(gameId: number): Promise<GameJoinInfo | null> {
  const { data } = await supabase
    .from("games")
    .select("wager_amount, onchain_game_id, game_mode, state, player1, player2")
    .eq("id", gameId)
    .single();
  return (data as GameJoinInfo) ?? null;
}

export async function joinOffchainGame(
  gameId: number,
  playerAddress: string
): Promise<void> {
  const addr = playerAddress.toLowerCase();
  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .single();
  if (!game) throw new Error("Game not found");
  if (game.player1 === addr) throw new Error("Cannot join own game");

  // Idempotent: if we're already seated as player2, nothing to do.
  if (game.player2 === addr) return;

  // Seat is free (state=0, player2=null)
  if (game.state === 0 && !game.player2) {
    const { error } = await supabase
      .from("games")
      .update({ player2: addr, state: 1 })
      .eq("id", gameId)
      .eq("state", 0);
    if (error) throw new Error(error.message);
    return;
  }

  // Someone else is already in
  throw new Error("Game not available");
}

export async function commitOffchainBoard(
  gameId: number,
  playerAddress: string,
  boardHash: string,
  boardLayout?: number[]
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
    if (boardLayout) updates.player1_board = JSON.stringify(boardLayout);
  } else {
    if (game.player2_board_hash) throw new Error("Already committed");
    updates.player2_board_hash = boardHash;
    if (boardLayout) updates.player2_board = JSON.stringify(boardLayout);
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

export async function markPrizeClaimed(gameId: number): Promise<void> {
  await supabase
    .from("games")
    .update({ prize_claimed: true })
    .eq("id", gameId);
}

// ─── Auto-close / refund helpers ───

const STALE_MINUTES = 3;

/**
 * Mark unjoined free/onchain games older than STALE_MINUTES as cancelled (state=4).
 * Wager games are skipped — they require an onchain refund call first.
 * Safe to call on every home load; state=4 rows are hidden everywhere.
 */
export async function autoCloseStaleGames(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  await supabase
    .from("games")
    .update({ state: 4 })
    .eq("state", 0)
    .is("player2", null)
    .lt("created_at", cutoff)
    .in("game_mode", ["offchain", "free", "hybrid"]);
}

export interface RefundableGame {
  id: number;
  onchain_game_id: number | null;
  wager_amount: number;
  created_at: string;
}

/**
 * Wager games created by `wallet`, still unjoined, older than STALE_MINUTES,
 * and not yet cancelled. These are eligible for onchain refund.
 */
export async function getRefundableGames(wallet: string): Promise<RefundableGame[]> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("games")
    .select("id, onchain_game_id, wager_amount, created_at")
    .eq("player1", wallet.toLowerCase())
    .eq("game_mode", "wager")
    .eq("state", 0)
    .is("player2", null)
    .lt("created_at", cutoff)
    .order("id", { ascending: false });
  return (data || []) as RefundableGame[];
}

export async function markGameCancelled(gameId: number): Promise<void> {
  await supabase
    .from("games")
    .update({ state: 4 })
    .eq("id", gameId);
}

export interface UnclaimedWin {
  id: number;
  onchain_game_id: number | null;
  wager_amount: number;
}

export async function getUnclaimedWins(wallet: string): Promise<UnclaimedWin[]> {
  const addr = wallet.toLowerCase();
  const { data } = await supabase
    .from("games")
    .select("id, onchain_game_id, wager_amount")
    .eq("winner", addr)
    .eq("game_mode", "wager")
    .eq("prize_claimed", false)
    .eq("state", 3)
    .order("id", { ascending: false });
  return (data || []) as UnclaimedWin[];
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

  const bombRemaining = game.bomb_shots_remaining ?? 0;
  const isBombShot = bombRemaining > 0;

  let nextTurn = game.current_turn;
  if (isBombShot) {
    // During bomb: always keep current player's turn
    // On last bomb shot: switch turn
    if (bombRemaining <= 1) {
      nextTurn = game.current_turn === 1 ? 2 : 1;
    }
  } else {
    // Normal: hit = keep turn, miss = switch
    nextTurn = isHit ? game.current_turn : (game.current_turn === 1 ? 2 : 1);
  }

  const updates: Record<string, unknown> = {
    turn_phase: 0,
    current_turn: nextTurn,
  };
  if (isBombShot) {
    updates.bomb_shots_remaining = bombRemaining - 1;
  }

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

export async function shootBombOffchain(
  gameId: number,
  playerAddress: string,
  centerX: number,
  centerY: number
): Promise<number> {
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

  // Collect valid 3x3 cells
  const cells: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = centerX + dx;
      const ny = centerY + dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
        cells.push({ x: nx, y: ny });
      }
    }
  }

  // Filter already-shot cells
  const { data: existingShots } = await supabase
    .from("shots")
    .select("x, y")
    .eq("game_id", gameId)
    .eq("player_num", playerNum);
  const shotSet = new Set((existingShots || []).map(s => `${s.x},${s.y}`));
  const newCells = cells.filter(c => !shotSet.has(`${c.x},${c.y}`));

  if (newCells.length === 0) throw new Error("All cells already shot");

  // Insert first shot
  const first = newCells[0];
  await supabase.from("shots").insert({
    game_id: gameId,
    player_num: playerNum,
    x: first.x,
    y: first.y,
  });

  // Set bomb_shots_remaining = total cells (including first shot's pending report)
  await supabase
    .from("games")
    .update({
      last_shot_x: first.x,
      last_shot_y: first.y,
      last_shooter: addr,
      turn_phase: 1,
      bomb_shots_remaining: newCells.length,
    })
    .eq("id", gameId);

  return newCells.length;
}

export async function getAvailableGames(
  excludeAddress?: string,
  mode?: "offchain" | "hybrid" | "wager"
): Promise<{ id: number; player1: string; game_mode: string; wager_amount: number }[]> {
  let query = supabase
    .from("games")
    .select("id, player1, game_mode, wager_amount")
    .eq("state", 0)
    .eq("is_private", false)
    .order("id", { ascending: false })
    .limit(20);

  if (excludeAddress) {
    query = query.neq("player1", excludeAddress.toLowerCase());
  }

  const { data } = await query;
  const rows = (data || []).map(g => ({
    ...g,
    game_mode: g.game_mode || "offchain",
    wager_amount: g.wager_amount || 0,
  }));

  if (!mode) return rows;
  // Legacy rows used "free" instead of "offchain" — treat them as offchain.
  if (mode === "offchain") {
    return rows.filter(r => r.game_mode === "offchain" || r.game_mode === "free");
  }
  return rows.filter(r => r.game_mode === mode);
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

// Wallets allowed to check in unlimited times.
// Each check-in awards +5 points and increments total_checkins,
// but does not update streak or last_checkin (so button stays active).
const UNLIMITED_CHECKIN_WALLETS = new Set([
  "0xa4df87d8940ac70ac8a33db79bb1057238b490e4",
  "0x7b92e59b2de9368e71843f9894ed63bfeebaaee7",
  "0x070441c0f583752ec53efb18903ecef0a53b65d0",
  "0x24e6d7eca78f48cf61565d585d80f5a940aded56",
]);

function isUnlimitedCheckinWallet(addr: string): boolean {
  return UNLIMITED_CHECKIN_WALLETS.has(addr.toLowerCase());
}

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

  if (isUnlimitedCheckinWallet(addr)) {
    return {
      canCheckin: true,
      streak: data?.checkin_streak ?? 0,
      nextReward: 5,
    };
  }

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

  if (isUnlimitedCheckinWallet(addr)) {
    // Whitelisted: +5 points, +1 check-in counter. Streak/last_checkin
    // untouched so canCheckin stays true and cooldown never triggers.
    if (existing) {
      await supabase
        .from("player_stats")
        .update({
          points: existing.points + 5,
          total_checkins: (existing.total_checkins ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet", addr);
      return { points: 5, streak: existing.checkin_streak };
    }
    await supabase.from("player_stats").insert({
      wallet: addr,
      points: 5,
      total_checkins: 1,
      checkin_streak: 0,
    });
    return { points: 5, streak: 0 };
  }

  let newStreak: number;

  if (!existing) {
    newStreak = 1;
    const reward = getCheckinReward(newStreak);
    await supabase.from("player_stats").insert({
      wallet: addr,
      points: reward,
      checkin_streak: newStreak,
      last_checkin: today,
      total_checkins: 1,
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
      total_checkins: (existing.total_checkins ?? 0) + 1,
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

// ─── Player profile ───

export interface PlayerProfile {
  wallet: string;
  points: number;
  totalCheckins: number;
  checkinStreak: number;
  totalWins: number;
  totalShots: number;
  onchainGames: number;
  onchainWins: number;
  onchainWinRate: number; // 0..1
  earningsUsdc: number;   // from wager wins (net, 90% of 2x pot)
}

export async function getPlayerProfile(
  wallet: string
): Promise<PlayerProfile> {
  const addr = wallet.toLowerCase();

  const { data: stats } = await supabase
    .from("player_stats")
    .select("points, wins, games_played, checkin_streak, total_checkins")
    .eq("wallet", addr)
    .single();

  // All games where this wallet is a player
  const { data: games } = await supabase
    .from("games")
    .select("id, player1, player2, winner, state, game_mode, wager_amount")
    .or(`player1.eq.${addr},player2.eq.${addr}`);

  const allGames = games || [];
  const finishedGames = allGames.filter(g => g.state === 3);
  const freeFinished = finishedGames.filter(
    g => g.game_mode === "offchain" || g.game_mode === "free" || g.game_mode === null
  );
  const freeWins = freeFinished.filter(g => g.winner === addr).length;

  // player_stats counts PvP (all modes) + onchain bot. Free PvP wins/games are in DB games.
  // Onchain = everything in player_stats minus free PvP.
  const totalWins = stats?.wins ?? 0;
  const totalGames = stats?.games_played ?? 0;
  const onchainWins = Math.max(0, totalWins - freeWins);
  const onchainGames = Math.max(0, totalGames - freeFinished.length);
  const onchainWinRate = onchainGames > 0 ? onchainWins / onchainGames : 0;

  // Net P&L from wager games:
  //  win  → prize (90% of pot) - own stake = +wager * 0.8
  //  lose → -wager
  const wagerFinished = finishedGames.filter(g => g.game_mode === "wager");
  const earningsMicro = wagerFinished.reduce((sum, g) => {
    const amt = g.wager_amount ?? 0;
    if (g.winner === addr) return sum + Math.floor(amt * 0.8);
    return sum - amt;
  }, 0);
  const earningsUsdc = earningsMicro / 1_000_000;

  // Count shots — get shot rows per game where this wallet was the shooter.
  let totalShots = 0;
  if (allGames.length > 0) {
    const gameIds = allGames.map(g => g.id);
    const { data: shotRows } = await supabase
      .from("shots")
      .select("game_id, player_num")
      .in("game_id", gameIds);
    if (shotRows) {
      const gameMap = new Map(
        allGames.map(g => [g.id, g.player1 === addr ? 1 : 2])
      );
      totalShots = shotRows.filter(
        s => gameMap.get(s.game_id) === s.player_num
      ).length;
    }
  }

  return {
    wallet: addr,
    points: stats?.points ?? 0,
    totalCheckins: stats?.total_checkins ?? 0,
    checkinStreak: stats?.checkin_streak ?? 0,
    totalWins,
    totalShots,
    onchainGames,
    onchainWins,
    onchainWinRate,
    earningsUsdc,
  };
}
