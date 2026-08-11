import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import type { AdminClient } from "./adminSupabase";

export const ACQUISITION_COOKIE_NAME = "sea_acquisition";
export const ACQUISITION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
export const ACQUISITION_SUBJECT_RATE_LIMIT = 60;
export const ACQUISITION_GLOBAL_RATE_LIMIT = 2_000;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WALLET_RE = /^0x[a-f0-9]{40}$/;

export type AcquisitionEvent = "visit" | "wallet";

export type AcquisitionTouch = {
  refToken: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  platform: string | null;
};

export type AcquisitionRecord = {
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  walletAttached: boolean;
  walletAttachedAt: string | null;
  referralRecordedAt: string | null;
};

type AcquisitionRpcRow = {
  recorded_first_seen_at: unknown;
  recorded_last_seen_at: unknown;
  recorded_visit_count: unknown;
  recorded_wallet_attached: unknown;
  recorded_wallet_attached_at: unknown;
  recorded_referral_recorded_at: unknown;
};

type AcquisitionRateLimitRpcRow = {
  rate_limit_allowed: unknown;
  rate_limit_retry_after: unknown;
  rate_limit_subject_count: unknown;
  rate_limit_global_count: unknown;
};

export type AcquisitionRateLimit = {
  allowed: boolean;
  retryAfterSeconds: number;
  subjectCount: number;
  globalCount: number;
};

export class AcquisitionServerError extends Error {
  readonly databaseCode: string;

  constructor(message: string, databaseCode = "") {
    super(message);
    this.name = "AcquisitionServerError";
    this.databaseCode = databaseCode;
  }
}

export function createAcquisitionSession() {
  const id = randomUUID();
  return { id, cookieValue: signSessionId(id) };
}

export function readAcquisitionSessionId(
  request: Pick<NextRequest, "cookies">,
): string | null {
  const value = request.cookies.get(ACQUISITION_COOKIE_NAME)?.value;
  return value ? verifySessionCookie(value) : null;
}

/**
 * Builds a privacy-preserving rate-limit subject. Only a keyed digest reaches
 * PostgreSQL; the client IP itself is never stored or returned.
 *
 * Netlify's connection IP is authoritative in production. The remaining
 * headers keep previews and other trusted reverse proxies functional. Every
 * candidate is strictly parsed with node:net before it can influence a key.
 */
export function acquisitionRateLimitSubject(
  request: Pick<NextRequest, "headers">,
): string {
  const ip = readClientIp(request.headers);
  const secret = rateLimitSecret();
  if (!secret) {
    throw new AcquisitionServerError("Acquisition rate limiting is not configured");
  }

  return createHmac("sha256", secret)
    .update(`acquisition-rate-limit:v1:${ip ?? "unknown"}`)
    .digest("hex");
}

export async function consumeAcquisitionRateLimit(
  admin: AdminClient,
  subjectHash: string,
): Promise<AcquisitionRateLimit> {
  if (!/^[0-9a-f]{64}$/.test(subjectHash)) {
    throw new AcquisitionServerError("Acquisition rate-limit subject is invalid");
  }

  const { data, error } = await admin.rpc("consume_acquisition_rate_limit", {
    p_subject_hash: subjectHash,
    p_subject_limit: ACQUISITION_SUBJECT_RATE_LIMIT,
    p_global_limit: ACQUISITION_GLOBAL_RATE_LIMIT,
  });
  if (error) {
    throw new AcquisitionServerError(error.message, error.code);
  }

  const raw: unknown = Array.isArray(data) ? data[0] : data;
  return parseRateLimit(raw);
}

export async function recordAcquisitionSession(
  admin: AdminClient,
  sessionId: string,
  event: AcquisitionEvent,
  touch: AcquisitionTouch,
  wallet: string | null,
): Promise<AcquisitionRecord> {
  const { data, error } = await admin.rpc("record_acquisition_session", {
    p_session_id: sessionId,
    p_event: event,
    p_ref_token: touch.refToken,
    p_utm_source: touch.utmSource,
    p_utm_medium: touch.utmMedium,
    p_utm_campaign: touch.utmCampaign,
    p_utm_content: touch.utmContent,
    p_referrer_host: touch.referrerHost,
    p_landing_path: touch.landingPath,
    p_platform: touch.platform,
    p_wallet: wallet,
  });

  if (error) {
    throw new AcquisitionServerError(error.message, error.code);
  }

  const raw: unknown = Array.isArray(data) ? data[0] : data;
  return parseRecord(raw);
}

/**
 * Marks the verified referral funnel step without changing referral rewards.
 * Missing acquisition migrations are ignored so referral recording remains
 * available during a rolling deployment.
 */
export async function markAcquisitionReferralRecorded(
  admin: AdminClient,
  sessionId: string | null,
  walletValue: unknown,
): Promise<boolean> {
  const wallet = String(walletValue ?? "").trim().toLowerCase();
  if (!sessionId || !UUID_V4_RE.test(sessionId) || !WALLET_RE.test(wallet)) {
    return false;
  }

  const { data, error } = await admin.rpc("mark_acquisition_referral_recorded", {
    p_session_id: sessionId,
    p_wallet: wallet,
  });
  if (error) {
    const wrapped = new AcquisitionServerError(error.message, error.code);
    if (isAcquisitionSchemaUnavailable(wrapped)) return false;
    throw wrapped;
  }
  return data === true;
}

export function isAcquisitionSchemaUnavailable(error: unknown) {
  const code = error instanceof AcquisitionServerError ? error.databaseCode : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    /record_acquisition_session|mark_acquisition_referral_recorded|consume_acquisition_rate_limit|acquisition_sessions|acquisition_wallet_links|acquisition_rate_limit_buckets/i.test(
      message,
    ) && /schema cache|does not exist|could not find|unknown function/i.test(message)
  );
}

function rateLimitSecret() {
  return (
    process.env.ACQUISITION_RATE_LIMIT_SECRET ||
    process.env.ACQUISITION_COOKIE_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function sessionSecret() {
  return (
    process.env.ACQUISITION_COOKIE_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function signSessionId(id: string) {
  const secret = sessionSecret();
  if (!secret) {
    throw new AcquisitionServerError("Acquisition tracking is not configured");
  }
  const signature = createHmac("sha256", secret).update(id).digest("base64url");
  return `${id}.${signature}`;
}

function verifySessionCookie(value: string) {
  const secret = sessionSecret();
  if (!secret) return null;

  const [id, signature, extra] = value.split(".");
  if (!id || !signature || extra || !UUID_V4_RE.test(id)) return null;

  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret).update(id).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  return id;
}

function readClientIp(headers: Headers) {
  const netlifyIp = normalizeIp(headers.get("x-nf-client-connection-ip"));
  if (netlifyIp) return netlifyIp;

  for (const headerName of [
    "cf-connecting-ip",
    "x-vercel-forwarded-for",
    "x-real-ip",
  ]) {
    const ip = normalizeIp(headers.get(headerName));
    if (ip) return ip;
  }

  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor || forwardedFor.length > 1_024) return null;
  for (const candidate of forwardedFor.split(",", 16)) {
    const ip = normalizeIp(candidate);
    if (ip) return ip;
  }
  return null;
}

function normalizeIp(value: string | null) {
  if (!value) return null;
  const candidate = value.trim();
  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return null;

  // WHATWG URL parsing canonicalizes equivalent IPv6 spellings, preventing a
  // single address from receiving multiple buckets via alternate notation.
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): AcquisitionRecord {
  if (!value || typeof value !== "object") {
    throw new AcquisitionServerError("Acquisition record was not returned");
  }

  const row = value as AcquisitionRpcRow;
  const firstSeenAt = readTimestamp(row.recorded_first_seen_at);
  const lastSeenAt = readTimestamp(row.recorded_last_seen_at);
  const visitCount = Number(row.recorded_visit_count);
  const walletAttached = row.recorded_wallet_attached;
  const walletAttachedAt = readNullableTimestamp(row.recorded_wallet_attached_at);
  const referralRecordedAt = readNullableTimestamp(row.recorded_referral_recorded_at);

  if (
    !firstSeenAt ||
    !lastSeenAt ||
    !Number.isSafeInteger(visitCount) ||
    visitCount < 0 ||
    typeof walletAttached !== "boolean"
  ) {
    throw new AcquisitionServerError("Acquisition record is invalid");
  }

  return {
    firstSeenAt,
    lastSeenAt,
    visitCount,
    walletAttached,
    walletAttachedAt,
    referralRecordedAt,
  };
}

function parseRateLimit(value: unknown): AcquisitionRateLimit {
  if (!value || typeof value !== "object") {
    throw new AcquisitionServerError("Acquisition rate limit was not returned");
  }

  const row = value as AcquisitionRateLimitRpcRow;
  const allowed = row.rate_limit_allowed;
  const retryAfterSeconds = Number(row.rate_limit_retry_after);
  const subjectCount = Number(row.rate_limit_subject_count);
  const globalCount = Number(row.rate_limit_global_count);
  if (
    typeof allowed !== "boolean" ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 1 ||
    retryAfterSeconds > 60 ||
    !Number.isSafeInteger(subjectCount) ||
    subjectCount < 1 ||
    !Number.isSafeInteger(globalCount) ||
    globalCount < 0
  ) {
    throw new AcquisitionServerError("Acquisition rate limit is invalid");
  }

  return { allowed, retryAfterSeconds, subjectCount, globalCount };
}

function readTimestamp(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function readNullableTimestamp(value: unknown) {
  if (value === null) return null;
  const timestamp = readTimestamp(value);
  if (!timestamp) throw new AcquisitionServerError("Acquisition timestamp is invalid");
  return timestamp;
}
