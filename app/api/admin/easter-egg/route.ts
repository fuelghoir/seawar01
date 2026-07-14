import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    await requireAdminSession();
    const admin = adminSupabase();

    // Fetch settings/config
    const { data: config, error: configError } = await admin
      .from("easter_egg_config")
      .select("max_winners, reward_amount_raw")
      .eq("id", "default")
      .maybeSingle();

    if (configError) {
      throw new Error(configError.message);
    }

    const maxWinners = config?.max_winners ?? 1;
    const rewardAmountRaw = config?.reward_amount_raw ?? "5000000";

    // Fetch all Easter Egg claims
    const { data: claims, error: claimsError } = await admin
      .from("easter_egg_claims")
      .select("*")
      .order("last_claimed_at", { ascending: false });

    if (claimsError) {
      throw new Error(claimsError.message);
    }

    // Determine how many USD grand prizes have been won
    const usdWinnersList = claims?.filter((c) => c.usd_eligible) ?? [];
    const usdWon = usdWinnersList.length >= maxWinners;
    const usdWinners = usdWinnersList.map((c) => c.wallet);

    return NextResponse.json({
      claims: claims ?? [],
      usdWon,
      usdWinners,
      totalClaimsCount: claims?.length ?? 0,
      maxWinners,
      rewardAmountRaw,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load Easter Egg stats" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession();
    const admin = adminSupabase();
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "").trim();

    if (action === "update_config") {
      const maxWinners = Math.max(1, Math.floor(Number(body?.maxWinners ?? 1)));
      const rewardAmountRaw = String(body?.rewardAmountRaw ?? "5000000").trim();

      const { error: updateError } = await admin
        .from("easter_egg_config")
        .upsert({
          id: "default",
          max_winners: maxWinners,
          reward_amount_raw: rewardAmountRaw,
        }, { onConflict: "id" });

      if (updateError) {
        throw new Error(updateError.message);
      }

      return NextResponse.json({ success: true, message: "Configuration updated successfully." });
    }

    if (action === "reset_usd") {
      // Reset the USD prize eligibility so next finders are eligible
      const { error: updateError } = await admin
        .from("easter_egg_claims")
        .update({ usd_eligible: false, updated_at: new Date().toISOString() })
        .eq("usd_eligible", true);

      if (updateError) {
        throw new Error(updateError.message);
      }

      return NextResponse.json({ success: true, message: "USD grand prize statuses reset successfully." });
    }

    if (action === "reset_cooldown") {
      const wallet = String(body?.wallet ?? "").trim().toLowerCase();
      if (!wallet) {
        return NextResponse.json({ error: "Wallet address is required" }, { status: 400 });
      }

      // Delete the player's claim row so they can instantly claim it again
      const { error: deleteError } = await admin
        .from("easter_egg_claims")
        .delete()
        .eq("wallet", wallet);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      return NextResponse.json({ success: true, message: `Cooldown reset for ${wallet}.` });
    }

    if (action === "manual_usd") {
      const wallet = String(body?.wallet ?? "").trim().toLowerCase();
      if (!wallet) {
        return NextResponse.json({ error: "Wallet address is required" }, { status: 400 });
      }

      // Get configuration amount
      const { data: config } = await admin
        .from("easter_egg_config")
        .select("reward_amount_raw")
        .eq("id", "default")
        .maybeSingle();

      const rewardAmountRaw = config?.reward_amount_raw ?? "5000000";

      // Make this wallet eligible for the USD claim
      const { error: updateError } = await admin
        .from("easter_egg_claims")
        .update({ usd_eligible: true, updated_at: new Date().toISOString() })
        .eq("wallet", wallet);

      if (updateError) {
        throw new Error(updateError.message);
      }

      // Insert USDC claim into creator_rewards
      const { error: rewardError } = await admin.from("creator_rewards").insert({
        wallet,
        reward_kind: "usdc",
        amount_raw: rewardAmountRaw,
        reward_label: "Easter Egg Grand Prize",
        status: "claimable",
        admin_note: "Manually granted Easter Egg Grand Prize by Admin.",
      });

      if (rewardError) {
        throw new Error(rewardError.message);
      }

      return NextResponse.json({ success: true, message: `USD grand prize manually awarded to ${wallet}.` });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 500 }
    );
  }
}
