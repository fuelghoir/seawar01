import { supabase } from "./supabase";

export interface ReferralStats {
  count: number;
  activeCount: number;
  pendingCount: number;
}

export async function recordReferral(referrer: string, referee: string): Promise<void> {
  const r1 = referrer.toLowerCase();
  const r2 = referee.toLowerCase();
  if (r1 === r2) return;

  await supabase.from("referrals").upsert(
    { referrer: r1, referee: r2 },
    { onConflict: "referee", ignoreDuplicates: true }
  );
}

export async function getReferralStats(wallet: string): Promise<ReferralStats> {
  const addr = wallet.toLowerCase();
  const { data: refs } = await supabase
    .from("referrals")
    .select("referee")
    .eq("referrer", addr);

  if (!refs || refs.length === 0) return { count: 0, activeCount: 0, pendingCount: 0 };

  const referees = refs.map(r => r.referee as string);
  const { data: stats } = await supabase
    .from("player_stats")
    .select("wallet, games_played")
    .in("wallet", referees);

  const activeCount = (stats || []).filter(s => (s.games_played ?? 0) > 0).length;

  return {
    count: refs.length,
    activeCount,
    pendingCount: refs.length - activeCount,
  };
}

export function getReferralLink(wallet: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}?ref=${wallet.toLowerCase()}`;
}
