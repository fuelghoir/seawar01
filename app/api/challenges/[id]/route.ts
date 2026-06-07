import { NextRequest, NextResponse } from "next/server";
import {
  ChallengeDbRow,
  PUBLIC_CHALLENGE_SELECT,
  challengeAdmin,
  signChallengeSettlement,
  toPublicChallenge,
} from "../../../lib/challengeServer";
import { normalizeWallet } from "../../../lib/challengeShared";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

export async function GET(req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
    const admin = challengeAdmin();

    const { data, error } = await admin
      .from("challenge_games")
      .select(PUBLIC_CHALLENGE_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

    const row = data as unknown as ChallengeDbRow;
    const isParticipant =
      wallet && (row.creator === wallet || row.challenger === wallet);
    let shots: Array<{ x: number; y: number; isHit: boolean; createdAt: string }> = [];
    if (isParticipant) {
      const { data: shotRows, error: shotsError } = await admin
        .from("challenge_shots")
        .select("x,y,is_hit,created_at")
        .eq("challenge_id", id)
        .order("created_at", { ascending: true });
      if (shotsError) return NextResponse.json({ error: shotsError.message }, { status: 500 });
      shots = (shotRows || []).map((shot) => ({
        x: Number(shot.x),
        y: Number(shot.y),
        isHit: shot.is_hit === true,
        createdAt: String(shot.created_at),
      }));
    }

    const settlement = isParticipant ? await signChallengeSettlement(row) : null;
    return NextResponse.json({
      challenge: toPublicChallenge(row),
      shots,
      settlement,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load challenge" },
      { status: 500 },
    );
  }
}
