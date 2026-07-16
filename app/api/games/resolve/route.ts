import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import { resolveFinishedGameStats } from "../../../lib/gameStatsServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  try {
    const isBaseApp = isBaseAppUserAgent(req.headers.get("user-agent"));
    const admin = adminSupabase();
    const result = await resolveFinishedGameStats(
      admin,
      body?.gameId ?? body?.game_id,
      body?.wallet,
      isBaseApp
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not resolve game stats" },
      { status: 400 },
    );
  }
}
