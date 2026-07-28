import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    await requireAdminSession();
    const admin = adminSupabase();

    // Fetch all Easter Egg claims
    const { data: claims, error: claimsError } = await admin
      .from("easter_egg_claims")
      .select("*")
      .order("last_claimed_at", { ascending: false });

    if (claimsError) {
      throw new Error(claimsError.message);
    }

    return NextResponse.json({
      claims: claims ?? [],
      totalClaimsCount: claims?.length ?? 0,
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

    if (["update_config", "reset_usd", "manual_usd"].includes(action)) {
      return NextResponse.json(
        { error: "Easter Egg USDC rewards have been retired" },
        { status: 410 },
      );
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 500 }
    );
  }
}
