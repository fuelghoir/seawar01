import { NextRequest, NextResponse } from "next/server";
import {
  adminSupabase,
  socialDbMissingMessage,
  upsertSocialConnection,
} from "../../../../lib/socialConnectionsServer";

type TelegramUpdate = {
  message?: {
    text?: string;
    from?: {
      id?: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    chat?: { id?: number };
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: {
      id?: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    message?: {
      chat?: { id?: number };
      message_id?: number;
    };
  };
};

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://seabattle.top").replace(/\/+$/, "");

function extractLinkCode(text: string | undefined) {
  const match = String(text ?? "").trim().match(/^\/start\s+sea_([A-Za-z0-9_-]{8,64})/);
  return match?.[1] ?? null;
}

function extractCallbackCode(data: string | undefined) {
  const match = String(data ?? "").trim().match(/^sea_link:([A-Za-z0-9_-]{8,64})$/);
  return match?.[1] ?? null;
}

async function sendTelegramMessage(
  chatId: number | undefined,
  text: string,
  replyMarkup?: Record<string, unknown>,
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  }).catch(() => null);
}

async function answerCallbackQuery(callbackId: string | undefined, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !callbackId) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  }).catch(() => null);
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Supabase admin is not configured" }, { status: 500 });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const startCode = extractLinkCode(update?.message?.text);
  const callbackCode = extractCallbackCode(update?.callback_query?.data);
  const code = callbackCode ?? startCode;
  const from = update?.callback_query?.from ?? update?.message?.from;
  const telegramId = from?.id;
  const chatId = update?.callback_query?.message?.chat?.id ?? update?.message?.chat?.id;
  if (!code || !telegramId) {
    return NextResponse.json({ ok: true });
  }

  try {
    const { data, error } = await admin
      .from("social_link_codes")
      .select("code,wallet,provider,expires_at,used_at")
      .eq("code", code)
      .eq("provider", "telegram")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) {
      await sendTelegramMessage(chatId, "Sea Battle link expired or already used. Open the game and tap Connect Telegram again.");
      await answerCallbackQuery(update?.callback_query?.id, "Link expired");
      return NextResponse.json({ ok: true });
    }

    const username = from?.username ?? null;
    const { data: existingAccount, error: existingAccountError } = await admin
      .from("social_connections")
      .select("wallet")
      .eq("provider", "telegram")
      .eq("provider_user_id", String(telegramId))
      .maybeSingle();
    if (existingAccountError) throw new Error(existingAccountError.message);
    if (
      existingAccount?.wallet &&
      String(existingAccount.wallet).toLowerCase() !== String(data.wallet).toLowerCase()
    ) {
      await admin
        .from("social_link_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("code", code);
      await answerCallbackQuery(update?.callback_query?.id, "Account already connected");
      await sendTelegramMessage(
        chatId,
        "This Telegram account is already connected to another wallet. Try another Telegram account in Sea Battle.",
      );
      return NextResponse.json({ ok: true });
    }

    await upsertSocialConnection(admin, {
      wallet: data.wallet,
      provider: "telegram",
      provider_user_id: String(telegramId),
      provider_username: username,
      metadata: {
        source: "telegram_bot",
        firstName: from?.first_name ?? null,
        lastName: from?.last_name ?? null,
        linkedAt: new Date().toISOString(),
      },
    });

    await admin
      .from("social_link_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code", code);

    await answerCallbackQuery(update?.callback_query?.id, "Telegram connected");
    await sendTelegramMessage(chatId, "Telegram connected to Sea Battle. You can return to the game now.", {
      inline_keyboard: [
        [
          {
            text: "Return to Sea Battle",
            url: APP_URL,
          },
        ],
      ],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = socialDbMissingMessage(err instanceof Error ? err.message : "Telegram connection failed");
    await answerCallbackQuery(update?.callback_query?.id, "Connection failed");
    await sendTelegramMessage(chatId, `Sea Battle connection failed: ${message}`);
    return NextResponse.json({ ok: true, error: message });
  }
}
