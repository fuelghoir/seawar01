import { supabase } from "./supabase";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

export interface ReferralStats {
  count: number;
  activeCount: number;
  pendingCount: number;
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
  if (!addr) return { count: 0, activeCount: 0, pendingCount: 0 };

  const { data: refs, error: refsError } = await supabase
    .from("referrals")
    .select("referee")
    .eq("referrer", addr);
  if (refsError) throw new Error(refsError.message);

  if (!refs || refs.length === 0) return { count: 0, activeCount: 0, pendingCount: 0 };

  const referees = refs.map(r => r.referee as string);
  const { data: stats, error: statsError } = await supabase
    .from("player_stats")
    .select("wallet, games_played")
    .in("wallet", referees);
  if (statsError) throw new Error(statsError.message);

  const activeCount = (stats || []).filter(s => (s.games_played ?? 0) > 0).length;

  return {
    count: refs.length,
    activeCount,
    pendingCount: refs.length - activeCount,
  };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
