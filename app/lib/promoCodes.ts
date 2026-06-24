import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const PROMO_ITEM_SLUGS = [
  "double_points_1h",
  "quest_reroll",
  "streak_freeze",
  "radar_scan",
  "torpedo",
] as const;

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

type CreatePromoInput = {
  id?: unknown;
  title?: unknown;
  points?: unknown;
  itemSlug?: unknown;
  quantity?: unknown;
  note?: unknown;
  expiresDays?: unknown;
};

const CODE_PREFIX = "SBP1";
const PROMO_ID_RE = /^[a-z0-9][a-z0-9_-]{2,48}$/;
const MAX_POINTS = 10_000_000;
const MAX_QUANTITY = 999;

export function createPromoCode(input: CreatePromoInput) {
  const payload = createPromoPayload(input);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encoded);
  return {
    payload,
    code: `${CODE_PREFIX}.${encoded}.${signature}`,
  };
}

export function verifyPromoCode(value: unknown): PromoCodePayload {
  const raw = normalizePromoCode(value);
  const [prefix, encoded, signature] = raw.split(".");
  if (prefix !== CODE_PREFIX || !encoded || !signature) {
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
  if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
    throw new Error("Promo code expired");
  }
  return payload;
}

export function normalizePromoCode(value: unknown) {
  let raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    raw = url.searchParams.get("promo") || raw;
  } catch {
    const match = /[?&]promo=([^&]+)/.exec(raw);
    if (match) raw = decodeURIComponent(match[1]);
  }

  return raw.replace(/\s+/g, "");
}

export function promoRedemptionMarker(promoId: string) {
  return `promo:${promoId}`;
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

function sign(value: string) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) throw new Error("Promo signing secret is not configured");
  return createHmac("sha256", secret).update(value).digest("base64url");
}
