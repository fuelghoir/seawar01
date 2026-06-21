import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  buildPublicProfileShareUrl,
  buildPublicReferralUrl,
} from "../../lib/publicUrl";
import {
  adminSupabase,
  getSocialConnection,
  upsertSocialConnection,
  type AdminClient,
  type SocialConnection,
} from "../../lib/socialConnectionsServer";

const PROFILE_SHARE_POINTS = 500;
const GAME_SHARE_POINTS = 100;
const PROFILE_SHARE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SHARE_ATTEMPT_TTL_MS = 30 * 60 * 1000;
const BOT_STATS_OPPONENT = "0x0000000000000000000000000000000000000001";
const X_API_BASE_URL = process.env.X_API_BASE_URL || "https://api.twitter.com/2";

type ShareKind = "profile" | "game";
type ShareAction = "prepare" | "verify";

type GameRow = {
  id: number;
  player1: string;
  player2: string | null;
  state: number;
  winner: string | null;
  game_mode: string | null;
};

type ShareAttempt = {
  version: 1;
  wallet: string;
  kind: ShareKind;
  gameId: number | null;
  gameMode: string | null;
  issuedAt: number;
  nonce: string;
};

type XTweet = {
  id?: string;
  text?: string;
  created_at?: string;
  entities?: {
    urls?: Array<{
      url?: string;
      expanded_url?: string;
      unwound_url?: string;
    }>;
  };
};

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return isAddress(wallet) ? wallet : null;
}

function normalizeKind(value: unknown): ShareKind | null {
  const kind = String(value ?? "").trim().toLowerCase();
  return kind === "profile" || kind === "game" ? kind : null;
}

function normalizeAction(value: unknown): ShareAction | null {
  const action = String(value ?? "").trim().toLowerCase();
  return action === "prepare" || action === "verify" ? action : null;
}

function profileNextAvailableAt(createdAt: string) {
  return new Date(new Date(createdAt).getTime() + PROFILE_SHARE_COOLDOWN_MS);
}

function isProfileShareCoolingDown(createdAt: string) {
  return profileNextAvailableAt(createdAt).getTime() > Date.now();
}

function shareSecret() {
  const secret =
    process.env.SOCIAL_SHARE_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SOCIAL_SHARE_SECRET is not configured");
  return secret;
}

function signShareAttempt(attempt: ShareAttempt) {
  const payload = Buffer.from(JSON.stringify(attempt), "utf8").toString("base64url");
  const signature = createHmac("sha256", shareSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyShareAttempt(token: string, wallet: string, kind: ShareKind, gameId: number | null) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("Invalid share attempt");

  const expected = createHmac("sha256", shareSecret()).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Invalid share attempt");
  }

  let attempt: ShareAttempt;
  try {
    attempt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ShareAttempt;
  } catch {
    throw new Error("Invalid share attempt");
  }

  if (
    attempt.version !== 1 ||
    attempt.wallet !== wallet ||
    attempt.kind !== kind ||
    attempt.gameId !== gameId
  ) {
    throw new Error("Share attempt does not match this reward");
  }

  const age = Date.now() - attempt.issuedAt;
  if (!Number.isFinite(age) || age < -60_000 || age > SHARE_ATTEMPT_TTL_MS) {
    throw new Error("Share attempt expired. Open X again to create a fresh post.");
  }
  return attempt;
}

function verifiedShareUrl(attempt: ShareAttempt, token: string) {
  const baseUrl =
    attempt.kind === "profile"
      ? buildPublicProfileShareUrl(attempt.wallet)
      : buildPublicReferralUrl(attempt.wallet);
  const url = new URL(baseUrl);
  url.searchParams.set("sbshare", token);
  return url.toString();
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
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry < Date.now() + 60_000;
}

async function refreshXAccessToken(admin: AdminClient, connection: SocialConnection) {
  const refreshToken = getStoredXRefreshToken(connection);
  const clientId = process.env.X_CLIENT_ID;
  if (!refreshToken || !clientId) {
    throw new Error("Reconnect X to enable post verification.");
  }

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
    const detail = data?.error_description || data?.error || res.statusText;
    throw new Error(`Reconnect X to refresh post verification access. ${detail}`);
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
      xTokenExpiresAt:
        typeof data.expires_in === "number"
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : connection.metadata?.xTokenExpiresAt,
      oauthRefreshedAt: new Date().toISOString(),
    },
  });
}

async function getReadyXConnection(admin: AdminClient, wallet: string) {
  const connection = await getSocialConnection(admin, wallet, "x");
  if (!connection?.provider_user_id) throw new Error("Connect X before sharing.");
  if (!getStoredXAccessToken(connection)) {
    throw new Error("Reconnect X to enable post verification.");
  }
  return xTokenExpiresSoon(connection) ? refreshXAccessToken(admin, connection) : connection;
}

async function requestXUserTweets(
  admin: AdminClient,
  connection: SocialConnection,
  allowRefresh = true,
): Promise<{ tweets: XTweet[]; connection: SocialConnection }> {
  const userId = connection.provider_user_id;
  const accessToken = getStoredXAccessToken(connection);
  if (!userId || !accessToken) throw new Error("Reconnect X to enable post verification.");

  const params = new URLSearchParams({
    max_results: "100",
    "tweet.fields": "created_at,entities,text",
  });
  const res = await fetch(
    `${X_API_BASE_URL}/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );

  if (res.status === 401 && allowRefresh) {
    const refreshed = await refreshXAccessToken(admin, connection);
    return requestXUserTweets(admin, refreshed, false);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail || data?.title || data?.error || data?.message || res.statusText;
    if (res.status === 402) {
      throw new Error("X API has no credits. Add X API credits before verifying shares.");
    }
    if (res.status === 429) {
      throw new Error("X API rate limit reached. Wait a minute and tap Verify again.");
    }
    throw new Error(`X post verification failed: ${detail}`);
  }
  return { tweets: Array.isArray(data?.data) ? data.data : [], connection };
}

function tweetContainsShareToken(tweet: XTweet, token: string) {
  if (tweet.text?.includes(token)) return true;
  return Boolean(
    tweet.entities?.urls?.some((url) =>
      [url.expanded_url, url.unwound_url, url.url].some(
        (value) => typeof value === "string" && value.includes(token),
      ),
    ),
  );
}

async function findVerifiedSharePost(
  admin: AdminClient,
  connection: SocialConnection,
  attempt: ShareAttempt,
  token: string,
) {
  const result = await requestXUserTweets(admin, connection);
  const earliest = attempt.issuedAt - 60_000;
  const tweet = result.tweets.find((candidate) => {
    const createdAt = candidate.created_at ? new Date(candidate.created_at).getTime() : NaN;
    return (
      Boolean(candidate.id) &&
      (!Number.isFinite(createdAt) || createdAt >= earliest) &&
      tweetContainsShareToken(candidate, token)
    );
  });
  if (!tweet?.id) {
    throw new Error("X post was not found. Publish it, wait a few seconds, then tap Verify again.");
  }

  const username = result.connection.provider_username;
  return {
    tweetId: tweet.id,
    tweetUrl: username
      ? `https://x.com/${encodeURIComponent(username)}/status/${tweet.id}`
      : `https://x.com/i/web/status/${tweet.id}`,
  };
}

async function grantPoints(admin: AdminClient, wallet: string, points: number) {
  const { data, error } = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    const totalPoints = Number(data.points ?? 0) + points;
    const { error: updateError } = await admin
      .from("player_stats")
      .update({ points: totalPoints, updated_at: new Date().toISOString() })
      .eq("wallet", wallet);
    if (updateError) throw new Error(updateError.message);
    return totalPoints;
  }

  const { error: insertError } = await admin.from("player_stats").insert({ wallet, points });
  if (insertError) throw new Error(insertError.message);
  return points;
}

async function getLatestProfileShare(admin: AdminClient, wallet: string) {
  const { data, error } = await admin
    .from("social_share_rewards")
    .select("created_at")
    .eq("wallet", wallet)
    .eq("reward_kind", "profile")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.created_at as string | undefined;
}

async function getFinishedGameForWallet(
  admin: AdminClient,
  wallet: string,
  gameId: number,
): Promise<GameRow> {
  const { data, error } = await admin
    .from("games")
    .select("id,player1,player2,state,winner,game_mode")
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Game not found");

  const game = data as GameRow;
  const isPlayer = game.player1 === wallet || game.player2 === wallet;
  if (!isPlayer) throw new Error("Wallet is not a player in this game");
  if (game.state !== 3) throw new Error("Game is not finished yet");
  return game;
}

async function rewardContext(
  admin: AdminClient,
  wallet: string,
  kind: ShareKind,
  requestedGameId: unknown,
) {
  if (kind === "profile") {
    const latest = await getLatestProfileShare(admin, wallet);
    if (latest && isProfileShareCoolingDown(latest)) {
      const error = new Error("Profile share reward is still cooling down");
      Object.assign(error, { nextAvailableAt: profileNextAvailableAt(latest).toISOString() });
      throw error;
    }
    return {
      rewardKey: `profile:${wallet}:${Date.now()}`,
      points: PROFILE_SHARE_POINTS,
      gameId: null,
      gameMode: null,
    };
  }

  const gameId = Number(requestedGameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw new Error("Invalid game id");
  const game = await getFinishedGameForWallet(admin, wallet, gameId);
  const gameMode =
    game.game_mode === "bot" || game.player2 === BOT_STATS_OPPONENT
      ? "bot"
      : game.game_mode === "wager"
        ? "wager"
        : "friend";
  const rewardKey = `game:${gameId}:${wallet}`;
  const { data: claimed, error } = await admin
    .from("social_share_rewards")
    .select("id")
    .eq("reward_key", rewardKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (claimed) throw new Error("Share reward already claimed");
  return { rewardKey, points: GAME_SHARE_POINTS, gameId, gameMode };
}

export async function GET(req: NextRequest) {
  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for share rewards" },
      { status: 500 },
    );
  }

  const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

  try {
    const [latest, storedXConnection] = await Promise.all([
      getLatestProfileShare(admin, wallet),
      getSocialConnection(admin, wallet, "x"),
    ]);
    let xConnection = storedXConnection;
    let refreshFailed = false;
    if (
      xConnection?.provider_user_id &&
      getStoredXAccessToken(xConnection) &&
      xTokenExpiresSoon(xConnection)
    ) {
      try {
        xConnection = await refreshXAccessToken(admin, xConnection);
      } catch {
        refreshFailed = true;
      }
    }
    const nextAvailableAt = latest ? profileNextAvailableAt(latest) : null;
    const hasAccessToken = Boolean(getStoredXAccessToken(xConnection)) && !refreshFailed;
    return NextResponse.json({
      profile: {
        canClaim: !nextAvailableAt || nextAvailableAt.getTime() <= Date.now(),
        points: PROFILE_SHARE_POINTS,
        nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
      },
      x: {
        connected: Boolean(xConnection?.provider_user_id) && hasAccessToken,
        username: xConnection?.provider_username ?? null,
        needsReconnect: Boolean(xConnection) && (!hasAccessToken || refreshFailed),
        oauthAvailable: Boolean(process.env.X_CLIENT_ID),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load share rewards";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = adminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for share rewards" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const action = normalizeAction(body?.action);
  const wallet = normalizeWallet(body?.wallet);
  const kind = normalizeKind(body?.kind);
  if (!action) {
    return NextResponse.json(
      { error: "Open X and verify the published post before claiming points." },
      { status: 400 },
    );
  }
  if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "Invalid share reward type" }, { status: 400 });

  try {
    const context = await rewardContext(admin, wallet, kind, body?.gameId ?? body?.game_id);
    const connection = await getReadyXConnection(admin, wallet);

    if (action === "prepare") {
      const attempt: ShareAttempt = {
        version: 1,
        wallet,
        kind,
        gameId: context.gameId,
        gameMode: context.gameMode,
        issuedAt: Date.now(),
        nonce: randomBytes(9).toString("base64url"),
      };
      const attemptToken = signShareAttempt(attempt);
      return NextResponse.json({
        attemptToken,
        shareUrl: verifiedShareUrl(attempt, attemptToken),
        expiresAt: new Date(attempt.issuedAt + SHARE_ATTEMPT_TTL_MS).toISOString(),
        xUsername: connection.provider_username,
      });
    }

    const attemptToken = String(body?.attemptToken ?? body?.attempt_token ?? "").slice(0, 2048);
    const attempt = verifyShareAttempt(
      attemptToken,
      wallet,
      kind,
      context.gameId,
    );
    const verifiedPost = await findVerifiedSharePost(admin, connection, attempt, attemptToken);

    const { data: reusedPost, error: reusedError } = await admin
      .from("social_share_rewards")
      .select("id")
      .eq("tweet_url", verifiedPost.tweetUrl)
      .maybeSingle();
    if (reusedError) throw new Error(reusedError.message);
    if (reusedPost) throw new Error("This X post has already been used for a reward");

    const shareText = String(body?.shareText ?? body?.share_text ?? "").slice(0, 280);
    const { error: insertError } = await admin.from("social_share_rewards").insert({
      wallet,
      reward_kind: kind,
      reward_key: context.rewardKey,
      game_id: context.gameId,
      game_mode: context.gameMode,
      points: context.points,
      share_text: shareText || null,
      tweet_url: verifiedPost.tweetUrl,
    });
    if (insertError) {
      if (/duplicate key|social_share_rewards_reward_key/i.test(insertError.message)) {
        return NextResponse.json(
          { error: "Share reward already claimed", alreadyClaimed: true },
          { status: 409 },
        );
      }
      throw new Error(insertError.message);
    }

    try {
      const totalPoints = await grantPoints(admin, wallet, context.points);
      return NextResponse.json({
        points: context.points,
        totalPoints,
        kind,
        gameId: context.gameId,
        tweetUrl: verifiedPost.tweetUrl,
        verified: true,
      });
    } catch (err) {
      await admin.from("social_share_rewards").delete().eq("reward_key", context.rewardKey);
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not verify share reward";
    const nextAvailableAt =
      err && typeof err === "object" && "nextAvailableAt" in err
        ? String(err.nextAvailableAt)
        : null;
    const missingTable = /social_(share_rewards|connections)|schema cache|could not find the table/i.test(message);
    const status = nextAvailableAt ? 429 : missingTable ? 500 : 400;
    return NextResponse.json(
      {
        error: missingTable
          ? "Share verification database is missing. Run the social connection and share reward migrations."
          : message,
        ...(nextAvailableAt ? { nextAvailableAt } : {}),
      },
      { status },
    );
  }
}
