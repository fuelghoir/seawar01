import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import { addSeasonXpServer, normalizeSeasonWallet } from "../../../lib/seasonServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeSeasonWallet(body?.wallet);
  if (!wallet) return badRequest("Invalid wallet");

  try {
    const isBaseApp = isBaseAppUserAgent(req.headers.get("user-agent"));
    const admin = adminSupabase();
    const { data, error } = await admin.rpc("claim_daily_checkin", {
      p_wallet: wallet,
      p_is_base_app: isBaseApp,
    });
    if (error) throw new Error(error.message);

    await addSeasonXpServer(admin, wallet, 20).catch((err) => {
      console.error("Failed to add check-in season XP:", err);
    });

    return NextResponse.json(data);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Could not claim check-in");
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
