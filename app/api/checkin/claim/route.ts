import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, type AdminClient } from "../../../lib/adminSupabase";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import { addSeasonXpServer, normalizeSeasonWallet } from "../../../lib/seasonServer";

export const runtime = "nodejs";

const CHECKIN_XP = 20;
const MAX_CAS_ATTEMPTS = 5;
const MAX_BODY_BYTES = 4_096;

type CheckinResult = {
  points: number;
  streak: number;
  usedFreeze: boolean;
  alreadyClaimed?: boolean;
};

type PlayerStatsRow = {
  points: number | null;
  checkin_streak: number | null;
  last_checkin: string | null;
  total_checkins: number | null;
  updated_at: string;
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await readSmallJson(req);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError("Request body is too large", 413);
    }
    return jsonError("Invalid JSON body", 400);
  }

  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const wallet = normalizeSeasonWallet(payload?.wallet);
  if (!wallet) return jsonError("Invalid wallet", 400);

  const isBaseApp = isBaseAppUserAgent(req.headers.get("user-agent"));

  try {
    const admin = adminSupabase();
    const atomic = await admin.rpc("claim_daily_checkin_atomic", {
      p_wallet: wallet,
      p_is_base_app: isBaseApp,
    });

    if (!atomic.error) {
      const result = normalizeRpcResult(atomic.data);
      if (!result) throw new Error("Invalid daily check-in response");
      return jsonResponse(result);
    }

    if (!isMissingAtomicRpc(atomic.error)) {
      console.error("Atomic daily check-in failed:", atomic.error);
      return jsonError("Could not claim check-in", 503);
    }

    // Safe rollout path while the atomic RPC migration is not installed yet.
    // The conditional player_stats update is the compare-and-swap: only one
    // concurrent request can move last_checkin from its observed value to today.
    const fallback = await claimDailyCheckinWithCas(admin, wallet, isBaseApp);
    return jsonResponse(fallback);
  } catch (error) {
    console.error("Daily check-in failed:", error);
    return jsonError("Could not claim check-in", 503);
  }
}

async function claimDailyCheckinWithCas(
  admin: AdminClient,
  wallet: string,
  isBaseApp: boolean,
): Promise<CheckinResult> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { data, error } = await admin
      .from("player_stats")
      .select("points,checkin_streak,last_checkin,total_checkins,updated_at")
      .eq("wallet", wallet)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const stats = data as PlayerStatsRow | null;
    if (!stats) {
      const reward = checkinReward(1, isBaseApp);
      const inserted = await admin
        .from("player_stats")
        .insert({
          wallet,
          points: reward,
          checkin_streak: 1,
          last_checkin: today,
          total_checkins: 1,
          updated_at: now.toISOString(),
        })
        .select("wallet")
        .maybeSingle();

      if (inserted.error?.code === "23505") continue;
      if (inserted.error) throw new Error(inserted.error.message);
      if (!inserted.data) continue;

      await awardFallbackCheckinXp(admin, wallet);
      return { points: reward, streak: 1, usedFreeze: false, alreadyClaimed: false };
    }

    const currentStreak = Math.max(0, Number(stats.checkin_streak ?? 0));
    if (stats.last_checkin === today) {
      return {
        points: 0,
        streak: currentStreak,
        usedFreeze: false,
        alreadyClaimed: true,
      };
    }

    let streak = 1;
    let freezeQuantity = 0;
    if (stats.last_checkin === yesterday) {
      streak = currentStreak + 1;
    } else if (currentStreak > 0) {
      const freeze = await admin
        .from("player_items")
        .select("quantity")
        .eq("wallet", wallet)
        .eq("item_slug", "streak_freeze")
        .maybeSingle();
      if (freeze.error) throw new Error(freeze.error.message);
      freezeQuantity = Math.max(0, Number(freeze.data?.quantity ?? 0));
      if (freezeQuantity > 0) streak = currentStreak + 1;
    }

    const reward = checkinReward(streak, isBaseApp);
    const currentPoints = Number(stats.points ?? 0);
    const currentCheckins = Math.max(0, Number(stats.total_checkins ?? 0));

    let update = admin
      .from("player_stats")
      .update({
        points: currentPoints + reward,
        checkin_streak: streak,
        last_checkin: today,
        total_checkins: currentCheckins + 1,
        updated_at: now.toISOString(),
      })
      .eq("wallet", wallet)
      .eq("points", currentPoints)
      .eq("checkin_streak", currentStreak)
      .eq("total_checkins", currentCheckins)
      .eq("updated_at", stats.updated_at);

    update = stats.last_checkin === null
      ? update.is("last_checkin", null)
      : update.eq("last_checkin", stats.last_checkin);

    const claimed = await update.select("wallet").maybeSingle();
    if (claimed.error) throw new Error(claimed.error.message);
    if (!claimed.data) continue;

    let usedFreeze = false;
    if (freezeQuantity > 0 && stats.last_checkin !== yesterday) {
      const consumed = await admin
        .from("player_items")
        .update({
          quantity: freezeQuantity - 1,
          updated_at: now.toISOString(),
        })
        .eq("wallet", wallet)
        .eq("item_slug", "streak_freeze")
        .eq("quantity", freezeQuantity)
        .select("wallet")
        .maybeSingle();
      if (consumed.error) {
        console.error("Could not consume streak freeze after check-in:", consumed.error);
      }
      usedFreeze = Boolean(consumed.data);
    }

    await awardFallbackCheckinXp(admin, wallet);
    return { points: reward, streak, usedFreeze, alreadyClaimed: false };
  }

  throw new Error("Daily check-in was updated concurrently; retry");
}

async function awardFallbackCheckinXp(admin: AdminClient, wallet: string) {
  // Only the CAS winner reaches this point, so concurrent API calls cannot
  // double-award XP. The atomic RPC performs this in the database transaction.
  await addSeasonXpServer(admin, wallet, CHECKIN_XP).catch((error) => {
    console.error("Failed to add check-in season XP:", error);
  });
}

function checkinReward(streak: number, isBaseApp: boolean) {
  const safeStreak = Math.max(1, Math.floor(streak));
  return isBaseApp
    ? 500 + Math.floor((safeStreak - 1) / 5) * 50
    : Math.ceil(safeStreak / 5) * 5;
}

function normalizeRpcResult(value: unknown): CheckinResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const points = Number(row.points);
  const streak = Number(row.streak);
  if (!Number.isFinite(points) || !Number.isFinite(streak)) return null;
  return {
    points: Math.max(0, Math.floor(points)),
    streak: Math.max(0, Math.floor(streak)),
    usedFreeze: row.usedFreeze === true,
    alreadyClaimed: row.alreadyClaimed === true,
  };
}

function isMissingAtomicRpc(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const rpcError = error as { code?: string; message?: string; details?: string };
  const message = `${rpcError.message ?? ""} ${rpcError.details ?? ""}`;
  return rpcError.code === "PGRST202"
    || rpcError.code === "42883"
    || /claim_daily_checkin_atomic.*(schema cache|not find|does not exist)/i.test(message);
}

function jsonError(error: string, status: number) {
  return jsonResponse({ error }, status);
}

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readSmallJson(req: NextRequest) {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RequestBodyTooLargeError();
  }
  if (!req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestBodyTooLargeError";
  }
}
