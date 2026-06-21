import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  adminSupabase,
  normalizeWallet,
  socialDbMissingMessage,
} from "../../../../lib/socialConnectionsServer";

export const runtime = "nodejs";

type TelegramBotInfo = {
  id: number;
  username: string;
};

const LINK_TTL_MS = 10 * 60 * 1000;

let cachedBotInfo: TelegramBotInfo | null = null;
let cachedAt = 0;

async function getBotInfo(): Promise<TelegramBotInfo> {
  if (cachedBotInfo && Date.now() - cachedAt < 10 * 60 * 1000) {
    return cachedBotInfo;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Telegram Login is not configured. Add TELEGRAM_BOT_TOKEN.");
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok || !data.result?.id || !data.result?.username) {
    const detail = data?.description || res.statusText;
    throw new Error(`Telegram bot info could not be loaded: ${detail}`);
  }

  cachedBotInfo = {
    id: Number(data.result.id),
    username: String(data.result.username).replace(/^@/, ""),
  };
  cachedAt = Date.now();
  return cachedBotInfo;
}

export async function GET(req: NextRequest) {
  try {
    const bot = await getBotInfo();
    const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
    let connectUrl: string | null = null;
    let expiresAt: string | null = null;

    if (wallet) {
      const admin = adminSupabase();
      if (!admin) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Telegram connect links.");
      }

      const code = randomBytes(18).toString("base64url");
      expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
      const { error } = await admin.from("social_link_codes").insert({
        code,
        wallet,
        provider: "telegram",
        expires_at: expiresAt,
      });
      if (error) throw new Error(socialDbMissingMessage(error.message));

      connectUrl = `https://t.me/${bot.username}?start=sea_${code}`;
    }

    return NextResponse.json({
      botId: bot.id,
      botUsername: bot.username,
      requestAccess: "write",
      connectUrl,
      expiresAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start Telegram Login";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
