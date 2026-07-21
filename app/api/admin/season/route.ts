import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    await requireAdminSession();
    const admin = adminSupabase();

    const { data: config, error } = await admin
      .from("season_config")
      .select("end_date, is_ended, season_key, virtual_pool_usdc, min_tx_count")
      .eq("id", "default")
      .maybeSingle();

    if (error) throw new Error(error.message);

    return NextResponse.json({
      endDate: config?.end_date ?? "2026-07-18T00:00:00.000Z",
      isEnded: config?.is_ended ?? false,
      seasonKey: config?.season_key || "S1",
      virtualPoolUsdc: config?.virtual_pool_usdc || 0,
      minTxCount: config?.min_tx_count ?? 10,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load season config" },
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
      const endDate = String(body?.endDate ?? "2026-07-18T00:00:00.000Z").trim();
      const isEnded = Boolean(body?.isEnded);
      const seasonKey = String(body?.seasonKey || "S1").trim();
      const virtualPoolUsdc = Math.max(0, Number(body?.virtualPoolUsdc || 0));
      const minTxCount = Math.max(0, Number(body?.minTxCount ?? 10));

      const { error } = await admin
        .from("season_config")
        .upsert({
          id: "default",
          end_date: endDate,
          is_ended: isEnded,
          season_key: seasonKey,
          virtual_pool_usdc: virtualPoolUsdc,
          min_tx_count: minTxCount,
        }, { onConflict: "id" });

      if (error) throw new Error(error.message);

      return NextResponse.json({ success: true, message: "Season config updated successfully." });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 500 }
    );
  }
}
