import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import { GLOBAL_EXTERNAL_QUESTS } from "../../../lib/externalQuests";
import {
  getSocialConnection,
} from "../../../lib/socialConnectionsServer";
import {
  getFleetSeasonPointsCheckpoint,
  recordFleetSeasonPointGain,
} from "../../../lib/fleetSeasonPointsServer";

const TELEGRAM_MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);



type AdminClient = NonNullable<ReturnType<typeof adminSupabase>>;

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
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

async function verifyQuest(admin: AdminClient, wallet: string, kind: string) {
  if (kind === "twitter") {
    // X action endpoints are not available on the project's current API plan.
    // Requiring the connected X account still prevents one social account from
    // farming the same campaign across many wallets.
    await verifiedXConnection(admin, wallet);
    return;
  }

  if (kind === "telegram") {
    await verifyTelegramMembership(await verifiedTelegramUserId(admin, wallet));
    return;
  }

  if (kind !== "baseApp") throw new Error("Unsupported quest verification type");
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
  const questKey = String(body?.questKey ?? body?.quest_key ?? "").trim().toLowerCase();
  if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

  try {
    const { data: campaign, error: questError } = await admin
      .from("external_quest_campaigns")
      .select("quest_key,kind,points,starts_at,ends_at,enabled")
      .eq("quest_key", questKey)
      .maybeSingle();
    const staticQuest = GLOBAL_EXTERNAL_QUESTS.find((entry) => entry.key === questKey);
    const legacyQuest = staticQuest && (
      !campaign && !questError ||
      Boolean(questError && /external_quest_campaigns|schema cache|does not exist/i.test(questError.message))
    ) ? staticQuest : null;
    if (questError && !legacyQuest) throw new Error(questError.message);
    const quest = campaign ?? (legacyQuest ? {
      quest_key: legacyQuest.key,
      kind: legacyQuest.kind,
      points: legacyQuest.reward,
      starts_at: legacyQuest.startsAt ?? null,
      ends_at: legacyQuest.endsAt ?? null,
      enabled: true,
    } : null);
    if (!quest || !quest.enabled) return NextResponse.json({ error: "Unknown quest" }, { status: 404 });
    const now = Date.now();
    if ((quest.starts_at && now < new Date(quest.starts_at).getTime()) || (quest.ends_at && now >= new Date(quest.ends_at).getTime())) {
      return NextResponse.json({ error: "Quest is not available" }, { status: 400 });
    }
    const isBaseApp = isBaseAppUserAgent(req.headers.get("user-agent"));
    await verifyQuest(admin, wallet, quest.kind);

    const fleetPointsCheckpoint = await getFleetSeasonPointsCheckpoint(admin, wallet).catch(() => null);
    const awarded = await claimQuest(admin, wallet, quest.quest_key, isBaseApp);
    const finalReward = isBaseApp ? quest.points * 2 : quest.points;
    if (awarded) {
      await recordFleetSeasonPointGain(admin, fleetPointsCheckpoint, finalReward).catch(() => {});
    }
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
          ? "External quest database is missing. Run scripts/supabase-admin-external-quests.sql in Supabase."
          : message,
      },
      { status: missingDb ? 500 : 400 },
    );
  }
}
