import { supabase } from "./supabase";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

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

export async function recordReferral(referrer: string, referee: string): Promise<boolean> {
  const r1 = normalizeReferralRef(referrer);
  const r2 = normalizeReferralRef(referee);
  if (!r1 || !r2 || r1 === r2) return false;

  const { error } = await supabase.from("referrals").upsert(
    { referrer: r1, referee: r2 },
    { onConflict: "referee", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
  return true;
}

export async function getReferralStats(wallet: string): Promise<ReferralStats> {
  const addr = normalizeReferralRef(wallet);
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
  const addr = normalizeReferralRef(referee);
  if (!addr) return false;

  const { data, error } = await supabase.rpc("award_referral_first_game_bonus", {
    p_referee: addr,
  });

  if (!error) return Boolean(data);
  if (!isReferralRewardSchemaMissing(error)) throw new Error(error.message);

  return awardFirstGameReferralBonusLegacy(addr);
}

export function getReferralLink(wallet: string): string {
  if (typeof window === "undefined") return "";
  return buildReferralUrl(window.location.origin, wallet);
}

export function getBaseAppReferralLink(wallet: string): string {
  return buildReferralUrl("https://base.app/app/seawar01.vercel.app", wallet);
}

export function normalizeReferralRef(ref: string | null | undefined): string | null {
  const normalized = ref?.trim().toLowerCase();
  if (!normalized) return null;
  return WALLET_RE.test(normalized) ? normalized : null;
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
    typeof window !== "undefined" ? window.location.origin : "https://seawar01.vercel.app";

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

function buildReferralUrl(baseUrl: string, wallet: string): string {
  const ref = normalizeReferralRef(wallet);
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
  const match = text.match(/[?&#]ref=(0x[a-fA-F0-9]{40})\b/);
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

async function awardFirstGameReferralBonusLegacy(referee: string): Promise<boolean> {
  const markPaid = await supabase
    .from("referrals")
    .update({
      first_game_bonus_paid_at: new Date().toISOString(),
      first_game_bonus_points: 1000,
    })
    .eq("referee", referee)
    .is("first_game_bonus_paid_at", null)
    .select("referrer")
    .maybeSingle();

  if (!markPaid.error) {
    const referrer = normalizeReferralRef(markPaid.data?.referrer as string | null);
    if (!referrer) return false;
    await grantReferralPoints(referrer, 1000);
    return true;
  }

  if (!isReferralRewardSchemaMissing(markPaid.error)) {
    throw new Error(markPaid.error.message);
  }

  const { data: ref, error: refError } = await supabase
    .from("referrals")
    .select("referrer")
    .eq("referee", referee)
    .maybeSingle();
  if (refError) throw new Error(refError.message);

  const referrer = normalizeReferralRef(ref?.referrer as string | null);
  if (!referrer) return false;

  await grantReferralPoints(referrer, 1000);
  return true;
}

async function grantReferralPoints(wallet: string, points: number): Promise<void> {
  const addr = normalizeReferralRef(wallet);
  if (!addr || points <= 0) return;

  const { data, error } = await supabase
    .from("player_stats")
    .select("points")
    .eq("wallet", addr)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    const { error: updateError } = await supabase
      .from("player_stats")
      .update({
        points: Number(data.points ?? 0) + points,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", addr);
    if (updateError) throw new Error(updateError.message);
    return;
  }

  const { error: insertError } = await supabase
    .from("player_stats")
    .insert({ wallet: addr, points });
  if (insertError) throw new Error(insertError.message);
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
