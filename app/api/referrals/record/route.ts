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
import {
  markAcquisitionReferralRecorded,
  readAcquisitionSessionId,
} from "../../../lib/acquisitionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SIGNATURE_CHARS = 8_194;
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
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError("Request body is too large", 413);
  }

  const bodyResult = await readJsonBody(req);
  if (!bodyResult.ok && bodyResult.tooLarge) {
    return jsonError("Request body is too large", 413);
  }

  const body = bodyResult.ok ? asRecord(bodyResult.value) : null;
  const ref = normalizeReferralToken(body?.ref ?? body?.referrer);
  const referee = normalizeReferralWallet(body?.referee);
  const signature = typeof body?.signature === "string" ? body.signature : "";
  const issuedAt = Number(body?.issuedAt);
  if (!ref || !referee) return badRequest("Invalid referral reference or wallet");
  if (
    signature.length > MAX_SIGNATURE_CHARS ||
    !/^0x(?:[a-fA-F0-9]{2})+$/.test(signature)
  ) {
    return unauthorized("Referral signature required");
  }

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
    let attributed = recorded;
    if (!attributed) {
      const { data: storedReferral, error: storedReferralError } = await admin
        .from("referrals")
        .select("referrer")
        .eq("referee", referee)
        .maybeSingle();
      if (storedReferralError) throw new Error("Referral attribution lookup failed");
      attributed = String(storedReferral?.referrer ?? "").toLowerCase() === referrer;
    }

    if (attributed) {
      await markAcquisitionReferralRecorded(
        admin,
        readAcquisitionSessionId(req),
        referee,
      ).catch(() => false);
    }

    return NextResponse.json(
      { recorded, attributed },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error(
      "Referral record failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return jsonError("Could not record referral", 500);
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400, headers: NO_STORE_HEADERS });
}

function unauthorized(error: string) {
  return NextResponse.json({ error }, { status: 401, headers: NO_STORE_HEADERS });
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean };

async function readJsonBody(req: NextRequest): Promise<JsonBodyResult> {
  if (!req.body) return { ok: false, tooLarge: false };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(json) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}
