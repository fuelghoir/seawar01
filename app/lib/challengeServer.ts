import { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient, encodeAbiParameters, fallback, http, isAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { challengeAbi, CHALLENGE_CONTRACT_ADDRESS } from "../contracts/challengeAbi";
import { adminSupabase } from "./adminAuth";
import {
  awardReferralFirstGameBonusServer,
  awardReferralGamePointsServer,
} from "./referralServer";
import {
  ChallengeSettlement,
  ChallengeStatus,
  PublicChallenge,
  calculateChallengePayouts,
  computeBoardCommitment,
  isFinalChallengeStatus,
} from "./challengeShared";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BASE_RPCS = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
].filter(Boolean) as string[];

export const PUBLIC_CHALLENGE_SELECT = [
  "id",
  "stats_game_id",
  "onchain_challenge_id",
  "creator",
  "challenger",
  "creator_amount",
  "entry_fee",
  "max_moves",
  "board_commitment",
  "status",
  "winner",
  "moves_used",
  "hits",
  "creator_payout",
  "challenger_payout",
  "drop_fee",
  "cashout_bps",
  "created_at",
  "joined_at",
  "finished_at",
  "settled_at",
  "settled_tx_hash",
  "points_awarded",
].join(",");

export type ChallengeDbRow = {
  id: string;
  stats_game_id: number | null;
  onchain_challenge_id: number | string;
  creator: string;
  challenger: string | null;
  creator_amount: number | string;
  entry_fee: number | string;
  max_moves: number;
  board_commitment: `0x${string}`;
  status: ChallengeStatus;
  winner: string | null;
  moves_used: number | null;
  hits: number | null;
  creator_payout: number | string | null;
  challenger_payout: number | string | null;
  drop_fee: number | string | null;
  cashout_bps: number | null;
  created_at: string;
  joined_at: string | null;
  finished_at: string | null;
  settled_at: string | null;
  settled_tx_hash: string | null;
  points_awarded?: boolean | null;
};

export type OnchainChallenge = {
  creator: `0x${string}`;
  challenger: `0x${string}`;
  creatorAmount: bigint;
  entryFee: bigint;
  maxMoves: number;
  boardCommitment: `0x${string}`;
  joined: boolean;
  settled: boolean;
  winner: `0x${string}`;
};

const publicClient = createPublicClient({
  chain: base,
  transport: fallback(
    BASE_RPCS.map((url) => http(url, { retryCount: 0, timeout: 3_000 })),
    { retryCount: 0 },
  ),
});

export function challengeAdmin() {
  return adminSupabase();
}

export function toPublicChallenge(row: ChallengeDbRow): PublicChallenge {
  return {
    id: row.id,
    onchainChallengeId: Number(row.onchain_challenge_id),
    creator: row.creator,
    challenger: row.challenger,
    creatorAmount: String(row.creator_amount),
    entryFee: String(row.entry_fee),
    maxMoves: Number(row.max_moves),
    boardCommitment: row.board_commitment,
    status: row.status,
    winner: row.winner,
    movesUsed: Number(row.moves_used ?? 0),
    hits: Number(row.hits ?? 0),
    creatorPayout: String(row.creator_payout ?? "0"),
    challengerPayout: String(row.challenger_payout ?? "0"),
    dropFee: String(row.drop_fee ?? "0"),
    cashoutBps: Number(row.cashout_bps ?? 0),
    createdAt: row.created_at,
    joinedAt: row.joined_at,
    finishedAt: row.finished_at,
    settledAt: row.settled_at,
    settledTxHash: row.settled_tx_hash,
  };
}

export function parsePositiveMicroAmount(value: unknown, field: string): bigint {
  const raw = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${field} must be a positive integer`);
  const amount = BigInt(raw);
  if (amount <= BigInt(0)) throw new Error(`${field} must be greater than zero`);
  return amount;
}

export function parseMaxMoves(value: unknown): number {
  const moves = Number(value);
  if (!Number.isInteger(moves) || moves < 1 || moves > 25) {
    throw new Error("Max moves must be between 1 and 25");
  }
  return moves;
}

export async function getOnchainChallenge(challengeId: number): Promise<OnchainChallenge> {
  if (CHALLENGE_CONTRACT_ADDRESS.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("Challenge contract is not configured");
  }

  const result = await publicClient.readContract({
    address: CHALLENGE_CONTRACT_ADDRESS,
    abi: challengeAbi,
    functionName: "getChallenge",
    args: [BigInt(challengeId)],
  });

  const [
    creator,
    challenger,
    creatorAmount,
    entryFee,
    maxMoves,
    boardCommitment,
    joined,
    settled,
    winner,
  ] = result;

  return {
    creator,
    challenger,
    creatorAmount,
    entryFee,
    maxMoves: Number(maxMoves),
    boardCommitment,
    joined,
    settled,
    winner,
  };
}

export async function assertOnchainCreated(params: {
  challengeId: number;
  creator: string;
  creatorAmount: bigint;
  entryFee: bigint;
  maxMoves: number;
  board: number[];
  salt: string;
}) {
  const onchain = await getOnchainChallenge(params.challengeId);
  const commitment = computeBoardCommitment(params.board, params.salt);

  if (onchain.creator.toLowerCase() !== params.creator) throw new Error("Onchain creator mismatch");
  if (onchain.creatorAmount !== params.creatorAmount) throw new Error("Onchain reward mismatch");
  if (onchain.entryFee !== params.entryFee) throw new Error("Onchain entry fee mismatch");
  if (onchain.maxMoves !== params.maxMoves) throw new Error("Onchain max moves mismatch");
  if (onchain.boardCommitment.toLowerCase() !== commitment.toLowerCase()) {
    throw new Error("Onchain board commitment mismatch");
  }
  if (onchain.joined || onchain.settled) throw new Error("Challenge is no longer open");

  return commitment;
}

export async function assertOnchainJoined(params: {
  challengeId: number;
  challenger: string;
}) {
  const onchain = await getOnchainChallenge(params.challengeId);
  if (!onchain.joined) throw new Error("Onchain challenge is not joined");
  if (onchain.settled) throw new Error("Onchain challenge is already settled");
  if (onchain.challenger.toLowerCase() !== params.challenger) {
    throw new Error("Onchain challenger mismatch");
  }
}

export async function signChallengeSettlement(row: ChallengeDbRow): Promise<ChallengeSettlement | null> {
  const publicRow = toPublicChallenge(row);
  if (!isFinalChallengeStatus(publicRow.status) || !row.challenger) return null;
  if (!isAddress(row.creator) || !isAddress(row.challenger)) return null;

  const privateKey =
    process.env.CHALLENGE_SIGNER_PRIVATE_KEY ||
    process.env.DROP_CLAIM_SIGNER_PRIVATE_KEY ||
    "";
  if (!privateKey) throw new Error("CHALLENGE_SIGNER_PRIVATE_KEY is not configured");

  const account = privateKeyToAccount(
    (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`,
  );

  const hash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "bytes32" },
      ],
      [
        BigInt(base.id),
        CHALLENGE_CONTRACT_ADDRESS,
        "SEA_BATTLE_CHALLENGE_SETTLEMENT",
        BigInt(publicRow.onchainChallengeId),
        row.creator as `0x${string}`,
        row.challenger as `0x${string}`,
        publicRow.movesUsed,
        publicRow.hits,
        publicRow.maxMoves,
        row.board_commitment,
      ],
    ),
  );

  const signature = await account.signMessage({ message: { raw: hash } });
  return {
    onchainChallengeId: publicRow.onchainChallengeId,
    movesUsed: publicRow.movesUsed,
    hits: publicRow.hits,
    creatorPayout: publicRow.creatorPayout,
    challengerPayout: publicRow.challengerPayout,
    dropFee: publicRow.dropFee,
    cashoutBps: publicRow.cashoutBps,
    signature,
  };
}

export function challengePayoutPatch(row: ChallengeDbRow, hits: number) {
  const payout = calculateChallengePayouts(
    BigInt(row.creator_amount),
    BigInt(row.entry_fee),
    hits,
  );
  return {
    creator_payout: payout.creatorPayout.toString(),
    challenger_payout: payout.challengerPayout.toString(),
    drop_fee: payout.dropFee.toString(),
    cashout_bps: payout.cashoutBps,
  };
}

export async function awardChallengeRewards(
  admin: SupabaseClient,
  row: ChallengeDbRow,
  winner: string,
  hits: number,
) {
  const challenger = row.challenger;
  if (!challenger) return;

  const creatorWon = winner.toLowerCase() === row.creator.toLowerCase();
  const challengerWon = winner.toLowerCase() === challenger.toLowerCase();

  await Promise.all([
    bumpPlayerStats(admin, row.creator, {
      points: creatorWon ? 50 : 0,
      wins: creatorWon ? 1 : 0,
      gamesPlayed: 1,
      hits: 0,
    }),
    bumpPlayerStats(admin, challenger, {
      points: hits + (challengerWon ? 50 : 0),
      wins: challengerWon ? 1 : 0,
      gamesPlayed: 1,
      hits,
    }),
  ]);
}

export async function finalizeChallengeStatsGame(
  admin: SupabaseClient,
  row: ChallengeDbRow,
  winner: string,
  hits: number,
) {
  if (!row.stats_game_id) return;
  await admin
    .from("games")
    .update({
      state: 3,
      winner: winner.toLowerCase(),
      player1_hits: 0,
      player2_hits: hits,
    })
    .eq("id", row.stats_game_id);
}

async function bumpPlayerStats(
  admin: SupabaseClient,
  wallet: string,
  delta: { points: number; wins: number; gamesPlayed: number; hits: number },
) {
  const addr = wallet.toLowerCase();
  const multiplier = await getGamePointMultiplier(admin, addr);
  const points = Math.floor(Math.max(0, delta.points) * multiplier);

  const { data, error } = await admin
    .from("player_stats")
    .select("points,wins,games_played,total_hits")
    .eq("wallet", addr)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    const { error: updateError } = await admin
      .from("player_stats")
      .update({
        points: Number(data.points ?? 0) + points,
        wins: Number(data.wins ?? 0) + delta.wins,
        games_played: Number(data.games_played ?? 0) + delta.gamesPlayed,
        total_hits: Number(data.total_hits ?? 0) + delta.hits,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", addr);
    if (updateError) throw new Error(updateError.message);
  } else {
    const { error: insertError } = await admin.from("player_stats").insert({
      wallet: addr,
      points,
      wins: delta.wins,
      games_played: delta.gamesPlayed,
      total_hits: delta.hits,
    });
    if (insertError) throw new Error(insertError.message);
  }

  await addSeasonXp(admin, addr, Math.max(1, delta.points)).catch(() => {});
  await awardReferralGamePointsServer(admin, addr, points).catch(() => {});
  await awardReferralFirstGameBonusServer(admin, addr).catch(() => {});
}

async function getGamePointMultiplier(admin: SupabaseClient, wallet: string) {
  const { data } = await admin
    .from("player_boosters")
    .select("active_until")
    .eq("wallet", wallet)
    .eq("booster_slug", "double_points")
    .maybeSingle();
  return data?.active_until && new Date(String(data.active_until)).getTime() > Date.now() ? 2 : 1;
}

async function addSeasonXp(admin: SupabaseClient, wallet: string, xp: number) {
  if (xp <= 0) return;
  const seasonKey = "S1";
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
