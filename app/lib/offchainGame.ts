import { supabase } from "./supabase";

// Create a new offchain game
export async function createOffchainGame(
  playerAddress: string,
  isPrivate: boolean
): Promise<number> {
  const { data, error } = await supabase
    .from("games")
    .insert({ player1: playerAddress.toLowerCase(), is_private: isPrivate })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// Join an offchain game
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

// Commit board hash
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

  // Check if both committed after this update
  const otherCommitted = isPlayer1
    ? game.player2_board_hash
    : game.player1_board_hash;
  if (otherCommitted) {
    updates.state = 2; // Active
  }

  const { error } = await supabase
    .from("games")
    .update(updates)
    .eq("id", gameId);
  if (error) throw new Error(error.message);
}

// Fire a shot
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

  // Check duplicate shot
  const { data: existing } = await supabase
    .from("shots")
    .select("id")
    .eq("game_id", gameId)
    .eq("player_num", playerNum)
    .eq("x", x)
    .eq("y", y)
    .limit(1);
  if (existing && existing.length > 0) throw new Error("Already shot here");

  // Insert shot
  await supabase.from("shots").insert({
    game_id: gameId,
    player_num: playerNum,
    x,
    y,
  });

  // Update game
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

// Report hit result
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
  // Reporter must be the opponent of lastShooter
  if (game.last_shooter === addr) throw new Error("Not the opponent");

  const shooterNum = game.player1 === game.last_shooter ? 1 : 2;

  // Update the shot record with hit result
  await supabase
    .from("shots")
    .update({ is_hit: isHit })
    .eq("game_id", gameId)
    .eq("player_num", shooterNum)
    .eq("x", x)
    .eq("y", y);

  // Update game state
  const updates: Record<string, unknown> = {
    turn_phase: 0,
    current_turn: game.current_turn === 1 ? 2 : 1,
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
  }

  const { error } = await supabase
    .from("games")
    .update(updates)
    .eq("id", gameId);
  if (error) throw new Error(error.message);
}

// Get available (open, public) games
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

// --- Onchain leaderboard ---

export async function recordOnchainResult(
  wallet: string,
  won: boolean,
  shots: number,
  hits: number
): Promise<void> {
  const addr = wallet.toLowerCase();
  const { data: existing } = await supabase
    .from("onchain_stats")
    .select("*")
    .eq("wallet", addr)
    .single();

  if (existing) {
    await supabase
      .from("onchain_stats")
      .update({
        games_played: existing.games_played + 1,
        wins: existing.wins + (won ? 1 : 0),
        total_shots: existing.total_shots + shots,
        total_hits: existing.total_hits + hits,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", addr);
  } else {
    await supabase.from("onchain_stats").insert({
      wallet: addr,
      games_played: 1,
      wins: won ? 1 : 0,
      total_shots: shots,
      total_hits: hits,
    });
  }
}

export interface LeaderboardEntry {
  wallet: string;
  games_played: number;
  wins: number;
  total_shots: number;
  total_hits: number;
  rating: number;
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data } = await supabase
    .from("onchain_stats")
    .select("*")
    .gte("games_played", 1)
    .order("wins", { ascending: false })
    .limit(50);

  if (!data) return [];

  return data.map((row) => {
    const winRate = row.games_played > 0 ? row.wins / row.games_played : 0;
    const accuracy = row.total_shots > 0 ? row.total_hits / row.total_shots : 0;
    // Rating: 60% win rate + 40% accuracy, scaled 0-100
    const rating = Math.round(winRate * 60 + accuracy * 40);
    return { ...row, rating };
  }).sort((a, b) => b.rating - a.rating);
}

// Get shots for a game by player
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
