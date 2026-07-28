import { supabase } from "./supabase";
import {
  normalizeReferralToken,
  normalizeReferralWallet,
} from "./referralIdentity";

export { buildReferralRecordMessage } from "./referralIdentity";

type ReferralRow = {
  referee: string;
  first_game_bonus_paid_at?: string | null;
  first_game_bonus_points?: number | null;
};

export interface ReferralStats {
  count: number;
  activeCount: number;
  pendingCount: number;
  paidCount: number;
  unpaidActiveCount: number;
  firstGameBonusPoints: number;
}

export type ReferralLinks = {
  wallet: string;
  code: string | null;
  ref: string;
  link: string;
  baseLink: string;
};

export async function recordReferral(
  referrer: string,
  referee: string,
  signature: string,
  issuedAt: number,
): Promise<boolean> {
  const r1 = normalizeReferralRef(referrer);
  const r2 = normalizeReferralWallet(referee);
  if (!r1 || !r2 || r1 === r2) return false;

  const res = await fetch("/api/referrals/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ ref: r1, referee: r2, signature, issuedAt }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Could not record referral");
  return Boolean(data?.recorded);
}

export async function resolveReferralRef(refValue: string): Promise<string | null> {
  const ref = normalizeReferralRef(refValue);
  if (!ref) return null;

  const res = await fetch(`/api/referrals/resolve?ref=${encodeURIComponent(ref)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Could not resolve referral");
  return normalizeReferralWallet(data?.referrer);
}

export async function getReferralStats(wallet: string): Promise<ReferralStats> {
  const addr = normalizeReferralWallet(wallet);
  if (!addr) return emptyReferralStats();

  const refsWithRewards = await supabase
    .from("referrals")
    .select("referee, first_game_bonus_paid_at, first_game_bonus_points")
    .eq("referrer", addr);

  let refs: ReferralRow[];
  let hasRewardColumns = true;

  if (refsWithRewards.error) {
    if (!isReferralRewardSchemaMissing(refsWithRewards.error)) {
      throw new Error(refsWithRewards.error.message);
    }

    const legacyRefs = await supabase
      .from("referrals")
      .select("referee")
      .eq("referrer", addr);
    if (legacyRefs.error) throw new Error(legacyRefs.error.message);

    refs = (legacyRefs.data || []).map((ref) => ({ referee: ref.referee as string }));
    hasRewardColumns = false;
  } else {
    refs = (refsWithRewards.data || []) as ReferralRow[];
  }

  if (!refs || refs.length === 0) return emptyReferralStats();

  const referees = refs.map(r => r.referee as string);
  const { data: stats, error: statsError } = await supabase
    .from("player_stats")
    .select("wallet, games_played")
    .in("wallet", referees);
  if (statsError) throw new Error(statsError.message);

  const activeCount = (stats || []).filter(s => (s.games_played ?? 0) > 0).length;
  const paidRefs = hasRewardColumns
    ? refs.filter((ref) => !!ref.first_game_bonus_paid_at)
    : refs.slice(0, activeCount);
  const paidCount = paidRefs.length;
  const firstGameBonusPoints = hasRewardColumns
    ? paidRefs.reduce((sum, ref) => sum + Number(ref.first_game_bonus_points ?? 0), 0)
    : paidCount * 1000;

  return {
    count: refs.length,
    activeCount,
    pendingCount: refs.length - activeCount,
    paidCount,
    unpaidActiveCount: Math.max(0, activeCount - paidCount),
    firstGameBonusPoints,
  };
}

export async function awardFirstGameReferralBonus(referee: string): Promise<boolean> {
  const addr = normalizeReferralWallet(referee);
  if (!addr) return false;

  const { data, error } = await supabase.rpc("award_referral_first_game_bonus", {
    p_referee: addr,
  });

  if (error) throw new Error(error.message);
  return Boolean(data);
}

export function getReferralLink(refValue: string): string {
  if (typeof window === "undefined") return "";
  return buildReferralUrl(window.location.origin, refValue);
}

export function getBaseAppReferralLink(refValue: string): string {
  return buildReferralUrl("https://base.app/app/seabattle.top", refValue);
}

export async function getPreferredReferralLinks(walletValue: string): Promise<ReferralLinks> {
  const wallet = normalizeReferralWallet(walletValue);
  if (!wallet) throw new Error("Invalid referral wallet");

  const fallback: ReferralLinks = {
    wallet,
    code: null,
    ref: wallet,
    link: getReferralLink(wallet),
    baseLink: getBaseAppReferralLink(wallet),
  };

  const res = await fetch(`/api/referrals/link?wallet=${encodeURIComponent(wallet)}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return fallback;

  const ref = normalizeReferralRef(data?.ref);
  if (!ref || typeof data?.link !== "string" || typeof data?.baseLink !== "string") {
    return fallback;
  }

  return {
    wallet,
    code: typeof data.code === "string" ? data.code : null,
    ref,
    link: data.link,
    baseLink: data.baseLink,
  };
}

export function normalizeReferralRef(ref: string | null | undefined): string | null {
  return normalizeReferralToken(ref);
}

export function extractReferralRefFromCurrentUrl(): string | null {
  if (typeof window === "undefined") return null;
  return extractReferralRefFromUrl(window.location.href);
}

export function extractReferralRefFromMiniAppContext(context: unknown): string | null {
  const ctx = asRecord(context);
  const location = asRecord(ctx?.location);
  const cast = asRecord(location?.cast);

  const candidates: unknown[] = [
    location?.embed,
    ...(Array.isArray(cast?.embeds) ? cast.embeds : []),
    cast?.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const ref = extractReferralRefFromUrl(candidate) ?? extractReferralRefFromText(candidate);
    if (ref) return ref;
  }

  return null;
}

export function extractReferralRefFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  const absoluteBase =
    typeof window !== "undefined" ? window.location.origin : "https://seabattle.top";

  try {
    const url = new URL(value, absoluteBase);
    const direct = normalizeReferralRef(url.searchParams.get("ref"));
    if (direct) return direct;

    for (const nestedKey of ["url", "target", "redirect", "miniAppUrl"]) {
      const nested = url.searchParams.get(nestedKey);
      const nestedRef = nested ? extractReferralRefFromUrl(nested) : null;
      if (nestedRef) return nestedRef;
    }

    const hashRef = extractReferralRefFromText(url.hash);
    if (hashRef) return hashRef;
  } catch {
    // Fall through to regex parsing for non-URL strings.
  }

  return extractReferralRefFromText(value);
}

function buildReferralUrl(baseUrl: string, refValue: string): string {
  const ref = normalizeReferralRef(refValue);
  if (!ref) return baseUrl;

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("ref", ref);
    return url.toString();
  } catch {
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}ref=${encodeURIComponent(ref)}`;
  }
}

function extractReferralRefFromText(text: string): string | null {
  const match = text.match(/[?&#]ref=([a-zA-Z0-9_-]{3,42})(?![a-zA-Z0-9_-])/);
  return normalizeReferralRef(match?.[1]);
}

function emptyReferralStats(): ReferralStats {
  return {
    count: 0,
    activeCount: 0,
    pendingCount: 0,
    paidCount: 0,
    unpaidActiveCount: 0,
    firstGameBonusPoints: 0,
  };
}



function isReferralRewardSchemaMissing(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    /award_referral_first_game_bonus|first_game_bonus|schema cache|function/i.test(
      error.message ?? ""
    )
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
