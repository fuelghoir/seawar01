import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const PROMO_ITEM_SLUGS = [
  "double_points_1h",
  "quest_reroll",
  "streak_freeze",
  "radar_scan",
  "torpedo",
] as const;

export const PROMO_CAMPAIGN_WALLET = "0x0000000000000000000000000000000000000000";

export type PromoItemSlug = (typeof PROMO_ITEM_SLUGS)[number];

export type PromoCodePayload = {
  v: 1;
  id: string;
  title: string;
  points: number;
  itemSlug: PromoItemSlug | null;
  quantity: number;
  note: string;
  createdAt: string;
  expiresAt: string | null;
};

export type PromoCampaignRecord = {
  points?: number | null;
  item_slug?: string | null;
  quantity?: number | null;
  reward_label?: string | null;
  admin_note?: string | null;
  created_at?: string | null;
  status?: string | null;
};

type CreatePromoInput = {
  id?: unknown;
  code?: unknown;
  title?: unknown;
  points?: unknown;
  itemSlug?: unknown;
  quantity?: unknown;
  note?: unknown;
  expiresDays?: unknown;
};

const SIGNED_CODE_PREFIX = "SBP1";
const PROMO_ID_RE = /^[a-z0-9][a-z0-9_-]{2,48}$/;
const PUBLIC_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const MAX_POINTS = 10_000_000;
const MAX_QUANTITY = 999;

export function createPromoCampaign(input: CreatePromoInput) {
  const code = normalizePromoPublicCode(input.code ?? input.id, { generate: true });
  const payload = createPromoPayload({
    ...input,
    id: promoIdFromCode(code),
  });
  return { payload, code };
}

export function createPromoCode(input: CreatePromoInput) {
  const payload = createPromoPayload(input);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encoded);
  return {
    payload,
    code: `${SIGNED_CODE_PREFIX}.${encoded}.${signature}`,
  };
}

export function verifyPromoCode(value: unknown): PromoCodePayload {
  const raw = normalizePromoCode(value);
  const [prefix, encoded, signature] = raw.split(".");
  if (prefix !== SIGNED_CODE_PREFIX || !encoded || !signature) {
    throw new Error("Invalid promo code");
  }

  const expected = sign(encoded);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid promo code");
  }

  let payload: PromoCodePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid promo code");
  }

  assertPromoPayload(payload);
  assertPromoNotExpired(payload);
  return payload;
}

export function isSignedPromoCode(value: unknown) {
  return normalizePromoCode(value).startsWith(`${SIGNED_CODE_PREFIX}.`);
}

export function normalizePromoCode(value: unknown) {
  let raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    raw =
      url.searchParams.get("code") ||
      url.searchParams.get("promo") ||
      promoCodeFromPath(url.pathname) ||
      raw;
  } catch {
    const queryMatch = /[?&](?:code|promo)=([^&]+)/i.exec(raw);
    if (queryMatch) raw = decodeURIComponent(queryMatch[1]);
    else raw = promoCodeFromPath(raw) || raw;
  }

  const compact = raw.trim().replace(/\s+/g, "");
  return compact.startsWith(`${SIGNED_CODE_PREFIX}.`) ? compact : compact.toUpperCase();
}

export function normalizePromoPublicCode(
  value: unknown,
  options: { generate?: boolean } = {},
) {
  const raw = normalizePromoCode(value);
  if (!raw && options.generate) return generatePromoPublicCode();
  if (raw.startsWith(`${SIGNED_CODE_PREFIX}.`)) {
    throw new Error("Use a short public code, not a signed token");
  }

  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  if (!PUBLIC_CODE_RE.test(cleaned)) {
    throw new Error("Promo code must be 3-32 chars: A-Z, 0-9, - or _");
  }
  return cleaned;
}

export function promoIdFromCode(code: string) {
  return normalizePromoPublicCode(code).toLowerCase();
}

export function promoCampaignMarker(promoId: string) {
  return `promo_campaign:${promoId}`;
}

export function promoRedemptionMarker(promoId: string) {
  return `promo:${promoId}`;
}

export function serializePromoCampaignNote(payload: PromoCodePayload, code: string) {
  return JSON.stringify({
    v: 1,
    code,
    title: payload.title,
    note: payload.note,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
  });
}

export function promoCampaignFromRecord(record: PromoCampaignRecord, code: string) {
  const normalizedCode = normalizePromoPublicCode(code);
  const meta = parsePromoCampaignNote(record.admin_note);
  const itemSlug = normalizePromoItemSlug(record.item_slug);
  const quantity = itemSlug ? clampInteger(record.quantity, 1, MAX_QUANTITY) : 0;
  const payload: PromoCodePayload = {
    v: 1,
    id: promoIdFromCode(normalizedCode),
    title: normalizeTitle(meta.title || record.reward_label || `Promo ${normalizedCode}`),
    points: clampInteger(record.points, 0, MAX_POINTS),
    itemSlug,
    quantity,
    note: String(meta.note ?? "").trim().slice(0, 500),
    createdAt: normalizeIsoDate(meta.createdAt || record.created_at) || new Date(0).toISOString(),
    expiresAt: normalizeIsoDate(meta.expiresAt),
  };

  assertPromoPayload(payload);
  assertPromoNotExpired(payload);
  return payload;
}

export function promoItemLabel(slug: PromoItemSlug | null) {
  if (!slug) return "";
  const labels: Record<PromoItemSlug, string> = {
    double_points_1h: "Double Points",
    quest_reroll: "Quest Reroll",
    streak_freeze: "Streak Freeze",
    radar_scan: "Radar Scan",
    torpedo: "Torpedo",
  };
  return labels[slug];
}

function createPromoPayload(input: CreatePromoInput): PromoCodePayload {
  const id = normalizePromoId(input.id);
  const title = normalizeTitle(input.title);
  const points = clampInteger(input.points, 0, MAX_POINTS);
  const itemSlug = normalizePromoItemSlug(input.itemSlug);
  const quantity = itemSlug ? clampInteger(input.quantity, 1, MAX_QUANTITY) : 0;
  const note = String(input.note ?? "").trim().slice(0, 500);
  const expiresDays = clampInteger(input.expiresDays, 0, 365);

  if (points <= 0 && (!itemSlug || quantity <= 0)) {
    throw new Error("Promo needs points or an item");
  }

  const createdAt = new Date();
  const expiresAt = expiresDays > 0
    ? new Date(createdAt.getTime() + expiresDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return {
    v: 1,
    id,
    title,
    points,
    itemSlug,
    quantity,
    note,
    createdAt: createdAt.toISOString(),
    expiresAt,
  };
}

function assertPromoPayload(payload: PromoCodePayload) {
  if (payload?.v !== 1) throw new Error("Invalid promo code");
  if (!PROMO_ID_RE.test(payload.id)) throw new Error("Invalid promo code");
  if (typeof payload.title !== "string" || payload.title.length > 80) {
    throw new Error("Invalid promo code");
  }
  if (!Number.isInteger(payload.points) || payload.points < 0 || payload.points > MAX_POINTS) {
    throw new Error("Invalid promo code");
  }
  if (payload.itemSlug !== null && !isPromoItemSlug(payload.itemSlug)) {
    throw new Error("Invalid promo code");
  }
  if (!Number.isInteger(payload.quantity) || payload.quantity < 0 || payload.quantity > MAX_QUANTITY) {
    throw new Error("Invalid promo code");
  }
  if (payload.points <= 0 && (!payload.itemSlug || payload.quantity <= 0)) {
    throw new Error("Invalid promo code");
  }
}

function assertPromoNotExpired(payload: PromoCodePayload) {
  if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
    throw new Error("Promo code expired");
  }
}

function normalizePromoId(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const cleaned = raw.replace(/^-+|-+$/g, "").slice(0, 48);
  if (PROMO_ID_RE.test(cleaned)) return cleaned;
  return `promo-${randomBytes(5).toString("hex")}`;
}

function normalizeTitle(value: unknown) {
  const title = String(value ?? "").trim().slice(0, 80);
  return title || "Promo bonus";
}

function normalizePromoItemSlug(value: unknown): PromoItemSlug | null {
  const slug = String(value ?? "").trim();
  return isPromoItemSlug(slug) ? slug : null;
}

function isPromoItemSlug(value: string): value is PromoItemSlug {
  return PROMO_ITEM_SLUGS.includes(value as PromoItemSlug);
}

function clampInteger(value: unknown, min: number, max: number) {
  const number = Math.floor(Number(value ?? 0));
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function parsePromoCampaignNote(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return {
      title: typeof parsed?.title === "string" ? parsed.title : "",
      note: typeof parsed?.note === "string" ? parsed.note : "",
      createdAt: typeof parsed?.createdAt === "string" ? parsed.createdAt : "",
      expiresAt: typeof parsed?.expiresAt === "string" ? parsed.expiresAt : "",
    };
  } catch {
    return { title: "", note: String(value ?? ""), createdAt: "", expiresAt: "" };
  }
}

function normalizeIsoDate(value: unknown) {
  if (!value) return null;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function promoCodeFromPath(path: string) {
  const match = /(?:^|\/)(?:promo|p)\/([^/?#]+)/i.exec(path);
  return match ? decodeURIComponent(match[1]) : "";
}

function generatePromoPublicCode() {
  return `SEA-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function sign(value: string) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) throw new Error("Promo signing secret is not configured");
  return createHmac("sha256", secret).update(value).digest("base64url");
}
