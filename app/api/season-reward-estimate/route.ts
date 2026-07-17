import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../lib/adminSupabase";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

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
    const { data, error } = await admin.rpc("get_season_reward_estimate", {
      p_wallet: wallet,
    });

    if (error) {
      console.error("RPC error in get_season_reward_estimate:", error);
      throw error;
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not estimate season reward";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
