import { NextRequest, NextResponse } from "next/server";
import {
  ChallengeDbRow,
  PUBLIC_CHALLENGE_SELECT,
  awardChallengeRewards,
  challengePayoutPatch,
  challengeAdmin,
  finalizeChallengeStatsGame,
  signChallengeSettlement,
  toPublicChallenge,
} from "../../../../lib/challengeServer";
import {
  CHALLENGE_TOTAL_SHIP_CELLS,
  normalizeWallet,
} from "../../../../lib/challengeShared";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

type ShotRow = {
  is_hit: boolean;
};

export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const challenger = normalizeWallet(body?.wallet);
    if (!challenger) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

    const admin = challengeAdmin();
    const { data, error } = await admin
      .from("challenge_games")
      .select(PUBLIC_CHALLENGE_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

    const row = data as unknown as ChallengeDbRow;
    if (row.status !== "joined") {
      return NextResponse.json({ error: "Challenge is not active" }, { status: 409 });
    }
    if (!row.challenger || row.challenger !== challenger) {
      return NextResponse.json({ error: "Only the challenger can cash out" }, { status: 403 });
    }

    const { data: shots, error: shotsError } = await admin
      .from("challenge_shots")
      .select("is_hit")
      .eq("challenge_id", id);
    if (shotsError) return NextResponse.json({ error: shotsError.message }, { status: 500 });

    const shotRows = (shots || []) as ShotRow[];
    const movesUsed = shotRows.length;
    const hits = shotRows.filter((shot) => shot.is_hit === true).length;
    if (movesUsed <= 0) {
      return NextResponse.json({ error: "Fire at least one shot before cashout" }, { status: 400 });
    }

    const challengerWon = hits >= CHALLENGE_TOTAL_SHIP_CELLS;
    const winner = challengerWon ? row.challenger : row.creator;
    const status = challengerWon ? "challenger_won" : "cashed_out";
    const payoutPatch = challengePayoutPatch(row, hits);

    const { data: updated, error: updateError } = await admin
      .from("challenge_games")
      .update({
        status,
        winner,
        moves_used: movesUsed,
        hits,
        finished_at: new Date().toISOString(),
        ...payoutPatch,
      })
      .eq("id", id)
      .select(PUBLIC_CHALLENGE_SELECT)
      .single();
    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || "Could not cash out challenge" },
        { status: 500 },
      );
    }

    const updatedRow = updated as unknown as ChallengeDbRow;
    if (!row.points_awarded) {
      await finalizeChallengeStatsGame(admin, updatedRow, winner, hits);
      await awardChallengeRewards(admin, updatedRow, winner, hits);
      await admin.from("challenge_games").update({ points_awarded: true }).eq("id", id);
      updatedRow.points_awarded = true;
    }

    const settlement = await signChallengeSettlement(updatedRow);
    return NextResponse.json({
      challenge: toPublicChallenge(updatedRow),
      settlement,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not cash out" },
      { status: 500 },
    );
  }
}
