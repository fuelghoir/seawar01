import type { SupabaseClient } from "@supabase/supabase-js";
import {
  awardReferralFirstGameBonusServer,
  awardReferralGamePointsServer,
} from "./referralServer";

export const BOT_STATS_OPPONENT = "0x0000000000000000000000000000000000000001";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const RESOLVABLE_MODES = new Set(["bot", "friend", "wager", "offchain", "free", "hybrid"]);

type GameStatsRow = {
  id: number;
  player1: string;
  player2: string | null;
  state: number;
  winner: string | null;
  game_mode: string | null;
  player1_hits: number | null;
  player2_hits: number | null;
};

type ShotHitRow = {
  player_num: number | null;
};

type ResolvedPlayer = {
  wallet: string;
  hits: number;
  won: boolean;
  points: number;
};

export type ResolveFinishedGameStatsResult = {
  gameId: number;
  alreadyResolved: boolean;
  players: ResolvedPlayer[];
};

export function normalizeStatsWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

export async function resolveFinishedGameStats(
  admin: SupabaseClient,
  gameIdValue: unknown,
  requestedWalletValue: unknown,
): Promise<ResolveFinishedGameStatsResult> {
  const gameId = Number(gameIdValue);
  if (!Number.isInteger(gameId) || gameId <= 0) throw new Error("Invalid game id");

  const requestedWallet = normalizeStatsWallet(requestedWalletValue);
  if (!requestedWallet) throw new Error("Invalid wallet");

  const { data: game, error: gameError } = await admin
    .from("games")
    .select("id,player1,player2,state,winner,game_mode,player1_hits,player2_hits")
    .eq("id", gameId)
    .maybeSingle();
  if (gameError) throw new Error(gameError.message);
  if (!game) throw new Error("Game not found");

  const row = game as GameStatsRow;
  if (row.state !== 3 || !row.winner) throw new Error("Game is not finished");

  const mode = row.game_mode ?? "friend";
  if (!RESOLVABLE_MODES.has(mode)) {
    throw new Error("This game mode resolves stats elsewhere");
  }

  const player1 = normalizeStatsWallet(row.player1);
  const player2 = normalizeStatsWallet(row.player2);
  const winner = normalizeStatsWallet(row.winner);
  if (!player1 || !winner || (row.player2 && !player2)) throw new Error("Game has invalid wallet data");
  if (winner !== player1 && winner !== player2) throw new Error("Winner is not a game player");
  if (requestedWallet !== player1 && requestedWallet !== player2) {
    throw new Error("Wallet is not a game player");
  }

  const { data: existingMarker, error: markerReadError } = await admin
    .from("resolved_games")
    .select("game_id")
    .eq("game_id", gameId)
    .maybeSingle();
  if (markerReadError) throw new Error(markerReadError.message);
  if (existingMarker) {
    return { gameId, alreadyResolved: true, players: [] };
  }

  const hitCounts = await getVerifiedHitCounts(admin, gameId);
  const player1Hits = Math.max(Number(row.player1_hits ?? 0), hitCounts[1] ?? 0);
  const player2Hits = Math.max(Number(row.player2_hits ?? 0), hitCounts[2] ?? 0);
  const winnerHits = winner === player1 ? player1Hits : player2Hits;
  if (winnerHits < 20) throw new Error("Winner does not have enough hits");

  const players = [
    { wallet: player1, hits: player1Hits, won: winner === player1 },
    player2 ? { wallet: player2, hits: player2Hits, won: winner === player2 } : null,
  ].filter((player): player is { wallet: string; hits: number; won: boolean } =>
    Boolean(player && player.wallet !== BOT_STATS_OPPONENT)
  );

  await ensurePlayerRows(admin, players.map((player) => player.wallet));

  const { error: markerInsertError } = await admin
    .from("resolved_games")
    .insert({ game_id: gameId });
  if (markerInsertError) {
    if (markerInsertError.code === "23505") {
      return { gameId, alreadyResolved: true, players: [] };
    }
    throw new Error(markerInsertError.message);
  }

  try {
    const resolvedPlayers: ResolvedPlayer[] = [];
    for (const player of players) {
      const rawPoints = player.hits + (player.won ? 50 : 0);
      const multiplier = await getGamePointMultiplier(admin, player.wallet);
      const points = Math.floor(rawPoints * multiplier);
      await bumpPlayerStats(admin, player.wallet, {
        points,
        wins: player.won ? 1 : 0,
        gamesPlayed: 1,
        hits: player.hits,
      });
      await addSeasonXp(admin, player.wallet, rawPoints).catch(() => {});
      await addSeasonLeaderboardPoints(admin, player.wallet, rawPoints).catch(() => {});
      await awardReferralGamePointsServer(admin, player.wallet, points).catch(() => {});
      await awardReferralFirstGameBonusServer(admin, player.wallet).catch(() => {});
      resolvedPlayers.push({ ...player, points });
    }
    return { gameId, alreadyResolved: false, players: resolvedPlayers };
  } catch (err) {
    await admin.from("resolved_games").delete().eq("game_id", gameId);
    throw err;
  }
}

async function getVerifiedHitCounts(admin: SupabaseClient, gameId: number) {
  const { data, error } = await admin
    .from("shots")
    .select("player_num")
    .eq("game_id", gameId)
    .eq("is_hit", true);
  if (error) throw new Error(error.message);

  return ((data || []) as ShotHitRow[]).reduce<Record<number, number>>((acc, row) => {
    const playerNum = Number(row.player_num);
    if (playerNum === 1 || playerNum === 2) acc[playerNum] = (acc[playerNum] ?? 0) + 1;
    return acc;
  }, {});
}

async function ensurePlayerRows(admin: SupabaseClient, wallets: string[]) {
  const rows = Array.from(new Set(wallets)).map((wallet) => ({
    wallet,
    points: 0,
    wins: 0,
    games_played: 0,
    total_hits: 0,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;

  const { error } = await admin
    .from("player_stats")
    .upsert(rows, { onConflict: "wallet", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

async function bumpPlayerStats(
  admin: SupabaseClient,
  wallet: string,
  delta: { points: number; wins: number; gamesPlayed: number; hits: number },
) {
  const { data, error } = await admin
    .from("player_stats")
    .select("points,wins,games_played,total_hits")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!data) {
    const { error: insertError } = await admin.from("player_stats").insert({
      wallet,
      points: delta.points,
      wins: delta.wins,
      games_played: delta.gamesPlayed,
      total_hits: delta.hits,
      updated_at: new Date().toISOString(),
    });
    if (insertError) throw new Error(insertError.message);
    return;
  }

  const { error: updateError } = await admin
    .from("player_stats")
    .update({
      points: Number(data.points ?? 0) + delta.points,
      wins: Number(data.wins ?? 0) + delta.wins,
      games_played: Number(data.games_played ?? 0) + delta.gamesPlayed,
      total_hits: Number(data.total_hits ?? 0) + delta.hits,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet", wallet);
  if (updateError) throw new Error(updateError.message);
}

async function getGamePointMultiplier(admin: SupabaseClient, wallet: string) {
  const { data, error } = await admin
    .from("player_boosters")
    .select("active_until")
    .eq("wallet", wallet)
    .eq("booster_slug", "double_points")
    .maybeSingle();
  if (error) return 1;
  return data?.active_until && new Date(String(data.active_until)).getTime() > Date.now() ? 2 : 1;
}

async function getActiveSeasonKey(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("season_config")
    .select("season_key")
    .eq("id", "default")
    .maybeSingle();
  return data?.season_key ?? "S1";
}

async function addSeasonXp(admin: SupabaseClient, wallet: string, xp: number) {
  if (xp <= 0) return;
  const seasonKey = await getActiveSeasonKey(admin);
  const { data, error } = await admin
    .from("season_progress")
    .select("xp,claimed_levels")
    .eq("wallet", wallet)
    .eq("season_key", seasonKey)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const { error: upsertError } = await admin
    .from("season_progress")
    .upsert(
      {
        wallet,
        season_key: seasonKey,
        xp: Number(data?.xp ?? 0) + Math.floor(xp),
        claimed_levels: Array.isArray(data?.claimed_levels) ? data.claimed_levels : [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet,season_key" },
    );
  if (upsertError) throw new Error(upsertError.message);
}

async function addSeasonLeaderboardPoints(admin: SupabaseClient, wallet: string, points: number) {
  if (points <= 0) return;
  const seasonKey = await getActiveSeasonKey(admin);
  const { data, error } = await admin
    .from("season_points")
    .select("points")
    .eq("wallet", wallet)
    .eq("season_key", seasonKey)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') return;

  const { error: _upsertError } = await admin
    .from("season_points")
    .upsert(
      {
        wallet,
        season_key: seasonKey,
        points: Number(data?.points ?? 0) + Math.floor(points),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet,season_key" }
    );
}
