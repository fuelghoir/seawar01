import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../lib/adminSupabase";
import {
  ACQUISITION_COOKIE_MAX_AGE,
  ACQUISITION_COOKIE_NAME,
  acquisitionRateLimitSubject,
  consumeAcquisitionRateLimit,
  createAcquisitionSession,
  readAcquisitionSessionId,
  recordAcquisitionSession,
  type AcquisitionEvent,
  type AcquisitionTouch,
} from "../../lib/acquisitionServer";
import { normalizeReferralToken } from "../../lib/referralIdentity";
import { getPublicAppUrl } from "../../lib/publicUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Vary: "Cookie, Origin, Sec-Fetch-Site",
};
const MAX_BODY_BYTES = 8 * 1024;
const SAFE_TEXT_RE = /^[^\u0000-\u001f\u007f]*$/;
const WALLET_RE = /^0x[a-f0-9]{40}$/;
const VISIT_KEYS = new Set([
  "event",
  "ref",
  "source",
  "medium",
  "campaign",
  "content",
  "referrer",
  "landingPath",
  "platform",
]);
const WALLET_KEYS = new Set(["event", "wallet"]);
const INVALID = Symbol("invalid acquisition field");

type AcquisitionRequest =
  | {
      event: "visit";
      ref?: string | null;
      source?: string | null;
      medium?: string | null;
      campaign?: string | null;
      content?: string | null;
      referrer?: string | null;
      landingPath?: string | null;
      platform?: "base_app" | "farcaster" | "web" | null;
    }
  | { event: "wallet"; wallet: string };
type AcquisitionErrorCode =
  | "forbidden"
  | "invalid_request"
  | "payload_too_large"
  | "rate_limited"
  | "visit_required"
  | "acquisition_unavailable";
type AcquisitionSuccessResponse = {
  ok: true;
  event: AcquisitionEvent;
  tracked: true;
  visits: number;
  walletAttached: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};
type AcquisitionErrorResponse = {
  ok: false;
  code: AcquisitionErrorCode;
  error: string;
};

export async function POST(req: NextRequest) {
  if (!isTrustedAcquisitionRequest(req)) {
    return jsonError("forbidden", "Cross-site acquisition events are not accepted", 403);
  }

  let admin: ReturnType<typeof adminSupabase>;
  try {
    admin = adminSupabase();
    const rateLimit = await consumeAcquisitionRateLimit(
      admin,
      acquisitionRateLimitSubject(req),
    );
    if (!rateLimit.allowed) {
      const response = jsonError(
        "rate_limited",
        "Too many acquisition events. Please retry shortly",
        429,
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }
  } catch (error) {
    // A missing RPC during a rolling migration follows the endpoint's existing
    // safe failure mode instead of silently running without durable limits.
    console.error("Acquisition rate limit failed:", error);
    return jsonError(
      "acquisition_unavailable",
      "Acquisition tracking is temporarily unavailable",
      503,
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError("payload_too_large", "Request body is too large", 413);
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    return body.tooLarge
      ? jsonError("payload_too_large", "Request body is too large", 413)
      : jsonError("invalid_request", "Invalid JSON body", 400);
  }

  const parsed = parseRequest(body.value);
  if (!parsed) {
    return jsonError("invalid_request", "Invalid acquisition event", 400);
  }

  let normalized: NormalizedRequest;
  try {
    normalized = normalizeRequest(parsed);
  } catch (error) {
    return jsonError(
      "invalid_request",
      error instanceof Error ? error.message : "Invalid acquisition event",
      400,
    );
  }

  let sessionId = readAcquisitionSessionId(req);
  let newCookieValue: string | null = null;

  // A client-reported wallet may only attach to a session established by a
  // real visit. This prevents wallet-only requests from manufacturing rows.
  if (!sessionId && normalized.event !== "visit") {
    return jsonError("visit_required", "A tracked visit is required first", 409);
  }

  try {
    if (!sessionId) {
      const created = createAcquisitionSession();
      sessionId = created.id;
      newCookieValue = created.cookieValue;
    }

    const record = await recordAcquisitionSession(
      admin,
      sessionId,
      normalized.event,
      normalized.touch,
      normalized.wallet,
    );
    const payload: AcquisitionSuccessResponse = {
      ok: true,
      event: normalized.event,
      tracked: true,
      visits: record.visitCount,
      walletAttached: record.walletAttached,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
    };
    const response = NextResponse.json(payload, { headers: NO_STORE_HEADERS });
    if (newCookieValue) setSessionCookie(response, newCookieValue);
    return response;
  } catch (error) {
    console.error("Acquisition API failed:", error);
    // Both a rolling migration and a transient database/configuration failure
    // are non-critical for gameplay and use the same deliberately-safe reply.
    const response = jsonError(
      "acquisition_unavailable",
      "Acquisition tracking is temporarily unavailable",
      503,
    );
    if (newCookieValue) setSessionCookie(response, newCookieValue);
    return response;
  }
}

function isTrustedAcquisitionRequest(req: NextRequest) {
  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return false;
  }

  const originHeader = req.headers.get("origin");
  if (!originHeader) return true;

  try {
    const origin = new URL(originHeader).origin;
    const allowedOrigins = new Set([
      req.nextUrl.origin,
      new URL(getPublicAppUrl()).origin,
    ]);
    return allowedOrigins.has(origin);
  } catch {
    return false;
  }
}

type NormalizedRequest = {
  event: AcquisitionEvent;
  touch: AcquisitionTouch;
  wallet: string | null;
};

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
    const value: unknown = JSON.parse(json);
    return { ok: true, value };
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

function parseRequest(value: unknown): AcquisitionRequest | null {
  if (!isRecord(value)) return null;

  if (value.event === "wallet") {
    if (!hasOnlyKeys(value, WALLET_KEYS) || typeof value.wallet !== "string") return null;
    const wallet = value.wallet.trim().toLowerCase();
    return WALLET_RE.test(wallet) ? { event: "wallet", wallet } : null;
  }

  if (value.event !== "visit" || !hasOnlyKeys(value, VISIT_KEYS)) return null;
  const ref = optionalText(value.ref, 42);
  const source = optionalText(value.source, 64);
  const medium = optionalText(value.medium, 64);
  const campaign = optionalText(value.campaign, 128);
  const content = optionalText(value.content, 128);
  const referrer = optionalText(value.referrer, 2_048);
  const landingPath = optionalText(value.landingPath, 512);
  const platform = optionalText(value.platform, 32);
  if (
    ref === INVALID ||
    source === INVALID ||
    medium === INVALID ||
    campaign === INVALID ||
    content === INVALID ||
    referrer === INVALID ||
    landingPath === INVALID ||
    platform === INVALID
  ) {
    return null;
  }
  if (
    platform !== undefined &&
    platform !== null &&
    platform !== "base_app" &&
    platform !== "farcaster" &&
    platform !== "web"
  ) {
    return null;
  }

  return {
    event: "visit",
    ref,
    source,
    medium,
    campaign,
    content,
    referrer,
    landingPath,
    platform,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") return INVALID;
  const clean = value.trim();
  return clean.length <= max && SAFE_TEXT_RE.test(clean) ? clean : INVALID;
}

function normalizeRequest(body: AcquisitionRequest): NormalizedRequest {
  if (body.event === "wallet") {
    return {
      event: "wallet",
      touch: emptyTouch(),
      wallet: body.wallet,
    };
  }

  const rawRef = cleanOptional(body.ref);
  const refToken = rawRef ? normalizeReferralToken(rawRef) : null;
  if (rawRef && !refToken) throw new Error("Invalid referral token");

  return {
    event: "visit",
    touch: {
      refToken,
      utmSource: cleanOptional(body.source)?.toLowerCase() ?? null,
      utmMedium: cleanOptional(body.medium)?.toLowerCase() ?? null,
      utmCampaign: cleanOptional(body.campaign),
      utmContent: cleanOptional(body.content),
      referrerHost: normalizeReferrerHost(body.referrer),
      landingPath: normalizeLandingPath(body.landingPath),
      platform: normalizePlatform(body.platform),
    },
    wallet: null,
  };
}

function emptyTouch(): AcquisitionTouch {
  return {
    refToken: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    referrerHost: null,
    landingPath: null,
    platform: null,
  };
}

function cleanOptional(value: string | null | undefined) {
  const clean = value?.trim();
  return clean ? clean : null;
}

function normalizeReferrerHost(value: string | null | undefined) {
  const clean = cleanOptional(value);
  if (!clean) return null;

  try {
    const url = new URL(clean);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Invalid referrer protocol");
    }
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname.length > 253) throw new Error("Invalid referrer host");
    return hostname;
  } catch {
    throw new Error("Invalid referrer URL");
  }
}

function normalizeLandingPath(value: string | null | undefined) {
  const clean = cleanOptional(value);
  if (!clean) return null;
  const pathOnly = clean.split(/[?#]/, 1)[0];
  if (!pathOnly.startsWith("/") || pathOnly.length > 512) {
    throw new Error("Invalid landing path");
  }
  return pathOnly;
}

function normalizePlatform(value: string | null | undefined) {
  return cleanOptional(value)?.toLowerCase() ?? null;
}

function setSessionCookie(response: NextResponse, value: string) {
  response.cookies.set(ACQUISITION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACQUISITION_COOKIE_MAX_AGE,
  });
}

function jsonError(code: AcquisitionErrorCode, error: string, status: number) {
  const payload: AcquisitionErrorResponse = { ok: false, code, error };
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}
