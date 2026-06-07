import { NextRequest, NextResponse } from "next/server";
import {
  ChallengeDbRow,
  PUBLIC_CHALLENGE_SELECT,
  assertOnchainCreated,
  challengeAdmin,
  parseMaxMoves,
  parsePositiveMicroAmount,
  toPublicChallenge,
} from "../../lib/challengeServer";
import {
  normalizeBoard,
  normalizeWallet,
  isValidFleetBoard,
} from "../../lib/challengeShared";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
    const mine = req.nextUrl.searchParams.get("mine") === "1";
    const admin = challengeAdmin();

    let query = admin
      .from("challenge_games")
      .select(PUBLIC_CHALLENGE_SELECT)
      .order("created_at", { ascending: false })
      .limit(40);

    if (mine && wallet) {
      query = query.or(`creator.eq.${wallet},challenger.eq.${wallet}`).neq("status", "cancelled");
    } else {
      query = query.eq("status", "open");
      if (wallet) query = query.neq("creator", wallet);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      challenges: ((data || []) as unknown as ChallengeDbRow[]).map(toPublicChallenge),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load challenges" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const creator = normalizeWallet(body?.wallet ?? body?.creator);
    if (!creator) return NextResponse.json({ error: "Invalid creator wallet" }, { status: 400 });

    const board = normalizeBoard(body?.board);
    if (!board || !isValidFleetBoard(board)) {
      return NextResponse.json({ error: "Invalid fleet board" }, { status: 400 });
    }

    const salt = String(body?.salt ?? "").trim();
    if (salt.length < 12 || salt.length > 160) {
      return NextResponse.json({ error: "Invalid board salt" }, { status: 400 });
    }

    const onchainChallengeId = Number(body?.onchainChallengeId ?? body?.onchain_challenge_id);
    if (!Number.isInteger(onchainChallengeId) || onchainChallengeId <= 0) {
      return NextResponse.json({ error: "Invalid onchain challenge id" }, { status: 400 });
    }

    const creatorAmount = parsePositiveMicroAmount(body?.creatorAmount ?? body?.creator_amount, "Reward");
    const entryFee = parsePositiveMicroAmount(body?.entryFee ?? body?.entry_fee, "Entry fee");
    const maxMoves = parseMaxMoves(body?.maxMoves ?? body?.max_moves);

    const boardCommitment = await assertOnchainCreated({
      challengeId: onchainChallengeId,
      creator,
      creatorAmount,
      entryFee,
      maxMoves,
      board,
      salt,
    });

    const admin = challengeAdmin();
    const { data: existing } = await admin
      .from("challenge_games")
      .select(PUBLIC_CHALLENGE_SELECT)
      .eq("onchain_challenge_id", onchainChallengeId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ challenge: toPublicChallenge(existing as unknown as ChallengeDbRow) });
    }

    const { data: challenge, error } = await admin
      .from("challenge_games")
      .insert({
        onchain_challenge_id: onchainChallengeId,
        creator,
        creator_amount: creatorAmount.toString(),
        entry_fee: entryFee.toString(),
        max_moves: maxMoves,
        board_commitment: boardCommitment,
        status: "open",
      })
      .select(PUBLIC_CHALLENGE_SELECT)
      .single();

    if (error || !challenge) {
      return NextResponse.json({ error: error?.message || "Could not save challenge" }, { status: 500 });
    }

    const savedChallenge = challenge as unknown as ChallengeDbRow;
    const { error: boardError } = await admin.from("challenge_boards").insert({
      challenge_id: savedChallenge.id,
      board,
      salt,
    });
    if (boardError) {
      await admin.from("challenge_games").delete().eq("id", savedChallenge.id);
      return NextResponse.json({ error: boardError.message }, { status: 500 });
    }

    return NextResponse.json({ challenge: toPublicChallenge(savedChallenge) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create challenge" },
      { status: 500 },
    );
  }
}
