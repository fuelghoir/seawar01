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
  CHALLENGE_GRID_SIZE,
  CHALLENGE_TOTAL_SHIP_CELLS,
  normalizeBoard,
  normalizeWallet,
} from "../../../../lib/challengeShared";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

type ShotRow = {
  x: number;
  y: number;
  is_hit: boolean;
  created_at: string;
};

export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const challenger = normalizeWallet(body?.wallet);
    const x = Number(body?.x);
    const y = Number(body?.y);

    if (!challenger) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x >= CHALLENGE_GRID_SIZE ||
      y < 0 ||
      y >= CHALLENGE_GRID_SIZE
    ) {
      return NextResponse.json({ error: "Invalid shot" }, { status: 400 });
    }

    const admin = challengeAdmin();
    const [{ data: challenge, error }, { data: boardRow, error: boardError }] = await Promise.all([
      admin.from("challenge_games").select(PUBLIC_CHALLENGE_SELECT).eq("id", id).maybeSingle(),
      admin.from("challenge_boards").select("board").eq("challenge_id", id).maybeSingle(),
    ]);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (boardError) return NextResponse.json({ error: boardError.message }, { status: 500 });
    if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    if (!boardRow) return NextResponse.json({ error: "Challenge board not found" }, { status: 500 });

    const row = challenge as unknown as ChallengeDbRow;
    if (row.status !== "joined") {
      return NextResponse.json({ error: "Challenge is not active" }, { status: 409 });
    }
    if (!row.challenger || row.challenger !== challenger) {
      return NextResponse.json({ error: "Only the challenger can attack" }, { status: 403 });
    }

    const board = normalizeBoard(boardRow.board);
    if (!board) return NextResponse.json({ error: "Stored board is invalid" }, { status: 500 });

    const isHit = board[y * CHALLENGE_GRID_SIZE + x] === 1;
    const { error: insertError } = await admin.from("challenge_shots").insert({
      challenge_id: id,
      x,
      y,
      is_hit: isHit,
    });
    if (insertError) {
      const status = insertError.code === "23505" ? 409 : 500;
      return NextResponse.json({ error: insertError.message }, { status });
    }

    const { data: shots, error: shotsError } = await admin
      .from("challenge_shots")
      .select("x,y,is_hit,created_at")
      .eq("challenge_id", id)
      .order("created_at", { ascending: true });
    if (shotsError) return NextResponse.json({ error: shotsError.message }, { status: 500 });

    const shotRows = (shots || []) as ShotRow[];
    const movesUsed = shotRows.length;
    const hits = shotRows.filter((shot) => shot.is_hit === true).length;
    const challengerWon = hits >= CHALLENGE_TOTAL_SHIP_CELLS;
    const creatorWon = !challengerWon && movesUsed >= Number(row.max_moves);
    const winner = challengerWon ? row.challenger : creatorWon ? row.creator : null;

    const updates: Record<string, unknown> = {
      moves_used: movesUsed,
      hits,
    };
    if (winner) {
      updates.status = challengerWon ? "challenger_won" : "creator_won";
      updates.winner = winner;
      updates.finished_at = new Date().toISOString();
      Object.assign(updates, challengePayoutPatch(row, hits));
    }

    const { data: updated, error: updateError } = await admin
      .from("challenge_games")
      .update(updates)
      .eq("id", id)
      .select(PUBLIC_CHALLENGE_SELECT)
      .single();
    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || "Could not update challenge" },
        { status: 500 },
      );
    }

    const updatedRow = updated as unknown as ChallengeDbRow;
    if (winner && !row.points_awarded) {
      await finalizeChallengeStatsGame(admin, updatedRow, winner, hits);
      await awardChallengeRewards(admin, updatedRow, winner, hits);
      await admin.from("challenge_games").update({ points_awarded: true }).eq("id", id);
      updatedRow.points_awarded = true;
    }

    const settlement = winner ? await signChallengeSettlement(updatedRow) : null;
    return NextResponse.json({
      challenge: toPublicChallenge(updatedRow),
      shot: { x, y, isHit },
      shots: shotRows.map((shot) => ({
        x: Number(shot.x),
        y: Number(shot.y),
        isHit: shot.is_hit === true,
        createdAt: String(shot.created_at),
      })),
      settlement,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not fire shot" },
      { status: 500 },
    );
  }
}
