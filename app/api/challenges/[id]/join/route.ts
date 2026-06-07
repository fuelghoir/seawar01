import { NextRequest, NextResponse } from "next/server";
import {
  ChallengeDbRow,
  PUBLIC_CHALLENGE_SELECT,
  assertOnchainJoined,
  challengeAdmin,
  toPublicChallenge,
} from "../../../../lib/challengeServer";
import { normalizeWallet } from "../../../../lib/challengeShared";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const challenger = normalizeWallet(body?.wallet ?? body?.challenger);
    if (!challenger) return NextResponse.json({ error: "Invalid challenger wallet" }, { status: 400 });

    const admin = challengeAdmin();
    const { data, error } = await admin
      .from("challenge_games")
      .select(PUBLIC_CHALLENGE_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

    const row = data as unknown as ChallengeDbRow;
    if (row.creator === challenger) {
      return NextResponse.json({ error: "Creator cannot join own challenge" }, { status: 400 });
    }
    if (row.challenger && row.challenger !== challenger) {
      return NextResponse.json({ error: "Challenge already has a challenger" }, { status: 409 });
    }
    if (row.status !== "open" && row.challenger === challenger) {
      return NextResponse.json({ challenge: toPublicChallenge(row) });
    }
    if (row.status !== "open") {
      return NextResponse.json({ error: "Challenge is not open" }, { status: 409 });
    }

    await assertOnchainJoined({
      challengeId: Number(row.onchain_challenge_id),
      challenger,
    });

    let statsGameId = row.stats_game_id;
    if (!statsGameId) {
      const pot = BigInt(row.creator_amount) + BigInt(row.entry_fee);
      const { data: statsGame, error: statsError } = await admin
        .from("games")
        .insert({
          player1: row.creator,
          player2: challenger,
          state: 2,
          current_turn: 2,
          turn_phase: 0,
          is_private: false,
          game_mode: "challenge",
          onchain_game_id: Number(row.onchain_challenge_id),
          wager_amount: Number(pot),
        })
        .select("id")
        .single();
      if (statsError || !statsGame) {
        return NextResponse.json(
          { error: statsError?.message || "Could not create stats game" },
          { status: 500 },
        );
      }
      statsGameId = Number(statsGame.id);
    }

    const { data: updated, error: updateError } = await admin
      .from("challenge_games")
      .update({
        challenger,
        status: "joined",
        joined_at: new Date().toISOString(),
        stats_game_id: statsGameId,
      })
      .eq("id", id)
      .select(PUBLIC_CHALLENGE_SELECT)
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || "Could not join challenge" },
        { status: 500 },
      );
    }

    return NextResponse.json({ challenge: toPublicChallenge(updated as unknown as ChallengeDbRow) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not join challenge" },
      { status: 500 },
    );
  }
}
