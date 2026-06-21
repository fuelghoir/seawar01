import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../lib/adminSupabase";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const PAGE_SIZE = 1000;
const MAX_ROWS = 200_000;
const MIN_ELIGIBLE_POINTS = 3_000;
const MIN_ELIGIBLE_TRANSACTIONS = 10;

type PlayerStatsRow = {
  wallet?: string | null;
  points?: number | string | null;
  games_played?: number | string | null;
  total_checkins?: number | string | null;
};



function pointCount(row: PlayerStatsRow | null | undefined) {
  return Math.max(0, Math.floor(Number(row?.points ?? 0)));
}

function transactionCount(row: PlayerStatsRow | null | undefined) {
  return (
    Math.max(0, Math.floor(Number(row?.games_played ?? 0))) +
    Math.max(0, Math.floor(Number(row?.total_checkins ?? 0)))
  );
}

function isEligible(row: PlayerStatsRow | null | undefined) {
  return pointCount(row) >= MIN_ELIGIBLE_POINTS && transactionCount(row) >= MIN_ELIGIBLE_TRANSACTIONS;
}

export async function GET(req: NextRequest) {
  const wallet = String(req.nextUrl.searchParams.get("wallet") ?? "").trim().toLowerCase();
  if (!WALLET_RE.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for season estimate" },
      { status: 500 },
    );
  }

  try {
    const { data: player, error: playerError } = await admin
      .from("player_stats")
      .select("wallet,points,games_played,total_checkins")
      .eq("wallet", wallet)
      .maybeSingle();
    if (playerError) throw playerError;

    const walletPoints = pointCount(player);
    const walletTransactions = transactionCount(player);
    const eligible = isEligible(player);
    let totalPoints = 0;
    let eligiblePlayers = 0;
    let higherEligiblePlayers = 0;
    let scanned = 0;

    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from("player_stats")
        .select("wallet,points,games_played,total_checkins")
        .gte("points", MIN_ELIGIBLE_POINTS)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;

      const rows = data ?? [];
      scanned += rows.length;
      for (const row of rows) {
        if (!isEligible(row)) continue;
        const points = pointCount(row);
        totalPoints += points;
        eligiblePlayers += 1;
        if (eligible && points > walletPoints) higherEligiblePlayers += 1;
      }
      if (rows.length < PAGE_SIZE) break;
    }

    return NextResponse.json({
      walletPoints,
      walletTransactions,
      eligible,
      minPoints: MIN_ELIGIBLE_POINTS,
      minTransactions: MIN_ELIGIBLE_TRANSACTIONS,
      totalPoints,
      rank: eligible ? higherEligiblePlayers + 1 : null,
      eligiblePlayers,
      playersScanned: scanned,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not estimate season reward";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
