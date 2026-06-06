import { supabase } from "./supabase";
import { addSeasonXp, consumeItem, getGamePointMultiplier, getItemQuantity } from "./season";
import { awardFirstGameReferralBonus } from "./referrals";

export const BOT_STATS_OPPONENT = "0x0000000000000000000000000000000000000001";
const V7_WAGER_LAUNCHED_AT = "2026-06-02T16:02:21.000Z";

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

export async function createBotStatsGame(playerAddress: string): Promise<number> {
  const { data, error } = await supabase
    .from("games")
    .insert({
      player1: playerAddress.toLowerCase(),
      player2: BOT_STATS_OPPONENT,
      state: 2,
      current_turn: 1,
      turn_phase: 0,
      is_private: true,
      game_mode: "bot",
      wager_amount: 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return Number(data.id);
}

export async function recordBotStatsShots(
  gameId: number,
  shots: Array<{ x: number; y: number; isHit?: boolean }>
): Promise<void> {
  if (shots.length === 0) return;
  const { error } = await supabase.from("shots").insert(
    shots.map((shot) => ({
      game_id: gameId,
      player_num: 1,
      x: shot.x,
      y: shot.y,
      is_hit: shot.isHit ?? null,
    }))
  );
  if (error) throw new Error(error.message);
}

export async function finishBotStatsGame(
  gameId: number,
  playerAddress: string,
  won: boolean,
  playerHits: number,
  botHits: number
): Promise<void> {
  const addr = playerAddress.toLowerCase();
  const { error } = await supabase
    .from("games")
    .update({
      state: 3,
      winner: won ? addr : BOT_STATS_OPPONENT,
      player1_hits: playerHits,
      player2_hits: botHits,
    })
    .eq("id", gameId)
    .eq("player1", addr)
    .eq("game_mode", "bot");

  if (error) throw new Error(error.message);
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
 * Wager games created by `wallet`, still unjoined, and old enough for the
 * contract's three-minute refund delay.
 */
export async function getRefundableGames(wallet: string): Promise<RefundableGame[]> {
  const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("games")
    .select("id, onchain_game_id, wager_amount, created_at")
    .eq("player1", wallet.toLowerCase())
    .eq("game_mode", "wager")
    .eq("state", 0)
    .is("player2", null)
    .not("onchain_game_id", "is", null)
    .gt("wager_amount", 0)
    .gte("created_at", V7_WAGER_LAUNCHED_AT)
    .lt("created_at", cutoff)
    .order("id", { ascending: false });
  return (data || []) as RefundableGame[];
}

export interface ActiveWagerGame extends RefundableGame {
  player1: string;
  player2: string | null;
  state: number;
}

/**
 * Return unfinished wager rooms for reconnect and joined-game timeout checks.
 * Contract state is checked separately by the caller before presenting actions.
 */
export async function getActiveWagerGames(wallet: string): Promise<ActiveWagerGame[]> {
  const addr = wallet.toLowerCase();
  const { data } = await supabase
    .from("games")
    .select("id, onchain_game_id, wager_amount, created_at, player1, player2, state")
    .eq("game_mode", "wager")
    .in("state", [0, 1, 2])
    .or(`player1.eq.${addr},player2.eq.${addr}`)
    .not("onchain_game_id", "is", null)
    .gt("wager_amount", 0)
    .gte("created_at", V7_WAGER_LAUNCHED_AT)
    .order("id", { ascending: false });
  return (data || []) as ActiveWagerGame[];
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
    .gte("created_at", V7_WAGER_LAUNCHED_AT)
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

export interface ResolvedShotResult {
  resolved: boolean;
  x: number;
  y: number;
  isHit: boolean | null;
  currentTurn?: number;
  player1Hits?: number;
  player2Hits?: number;
  state?: number;
  winner?: string | null;
}

export async function shootAndResolveOffchain(
  gameId: number,
  playerAddress: string,
  x: number,
  y: number
): Promise<ResolvedShotResult> {
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

  const opponentBoardStr = playerNum === 1 ? game.player2_board : game.player1_board;
  if (!opponentBoardStr) {
    await shootOffchain(gameId, playerAddress, x, y);
    return { resolved: false, x, y, isHit: null };
  }

  let opponentBoard: number[];
  try {
    opponentBoard = JSON.parse(opponentBoardStr) as number[];
  } catch {
    await shootOffchain(gameId, playerAddress, x, y);
    return { resolved: false, x, y, isHit: null };
  }

  const isHit = opponentBoard[y * 10 + x] === 1;
  const player1Hits = Number(game.player1_hits ?? 0) + (playerNum === 1 && isHit ? 1 : 0);
  const player2Hits = Number(game.player2_hits ?? 0) + (playerNum === 2 && isHit ? 1 : 0);
  const nextTurn = isHit ? game.current_turn : (game.current_turn === 1 ? 2 : 1);
  const finished = isHit && (playerNum === 1 ? player1Hits : player2Hits) >= 20;
  const winner = finished ? addr : game.winner ?? null;

  const { error: shotError } = await supabase.from("shots").insert({
    game_id: gameId,
    player_num: playerNum,
    x,
    y,
    is_hit: isHit,
  });
  if (shotError) throw new Error(shotError.message);

  const updates: Record<string, unknown> = {
    last_shot_x: x,
    last_shot_y: y,
    last_shooter: addr,
    turn_phase: 0,
    current_turn: nextTurn,
    player1_hits: player1Hits,
    player2_hits: player2Hits,
  };
  if (finished) {
    updates.state = 3;
    updates.winner = winner;
  }

  const { error: updateError } = await supabase
    .from("games")
    .update(updates)
    .eq("id", gameId);
  if (updateError) throw new Error(updateError.message);

  if (isHit) {
    if (finished) {
      const loserAddr = winner === game.player1 ? game.player2 : game.player1;
      addPoints(addr, 51, 1)
        .then(() => recordGameResult(addr, true))
        .then(() => recordGameResult(loserAddr, false))
        .catch(() => {});
    } else {
      addPoints(addr, 1, 1).catch(() => {});
    }
  }

  return {
    resolved: true,
    x,
    y,
    isHit,
    currentTurn: nextTurn,
    player1Hits,
    player2Hits,
    state: finished ? 3 : game.state,
    winner,
  };
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

  const volleyRaw = game.bomb_shots_remaining ?? 0;
  const isBombShot = volleyRaw > 0;
  const isLineShot = volleyRaw < 0;
  const lineCode = Math.abs(volleyRaw);
  const lineTotal = Math.floor(lineCode / 10);
  const lineRemaining = lineCode % 10;

  let nextTurn = game.current_turn;
  if (isBombShot) {
    // During bomb: always keep current player's turn
    // On last bomb shot: switch turn
    if (volleyRaw <= 1) {
      nextTurn = game.current_turn === 1 ? 2 : 1;
    }
  } else if (isLineShot) {
    // Torpedo line: resolve the whole line, then keep turn only if every
    // line cell hit. This preserves the regular Battleship "hit keeps turn"
    // feel for a perfect torpedo.
    if (lineRemaining <= 1) {
      const { data: recentLineShots } = await supabase
        .from("shots")
        .select("is_hit")
        .eq("game_id", gameId)
        .eq("player_num", shooterNum)
        .order("created_at", { ascending: false })
        .limit(lineTotal);

      const allLineHits =
        (recentLineShots?.length ?? 0) >= lineTotal &&
        (recentLineShots || []).every((shot) => shot.is_hit === true);
      nextTurn = allLineHits ? game.current_turn : (game.current_turn === 1 ? 2 : 1);
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
    updates.bomb_shots_remaining = volleyRaw - 1;
  }
  if (isLineShot) {
    updates.bomb_shots_remaining =
      lineRemaining <= 1 ? 0 : -(lineTotal * 10 + (lineRemaining - 1));
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
      addPoints(shooterAddr, 51, 1) // +1 hit + 50 win combined, hits=1
        .then(() => recordGameResult(shooterAddr, true))
        .then(() => recordGameResult(loserAddr, false))
        .catch(() => {});
    } else {
      // Regular hit: +1 point, track hit
      addPoints(shooterAddr, 1, 1).catch(() => {});
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

  // Set bomb_shots_remaining = total cells (including first shot's pending report).
  // Also flip bomb_used_p<N> = true so the off-chain inventory reflects this
  // bomb being consumed (V5 inventory model — see scripts/supabase-v5-bomb-inventory.sql).
  await supabase
    .from("games")
    .update({
      last_shot_x: first.x,
      last_shot_y: first.y,
      last_shooter: addr,
      turn_phase: 1,
      bomb_shots_remaining: newCells.length,
      [playerNum === 1 ? "bomb_used_p1" : "bomb_used_p2"]: true,
    })
    .eq("id", gameId);

  return newCells.length;
}

export async function shootLineOffchain(
  gameId: number,
  playerAddress: string,
  cells: { x: number; y: number }[]
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

  const validCells = cells.filter(({ x, y }) => x >= 0 && x < 10 && y >= 0 && y < 10);
  if (validCells.length === 0) throw new Error("No cells to fire");

  const { data: existingShots } = await supabase
    .from("shots")
    .select("x, y")
    .eq("game_id", gameId)
    .eq("player_num", playerNum);
  const shotSet = new Set((existingShots || []).map(s => `${s.x},${s.y}`));
  const newCells = validCells.filter(c => !shotSet.has(`${c.x},${c.y}`));

  if (newCells.length === 0) throw new Error("All cells already shot");

  const first = newCells[0];
  await supabase.from("shots").insert({
    game_id: gameId,
    player_num: playerNum,
    x: first.x,
    y: first.y,
  });

  // Reuse the existing volley counter so hit reports keep the same shooter
  // until every line cell has resolved.
  const { error } = await supabase
    .from("games")
    .update({
      last_shot_x: first.x,
      last_shot_y: first.y,
      last_shooter: addr,
      turn_phase: 1,
      bomb_shots_remaining: -(newCells.length * 10 + newCells.length),
    })
    .eq("id", gameId);
  if (error) throw new Error(error.message);

  return newCells.length;
}

/// Count of games where this wallet has fired a bomb (V5 inventory:
/// bombs_available = contract.bombs(addr) - this).
export async function getBombsUsedCount(wallet: string): Promise<number> {
  const addr = wallet.toLowerCase();
  const [{ count: usedAsP1 }, { count: usedAsP2 }] = await Promise.all([
    supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("player1", addr)
      .gte("created_at", V7_WAGER_LAUNCHED_AT)
      .eq("bomb_used_p1", true),
    supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("player2", addr)
      .gte("created_at", V7_WAGER_LAUNCHED_AT)
      .eq("bomb_used_p2", true),
  ]);
  return (usedAsP1 || 0) + (usedAsP2 || 0);
}

export async function getAvailableGames(
  excludeAddress?: string,
  mode?: "friend" | "wager"
): Promise<{ id: number; player1: string; game_mode: string; wager_amount: number }[]> {
  let query = supabase
    .from("games")
    .select("id, player1, game_mode, wager_amount, created_at")
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
  // Friend mode lists rows persisted under legacy game_mode names too:
  // "offchain" (V3 default), "free" (very legacy), "hybrid" (removed in V4).
  if (mode === "friend") {
    return rows.filter(
      r => r.game_mode === "offchain"
        || r.game_mode === "free"
        || r.game_mode === "hybrid"
        || r.game_mode === "friend"
    );
  }
  return rows.filter(
    r => r.game_mode === mode && r.created_at >= V7_WAGER_LAUNCHED_AT
  );
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
  points: number,
  hits = 0,
): Promise<void> {
  const addr = wallet.toLowerCase();
  const multiplier = await getGamePointMultiplier(addr).catch(() => 1);
  const awardedPoints = Math.floor(points * multiplier);
  const { data: existing, error: existingError } = await supabase
    .from("player_stats")
    .select("points, total_hits")
    .eq("wallet", addr)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    const updates: Record<string, unknown> = {
      points: existing.points + awardedPoints,
      updated_at: new Date().toISOString(),
    };
    if (hits > 0) updates.total_hits = (existing.total_hits ?? 0) + hits;
    const { error } = await supabase
      .from("player_stats")
      .update(updates)
      .eq("wallet", addr);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("player_stats").insert({
      wallet: addr,
      points: awardedPoints,
      ...(hits > 0 ? { total_hits: hits } : {}),
    });
    if (error) throw new Error(error.message);
  }

  await addSeasonXp(addr, Math.max(1, points)).catch(() => {});

  // Award 10% of points to referrer (fire-and-forget, doesn't block game flow)
  if (awardedPoints > 0) {
    const share = Math.floor(awardedPoints * 0.1);
    if (share > 0) {
      Promise.resolve(
        supabase.from("referrals").select("referrer").eq("referee", addr).single()
      ).then(({ data: ref }) => {
        if (!ref?.referrer) return;
        const referrer = ref.referrer as string;
        return Promise.resolve(
          supabase.from("player_stats").select("points").eq("wallet", referrer).single()
        ).then(({ data: rs }) => {
          if (rs) {
            return supabase.from("player_stats").update({
              points: rs.points + share,
              updated_at: new Date().toISOString(),
            }).eq("wallet", referrer);
          } else {
            return supabase.from("player_stats").insert({ wallet: referrer, points: share });
          }
        });
      }).catch(() => {});
    }
  }
}

/** Record win/loss stats only (points are added separately via addPoints). */
export async function recordGameResult(
  wallet: string,
  won: boolean
): Promise<void> {
  const addr = wallet.toLowerCase();
  const { data: existing, error: existingError } = await supabase
    .from("player_stats")
    .select("*")
    .eq("wallet", addr)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const isFirstGame = !existing || existing.games_played === 0;

  if (existing) {
    const { error } = await supabase
      .from("player_stats")
      .update({
        games_played: existing.games_played + 1,
        wins: existing.wins + (won ? 1 : 0),
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", addr);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("player_stats").insert({
      wallet: addr,
      games_played: 1,
      wins: won ? 1 : 0,
    });
    if (error) throw new Error(error.message);
  }

  // On first game ever: award 1000 pts referral bonus to whoever invited this player
  if (isFirstGame) {
    await awardFirstGameReferralBonus(addr);
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
  const { data, error } = await supabase
    .from("player_stats")
    .select("checkin_streak, last_checkin")
    .eq("wallet", addr)
    .maybeSingle();

  if (error) throw new Error(error.message);

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

  if (streak === 0 && (data.checkin_streak ?? 0) > 0) {
    const freezeQty = await getItemQuantity(addr, "streak_freeze").catch(() => 0);
    if (freezeQty > 0) {
      return {
        canCheckin: true,
        streak: data.checkin_streak,
        nextReward: getCheckinReward(data.checkin_streak + 1),
      };
    }
  }

  return {
    canCheckin: true,
    streak,
    nextReward: getCheckinReward(streak + 1),
  };
}

export async function dailyCheckin(
  wallet: string
): Promise<{ points: number; streak: number; usedFreeze?: boolean }> {
  const addr = wallet.toLowerCase();
  const today = todayUTC();
  const yesterday = yesterdayUTC();

  const { data: existing, error: existingError } = await supabase
    .from("player_stats")
    .select("*")
    .eq("wallet", addr)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  let newStreak: number;

  if (!existing) {
    newStreak = 1;
    const reward = getCheckinReward(newStreak);
    const { error: insertError } = await supabase.from("player_stats").insert({
      wallet: addr,
      points: reward,
      checkin_streak: newStreak,
      last_checkin: today,
      total_checkins: 1,
    });
    if (insertError) throw new Error(insertError.message);
    await addSeasonXp(addr, 20);
    return { points: reward, streak: newStreak };
  }

  if (existing.last_checkin === today) {
    throw new Error("Already checked in today");
  }

  let usedFreeze = false;
  if (existing.last_checkin === yesterday) {
    newStreak = existing.checkin_streak + 1;
  } else if ((existing.checkin_streak ?? 0) > 0) {
    try {
      await consumeItem(addr, "streak_freeze", 1);
      usedFreeze = true;
      newStreak = existing.checkin_streak + 1;
    } catch {
      newStreak = 1;
    }
  } else {
    newStreak = 1;
  }

  const reward = getCheckinReward(newStreak);

  const { error: updateError } = await supabase
    .from("player_stats")
    .update({
      points: existing.points + reward,
      checkin_streak: newStreak,
      last_checkin: today,
      total_checkins: (existing.total_checkins ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet", addr);

  if (updateError) throw new Error(updateError.message);
  await addSeasonXp(addr, 20);
  return { points: reward, streak: newStreak, usedFreeze };
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

export const LEADERBOARD_PAGE_SIZE = 50;

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getLeaderboard(
  page = 1,
  pageSize = LEADERBOARD_PAGE_SIZE
): Promise<LeaderboardPage> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  const { data, count } = await supabase
    .from("player_stats")
    .select("wallet, points, wins, games_played, total_hits, checkin_streak", { count: "exact" })
    .gt("points", 0)
    .order("points", { ascending: false })
    .range(from, to);

  const total = count ?? 0;

  return {
    entries: (data as LeaderboardEntry[]) || [],
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
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

  const [{ data: stats }, { data: games }] = await Promise.all([
    supabase
      .from("player_stats")
      .select("points, wins, games_played, checkin_streak, total_checkins")
      .eq("wallet", addr)
      .single(),
    supabase
      .from("games")
      .select("id, player1, player2, winner, state, game_mode, wager_amount")
      .or(`player1.eq.${addr},player2.eq.${addr}`),
  ]);

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
  const countShots = async (gameIds: number[], playerNum: number) => {
    if (gameIds.length === 0) return 0;
    const { count } = await supabase
      .from("shots")
      .select("id", { count: "exact", head: true })
      .in("game_id", gameIds)
      .eq("player_num", playerNum);
    return count ?? 0;
  };
  const [playerOneShots, playerTwoShots] = await Promise.all([
    countShots(allGames.filter((game) => game.player1 === addr).map((game) => game.id), 1),
    countShots(allGames.filter((game) => game.player2 === addr).map((game) => game.id), 2),
  ]);
  const totalShots = playerOneShots + playerTwoShots;

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

// ─── Game History ───

export interface GameHistoryEntry {
  id: number;
  opponent: string | null;
  result: "win" | "loss";
  mode: string;
  wager: number;
  date: string;
}

export async function getPlayerGameHistory(wallet: string): Promise<GameHistoryEntry[]> {
  const addr = wallet.toLowerCase();
  const { data } = await supabase
    .from("games")
    .select("id, player1, player2, winner, game_mode, wager_amount, created_at")
    .or(`player1.eq.${addr},player2.eq.${addr}`)
    .eq("state", 3)
    .order("id", { ascending: false })
    .limit(10);

  return (data || []).map(g => ({
    id: g.id,
    opponent: g.player1 === addr ? g.player2 : g.player1,
    result: (g.winner === addr ? "win" : "loss") as "win" | "loss",
    mode: g.game_mode || "friend",
    wager: g.wager_amount || 0,
    date: g.created_at,
  }));
}
