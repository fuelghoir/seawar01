import { NextRequest, NextResponse } from "next/server";
import {
  adminSupabase,
  getSocialConnections,
  normalizeWallet,
  socialDbMissingMessage,
} from "../../lib/socialConnectionsServer";

export async function GET(req: NextRequest) {
  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for social connections" },
      { status: 500 },
    );
  }

  const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

  try {
    const rows = await getSocialConnections(admin, wallet);
    return NextResponse.json({
      connections: rows.map((row) => ({
        provider: row.provider,
        connected: true,
        providerUserId: row.provider_user_id,
        providerUsername: row.provider_username,
        needsReconnect:
          row.provider === "x" &&
          !(typeof row.metadata?.xAccessToken === "string" && row.metadata.xAccessToken.length > 20),
        connectedAt: row.connected_at,
        updatedAt: row.updated_at,
      })),
      xOAuthAvailable: Boolean(process.env.X_CLIENT_ID),
      telegramBotAvailable: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    });
  } catch (err) {
    const message = socialDbMissingMessage(err instanceof Error ? err.message : "Could not load social connections");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
