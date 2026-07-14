import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { grantRawPointsServer, normalizeSeasonWallet } from "../../../lib/seasonServer";

export const runtime = "nodejs";

const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeSeasonWallet(body?.wallet);
  if (!wallet) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  try {
    const admin = adminSupabase();

    // 1. Check if user already claimed and check cooldown
    const { data: claim, error: fetchError } = await admin
      .from("easter_egg_claims")
      .select("last_claimed_at, usd_eligible, total_claims")
      .eq("wallet", wallet)
      .maybeSingle();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (claim) {
      const lastClaimed = new Date(claim.last_claimed_at).getTime();
      const elapsed = Date.now() - lastClaimed;
      if (elapsed < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - elapsed;
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        return NextResponse.json(
          { error: `Cooldown active. Try again in ${remainingDays} day(s).` },
          { status: 400 }
        );
      }
    }

    // 2. Determine points reward: random between 1,000 and 10,000 points
    const points = Math.floor(Math.random() * (10000 - 1000 + 1)) + 1000;

    // 3. Fetch settings/config
    const { data: config } = await admin
      .from("easter_egg_config")
      .select("max_winners, reward_amount_raw")
      .eq("id", "default")
      .maybeSingle();

    const maxWinners = config?.max_winners ?? 1;
    const rewardAmountRaw = config?.reward_amount_raw ?? "5000000";

    // 4. Count how many winners exist currently
    const { count, error: countError } = await admin
      .from("easter_egg_claims")
      .select("*", { count: "exact", head: true })
      .eq("usd_eligible", true);

    if (countError) {
      throw new Error(countError.message);
    }

    const currentWinnersCount = count ?? 0;
    const isWinner = currentWinnersCount < maxWinners;

    // 5. Save/update the claim
    const nextTotalClaims = claim ? (claim.total_claims ?? 1) + 1 : 1;
    const { error: upsertError } = await admin.from("easter_egg_claims").upsert(
      {
        wallet,
        last_claimed_at: new Date().toISOString(),
        total_claims: nextTotalClaims,
        usd_eligible: isWinner,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet" }
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    // 6. Grant points
    await grantRawPointsServer(admin, wallet, points);

    // 7. If isWinner, grant the USDC prize claim
    if (isWinner) {
      const { error: rewardError } = await admin.from("creator_rewards").insert({
        wallet,
        reward_kind: "usdc",
        amount_raw: rewardAmountRaw,
        reward_label: "Easter Egg Grand Prize",
        status: "claimable",
        admin_note: `Winner #${currentWinnersCount + 1} of the homepage 3D board Easter Egg!`,
      });

      if (rewardError) {
        console.error("Failed to insert USD easter egg reward:", rewardError);
      }
    }

    return NextResponse.json({
      success: true,
      points,
      usdEligible: isWinner,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not claim easter egg" },
      { status: 500 }
    );
  }
}
