import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";
import { adminSupabase } from "../../../lib/adminSupabase";
import {
  buildReferralRecordMessage,
  normalizeReferralToken,
  normalizeReferralWallet,
} from "../../../lib/referralIdentity";
import {
  recordReferralServer,
  resolveReferralRefServer,
} from "../../../lib/referralServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_TTL_MS = 10 * 60 * 1000;
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
  transport: fallback(
    BASE_RPCS.map((url) => http(url, { retryCount: 0, timeout: 3_000 })),
  ),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const ref = normalizeReferralToken(body?.ref ?? body?.referrer);
  const referee = normalizeReferralWallet(body?.referee);
  const signature = String(body?.signature ?? "");
  const issuedAt = Number(body?.issuedAt);
  if (!ref || !referee) return badRequest("Invalid referral reference or wallet");
  if (!/^0x[a-fA-F0-9]+$/.test(signature)) return unauthorized("Referral signature required");

  const message = buildReferralRecordMessage(ref, referee, issuedAt);
  const age = Date.now() - issuedAt;
  if (
    !message ||
    !Number.isFinite(age) ||
    age < -MAX_FUTURE_SKEW_MS ||
    age > SIGNATURE_TTL_MS
  ) {
    return unauthorized("Referral signature expired");
  }

  try {
    const admin = adminSupabase();
    const referrer = await resolveReferralRefServer(admin, ref);
    if (!referrer) return badRequest("Unknown referral code");
    if (referrer === referee) return badRequest("Self-referrals are not allowed");

    const valid = await publicClient.verifyMessage({
      address: referee as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) return unauthorized("Invalid referral signature");

    const recorded = await recordReferralServer(admin, referrer, referee);
    return NextResponse.json({ recorded }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Could not record referral");
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400, headers: NO_STORE_HEADERS });
}

function unauthorized(error: string) {
  return NextResponse.json({ error }, { status: 401, headers: NO_STORE_HEADERS });
}
