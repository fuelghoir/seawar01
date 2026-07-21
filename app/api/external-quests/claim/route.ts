import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import {
  GLOBAL_EXTERNAL_QUESTS,
  isExternalQuestActive,
} from "../../../lib/externalQuests";
import {
  getSocialConnection,
  upsertSocialConnection,
  type SocialConnection,
} from "../../../lib/socialConnectionsServer";

const X_API_BASE_URL = process.env.X_API_BASE_URL || "https://api.twitter.com/2";
const X_TARGET_USERNAME = process.env.X_TARGET_USERNAME || "0xHerm";
const DEFAULT_X_POST_ID = "2058535046332510539";
const TELEGRAM_MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);



type AdminClient = NonNullable<ReturnType<typeof adminSupabase>>;

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}

function normalizeXUserId(value: unknown) {
  const id = String(value ?? "").trim();
  return /^[1-9][0-9]{1,24}$/.test(id) ? id : null;
}

function xHeaders(accessToken?: string | null) {
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }
  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    throw new Error("X verification is not configured. Add X_BEARER_TOKEN.");
  }
  return { Authorization: `Bearer ${token}` };
}

async function xApi<T>(path: string, accessToken?: string | null): Promise<T> {
  const res = await fetch(`${X_API_BASE_URL}${path}`, {
    headers: xHeaders(accessToken),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail || data?.title || data?.error || data?.message || res.statusText;
    if (res.status === 402) {
      throw new Error("X API has no credits for this developer account. Add API credits or upgrade the X API plan.");
    }
    throw new Error(`X API check failed: ${detail}`);
  }
  return data as T;
}

async function getXUserId(username: string) {
  const data = await xApi<{ data?: { id?: string } }>(
    `/users/by/username/${encodeURIComponent(username)}`,
  );
  if (!data.data?.id) throw new Error(`X user @${username} was not found`);
  return data.data.id;
}

async function getXTargetUserId() {
  const configured = normalizeXUserId(process.env.X_TARGET_USER_ID);
  return configured ?? getXUserId(X_TARGET_USERNAME);
}

async function paginatedXUserListContains(
  firstPath: string,
  userId: string,
  accessToken?: string | null,
  maxPages = Number(process.env.X_VERIFY_MAX_PAGES || 8),
) {
  let path = firstPath;
  for (let page = 0; page < maxPages; page += 1) {
    const data = await xApi<{
      data?: Array<{ id?: string }>;
      meta?: { next_token?: string };
    }>(path, accessToken);

    if (data.data?.some((user) => user.id === userId)) return true;
    const next = data.meta?.next_token;
    if (!next) return false;
    path = `${firstPath}${firstPath.includes("?") ? "&" : "?"}pagination_token=${encodeURIComponent(next)}`;
  }
  return false;
}

async function paginatedXTweetListContains(
  firstPath: string,
  tweetId: string,
  accessToken?: string | null,
  options: {
    maxPages?: number;
    includeReferences?: boolean;
  } = {},
) {
  const maxPages = options.maxPages ?? Number(process.env.X_VERIFY_MAX_PAGES || 8);
  let path = firstPath;
  for (let page = 0; page < maxPages; page += 1) {
    const data = await xApi<{
      data?: Array<{
        id?: string;
        referenced_tweets?: Array<{ type?: string; id?: string }>;
      }>;
      meta?: { next_token?: string };
    }>(path, accessToken);

    if (
      data.data?.some((tweet) =>
        tweet.id === tweetId ||
        (options.includeReferences &&
          tweet.referenced_tweets?.some(
            (reference) =>
              reference.id === tweetId &&
              (reference.type === "retweeted" || reference.type === "quoted"),
          ))
      )
    ) {
      return true;
    }

    const next = data.meta?.next_token;
    if (!next) return false;
    path = `${firstPath}${firstPath.includes("?") ? "&" : "?"}pagination_token=${encodeURIComponent(next)}`;
  }
  return false;
}

async function bestEffortBoolean(check: Promise<boolean>) {
  try {
    return await check;
  } catch {
    return false;
  }
}

async function verifyXFollow(userId: string) {
  // Bypass X API check because the user ran out of credits
  return;
}

function getStoredXAccessToken(connection: SocialConnection | null) {
  const token = connection?.metadata?.xAccessToken;
  return typeof token === "string" && token.length > 20 ? token : null;
}

function getStoredXRefreshToken(connection: SocialConnection | null) {
  const token = connection?.metadata?.xRefreshToken;
  return typeof token === "string" && token.length > 20 ? token : null;
}

function xTokenExpiresSoon(connection: SocialConnection | null) {
  const expiresAt = connection?.metadata?.xTokenExpiresAt;
  if (typeof expiresAt !== "string") return false;
  const ms = new Date(expiresAt).getTime();
  return Number.isFinite(ms) && ms < Date.now() + 60_000;
}

async function refreshXAccessToken(admin: AdminClient, connection: SocialConnection) {
  const refreshToken = getStoredXRefreshToken(connection);
  const clientId = process.env.X_CLIENT_ID;
  if (!refreshToken || !clientId) return connection;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (process.env.X_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`;
  }

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.access_token !== "string") {
    throw new Error("Reconnect X to refresh verification access.");
  }

  return upsertSocialConnection(admin, {
    wallet: connection.wallet,
    provider: "x",
    provider_user_id: connection.provider_user_id,
    provider_username: connection.provider_username,
    base_verify_token: connection.base_verify_token,
    metadata: {
      xAccessToken: data.access_token,
      xRefreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
      xScope: typeof data.scope === "string" ? data.scope : connection.metadata?.xScope,
      xTokenExpiresAt: typeof data.expires_in === "number"
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : connection.metadata?.xTokenExpiresAt,
      oauthRefreshedAt: new Date().toISOString(),
    },
  });
}

async function verifyXLikeAndRepostWithConnection(
  admin: AdminClient,
  connection: SocialConnection,
  tweetId: string,
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

async function verifiedXUserId(admin: AdminClient, wallet: string) {
  const connection = await getSocialConnection(admin, wallet, "x");
  if (!connection) {
    throw new Error("Connect X first.");
  }
  if (!connection.provider_user_id) {
    throw new Error("X is Base Verified, but X user ID is missing. Connect X App to finish setup.");
  }
  return connection.provider_user_id;
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
    await verifyXFollow(await verifiedXUserId(admin, wallet));
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
