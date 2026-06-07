import { NextRequest, NextResponse } from "next/server";
import { isHash } from "viem";
import {
  ChallengeDbRow,
  PUBLIC_CHALLENGE_SELECT,
  challengeAdmin,
  toPublicChallenge,
} from "../../../../lib/challengeServer";
import { isFinalChallengeStatus, normalizeWallet } from "../../../../lib/challengeShared";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const wallet = normalizeWallet(body?.wallet);
    const txHash = String(body?.txHash ?? body?.tx_hash ?? "").trim().toLowerCase();
    if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    if (!isHash(txHash)) return NextResponse.json({ error: "Invalid tx hash" }, { status: 400 });

    const admin = challengeAdmin();
    const { data, error } = await admin
      .from("challenge_games")
      .select(PUBLIC_CHALLENGE_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

    const row = data as unknown as ChallengeDbRow;
    const isParticipant = row.creator === wallet || row.challenger === wallet;
    if (!isParticipant) return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    if (!isFinalChallengeStatus(row.status)) {
      return NextResponse.json({ error: "Challenge is not finished" }, { status: 409 });
    }

    const { data: updated, error: updateError } = await admin
      .from("challenge_games")
      .update({
        status: "settled",
        settled_tx_hash: txHash,
        settled_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(PUBLIC_CHALLENGE_SELECT)
      .single();
    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || "Could not mark settled" },
        { status: 500 },
      );
    }

    return NextResponse.json({ challenge: toPublicChallenge(updated as unknown as ChallengeDbRow) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not mark settled" },
      { status: 500 },
    );
  }
}
