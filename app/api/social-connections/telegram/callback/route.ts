import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  adminSupabase,
  normalizeWallet,
  socialDbMissingMessage,
  upsertSocialConnection,
} from "../../../../lib/socialConnectionsServer";

type TelegramAuthData = Record<string, string | number | boolean | null | undefined>;

function valueToString(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function verifyTelegramAuth(authData: TelegramAuthData) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Telegram Login is not configured. Add TELEGRAM_BOT_TOKEN.");
  }

  const hash = valueToString(authData.hash);
  const id = valueToString(authData.id);
  const authDate = Number(authData.auth_date);
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !id || !/^[1-9][0-9]{1,24}$/.test(id)) {
    throw new Error("Invalid Telegram Login payload");
  }
  if (!Number.isFinite(authDate)) {
    throw new Error("Invalid Telegram auth date");
  }
  if (Date.now() / 1000 - authDate > 24 * 60 * 60) {
    throw new Error("Telegram Login payload expired");
  }

  const checkString = Object.entries(authData)
    .filter(([key, value]) => key !== "hash" && value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join("\n");

  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(hash, "hex");
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error("Telegram Login signature is invalid");
  }

  return {
    id,
    username: valueToString(authData.username),
    firstName: valueToString(authData.first_name),
    lastName: valueToString(authData.last_name),
    photoUrl: valueToString(authData.photo_url),
    authDate,
  };
}

export async function POST(req: NextRequest) {
  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for social connections" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

  try {
    const telegram = verifyTelegramAuth((body?.authData || {}) as TelegramAuthData);
    const connection = await upsertSocialConnection(admin, {
      wallet,
      provider: "telegram",
      provider_user_id: telegram.id,
      provider_username: telegram.username,
      metadata: {
        source: "telegram_login",
        firstName: telegram.firstName,
        lastName: telegram.lastName,
        photoUrl: telegram.photoUrl,
        authDate: telegram.authDate,
        linkedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      connection: {
        provider: connection.provider,
        connected: true,
        providerUserId: connection.provider_user_id,
        providerUsername: connection.provider_username,
      },
    });
  } catch (err) {
    const message = socialDbMissingMessage(err instanceof Error ? err.message : "Could not connect Telegram");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
