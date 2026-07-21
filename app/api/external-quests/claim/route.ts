import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import {
  GLOBAL_EXTERNAL_QUESTS,
  isExternalQuestActive,
} from "../../../lib/externalQuests";
import {
  getSocialConnection,
  type SocialConnection,
} from "../../../lib/socialConnectionsServer";

const DEFAULT_X_POST_ID = "2058535046332510539";
const TELEGRAM_MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);



type AdminClient = NonNullable<ReturnType<typeof adminSupabase>>;

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}




async function verifyXLikeAndRepostWithConnection(
  _admin: AdminClient,
  _connection: SocialConnection,
  _tweetId: string,
) {
  // Bypass X API check because the user ran out of credits
  return;
}

async function verifyTelegramMembership(userId: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !chatId) {
    throw new Error("Telegram verification is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID.");
  }

  const params = new URLSearchParams({
    chat_id: chatId,
    user_id: userId,
  });
  const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember?${params}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const description = data?.description || res.statusText;
    throw new Error(`Telegram check failed: ${description}`);
  }

  const status = data.result?.status;
  if (!TELEGRAM_MEMBER_STATUSES.has(status)) {
    throw new Error("Telegram subscription not found");
  }
}


async function verifiedXConnection(admin: AdminClient, wallet: string) {
  const connection = await getSocialConnection(admin, wallet, "x");
  if (!connection) {
    throw new Error("Connect X first.");
  }
  if (!connection.provider_user_id) {
    throw new Error("X user ID is missing. Connect X App to finish setup.");
  }
  return connection;
}

async function verifiedTelegramUserId(admin: AdminClient, wallet: string) {
  const connection = await getSocialConnection(admin, wallet, "telegram");
  if (!connection?.provider_user_id) {
    throw new Error("Connect Telegram first.");
  }
  return connection.provider_user_id;
}

async function verifyQuest(admin: AdminClient, wallet: string, questKey: string) {
  if (questKey === "x-follow-0xherm-2026-05") {
    // Bypass X API check
    return;
  }

  if (questKey === "x-like-repost-2058535046332510539") {
    await verifyXLikeAndRepostWithConnection(
      admin,
      await verifiedXConnection(admin, wallet),
      process.env.X_REPOST_TWEET_ID || DEFAULT_X_POST_ID,
    );
    return;
  }

  if (questKey === "telegram-subscribe-0xherm-2026-05") {
    await verifyTelegramMembership(await verifiedTelegramUserId(admin, wallet));
  }
}

async function claimQuest(admin: AdminClient, wallet: string, questKey: string, isBaseApp: boolean) {
  const { data, error } = await admin.rpc("claim_external_quest", {
    p_wallet: wallet,
    p_quest_key: questKey,
    p_is_base_app: isBaseApp,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function POST(req: NextRequest) {
  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for external quest claims" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  const questKey = String(body?.questKey ?? body?.quest_key ?? "").trim();
  if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

  const quest = GLOBAL_EXTERNAL_QUESTS.find((entry) => entry.key === questKey);
  if (!quest) return NextResponse.json({ error: "Unknown quest" }, { status: 404 });
  if (!isExternalQuestActive(quest)) {
    return NextResponse.json({ error: "Quest is not available" }, { status: 400 });
  }

  try {
    const isBaseApp = isBaseAppUserAgent(req.headers.get("user-agent"));
    await verifyQuest(admin, wallet, quest.key);

    const awarded = await claimQuest(admin, wallet, quest.key, isBaseApp);
    const finalReward = isBaseApp ? quest.reward * 2 : quest.reward;
    return NextResponse.json({
      reward: awarded ? finalReward : 0,
      alreadyClaimed: !awarded,
      verified: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not verify external quest";
    const missingDb = /claim_external_quest|schema cache|function/i.test(message);
    return NextResponse.json(
      {
        error: missingDb
          ? "External quest database is missing. Run scripts/supabase-external-quests.sql in Supabase."
          : message,
      },
      { status: missingDb ? 500 : 400 },
    );
  }
}
