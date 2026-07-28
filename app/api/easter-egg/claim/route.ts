import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";
import { adminSupabase } from "../../../lib/adminSupabase";
import { buildEasterEggClaimMessage } from "../../../lib/easterEggIdentity";
import { grantRawPointsServer, normalizeSeasonWallet } from "../../../lib/seasonServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const SIGNATURE_TTL_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const BASE_RPCS = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
].filter((url): url is string => Boolean(url));
const publicClient = createPublicClient({
  chain: base,
  transport: fallback(BASE_RPCS.map((url) => http(url, { retryCount: 0, timeout: 3_000 }))),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeSeasonWallet(body?.wallet);
  if (!wallet) {
    return jsonError("Invalid wallet address", 400);
  }

  const signature = String(body?.signature ?? "");
  const issuedAt = Number(body?.issuedAt);
  const message = buildEasterEggClaimMessage(wallet, issuedAt);
  const age = Date.now() - issuedAt;
  if (
    !message ||
    !/^0x[a-fA-F0-9]+$/.test(signature) ||
    !Number.isFinite(age) ||
    age < -MAX_FUTURE_SKEW_MS ||
    age > SIGNATURE_TTL_MS
  ) {
    return jsonError("Valid wallet signature required", 401);
  }

  try {
    const valid = await publicClient.verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) return jsonError("Invalid wallet signature", 401);

    const admin = adminSupabase();

    // 1. Check if user already claimed and check cooldown
    const { data: claim, error: fetchError } = await admin
      .from("easter_egg_claims")
      .select("last_claimed_at, total_claims")
      .eq("wallet", wallet)
      .maybeSingle();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (claim) {
      const lastClaimed = new Date(claim.last_claimed_at).getTime();
      const elapsed = Date.now() - lastClaimed;
      if (elapsed < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - elapsed;
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        return jsonError(`Cooldown active. Try again in ${remainingDays} day(s).`, 400);
      }
    }

    // 2. Determine points reward: random between 1,000 and 10,000 points
    const points = Math.floor(Math.random() * (10000 - 1000 + 1)) + 1000;

    // 3. Save/update the points-only claim.
    const claimedAt = new Date().toISOString();
    const nextClaim = {
      wallet,
      last_claimed_at: claimedAt,
      total_claims: claim ? (claim.total_claims ?? 1) + 1 : 1,
      usd_eligible: false,
      updated_at: claimedAt,
    };
    if (claim) {
      const { data, error } = await admin
        .from("easter_egg_claims")
        .update(nextClaim)
        .eq("wallet", wallet)
        .eq("last_claimed_at", claim.last_claimed_at)
        .select("wallet");
      if (error) throw new Error(error.message);
      if (!data?.length) return jsonError("Claim already in progress", 409);
    } else {
      const { error } = await admin.from("easter_egg_claims").insert(nextClaim);
      if (error?.code === "23505") return jsonError("Claim already in progress", 409);
      if (error) throw new Error(error.message);
    }

    // 4. Grant points
    await grantRawPointsServer(admin, wallet, points);

    return NextResponse.json({ success: true, points }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not claim easter egg", 500);
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
}
