import { adminSupabase } from "./adminSupabase";
import { normalizePublicWallet } from "./publicUrl";

export type ShareProfileStats = {
  wallet: string;
  points: number;
  wins: number;
  games: number;
  shots: number;
  streak: number;
  checkins: number;
  earningsUsdc: number;
};

type GameRow = {
  id: number;
  player1: string;
  player2: string | null;
  winner: string | null;
  state: number;
  game_mode: string | null;
  wager_amount: number | null;
};



export function emptyShareProfile(wallet: string): ShareProfileStats {
  return {
    wallet: normalizePublicWallet(wallet) ?? wallet.toLowerCase(),
    points: 0,
    wins: 0,
    games: 0,
    shots: 0,
    streak: 0,
    checkins: 0,
    earningsUsdc: 0,
  };
}

export async function getShareProfileStats(wallet: string): Promise<ShareProfileStats> {
  const addr = normalizePublicWallet(wallet);
  if (!addr) return emptyShareProfile(wallet);

  const admin = adminSupabase();
  if (!admin) return emptyShareProfile(addr);

  const [{ data: stats }, { data: games }] = await Promise.all([
    admin
      .from("player_stats")
      .select("points,wins,games_played,checkin_streak,total_checkins")
      .eq("wallet", addr)
      .maybeSingle(),
    admin
      .from("games")
      .select("id,player1,player2,winner,state,game_mode,wager_amount")
      .or(`player1.eq.${addr},player2.eq.${addr}`),
  ]);

  const allGames = ((games || []) as GameRow[]).filter((game) => Number.isFinite(Number(game.id)));
  const finishedGames = allGames.filter((game) => Number(game.state) === 3);
  const wagerFinished = finishedGames.filter((game) => game.game_mode === "wager");
  const earningsMicro = wagerFinished.reduce((sum, game) => {
    const amount = Number(game.wager_amount ?? 0);
    return game.winner === addr ? sum + Math.floor(amount * 0.8) : sum - amount;
  }, 0);

  const playerOneGameIds = allGames
    .filter((game) => game.player1 === addr)
    .map((game) => game.id);
  const playerTwoGameIds = allGames
    .filter((game) => game.player2 === addr)
    .map((game) => game.id);

  const [playerOneShots, playerTwoShots] = await Promise.all([
    countShots(admin, playerOneGameIds, 1),
    countShots(admin, playerTwoGameIds, 2),
  ]);

  return {
    wallet: addr,
    points: Number(stats?.points ?? 0),
    wins: Number(stats?.wins ?? 0),
    games: Number(stats?.games_played ?? finishedGames.length),
    shots: playerOneShots + playerTwoShots,
    streak: Number(stats?.checkin_streak ?? 0),
    checkins: Number(stats?.total_checkins ?? 0),
    earningsUsdc: earningsMicro / 1_000_000,
  };
}

async function countShots(
  admin: NonNullable<ReturnType<typeof adminSupabase>>,
  gameIds: number[],
  playerNum: number,
) {
  if (gameIds.length === 0) return 0;
  const { count, error } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .in("game_id", gameIds)
    .eq("player_num", playerNum);
  if (error) return 0;
  return count ?? 0;
}
