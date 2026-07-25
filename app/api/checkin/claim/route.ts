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

    // 1. Try RPC first
    let rpcRes: any = null;
    try {
      rpcRes = await admin.rpc("claim_daily_checkin", {
        p_wallet: wallet,
        p_is_base_app: isBaseApp,
      });
    } catch {
      // ignore RPC error and use fallback
    }

    if (rpcRes && !rpcRes.error && rpcRes.data) {
      await addSeasonXpServer(admin, wallet, 20).catch(() => {});
      return NextResponse.json(rpcRes.data);
    }

    // 2. Direct Supabase implementation operating on player_stats
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const yesterdayDate = new Date(now.getTime() - 86400000);
    const yesterday = yesterdayDate.toISOString().split("T")[0];

    const { data: stats, error: statsError } = await admin
      .from("player_stats")
      .select("checkin_streak, last_checkin, points")
      .eq("wallet", wallet)
      .maybeSingle();

    if (statsError) throw new Error(statsError.message);

    const lastCheckin = stats?.last_checkin ?? null;
    const currentStreak = stats?.checkin_streak ?? 0;

    if (lastCheckin === today) {
      throw new Error("Already checked in today");
    }

    let streak = 0;
    let usedFreeze = false;

    if (!lastCheckin) {
      streak = 1;
    } else if (lastCheckin === yesterday) {
      streak = currentStreak + 1;
    } else {
      // Missed more than 1 day: check for streak_freeze item
      const { data: item } = await admin
        .from("player_items")
        .select("quantity")
        .eq("wallet", wallet)
        .eq("item_slug", "streak_freeze")
        .maybeSingle();

      const freezeQty = item?.quantity ?? 0;
      if (freezeQty > 0) {
        await admin
          .from("player_items")
          .update({ quantity: freezeQty - 1, updated_at: now.toISOString() })
          .eq("wallet", wallet)
          .eq("item_slug", "streak_freeze");

        streak = currentStreak + 1;
        usedFreeze = true;
      } else {
        streak = 1;
      }
    }

    let reward = 20;
    if (streak === 2) reward = 25;
    else if (streak === 3) reward = 30;
    else if (streak === 4) reward = 40;
    else if (streak === 5) reward = 50;
    else if (streak === 6) reward = 60;
    else if (streak >= 7) reward = 80;

    if (isBaseApp) {
      reward = reward * 2;
    }

    const currentPoints = stats?.points ?? 0;
    const newPoints = currentPoints + reward;

    const { error: updateError } = await admin
      .from("player_stats")
      .upsert(
        {
          wallet,
          points: newPoints,
          checkin_streak: streak,
          last_checkin: today,
          updated_at: now.toISOString(),
        },
        { onConflict: "wallet" }
      );

    if (updateError) throw new Error(updateError.message);

    // Also award 20 Season XP for Battle Pass
    await addSeasonXpServer(admin, wallet, 20).catch((err) => {
      console.error("Failed to add check-in season XP:", err);
    });

    return NextResponse.json({
      points: reward,
      streak,
      usedFreeze,
    });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Could not claim check-in");
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
