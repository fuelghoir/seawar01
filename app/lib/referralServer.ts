import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeReferralCode,
  normalizeReferralToken,
  normalizeReferralWallet,
} from "./referralIdentity";

export { normalizeReferralWallet } from "./referralIdentity";

export type ReferralCodeRow = {
  code: string;
  wallet: string;
  is_primary: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function resolveReferralRefServer(
  admin: SupabaseClient,
  value: unknown,
): Promise<string | null> {
  const token = normalizeReferralToken(value);
  if (!token) return null;

  const legacyWallet = normalizeReferralWallet(token);
  if (legacyWallet) return legacyWallet;

  const code = normalizeReferralCode(token);
  if (!code) return null;

  const { data, error } = await admin
    .from("referral_codes")
    .select("wallet")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeReferralWallet(data?.wallet);
}

export async function getPrimaryReferralCodeServer(
  admin: SupabaseClient,
  walletValue: unknown,
): Promise<string | null> {
  const wallet = normalizeReferralWallet(walletValue);
  if (!wallet) return null;

  const { data, error } = await admin
    .from("referral_codes")
    .select("code")
    .eq("wallet", wallet)
    .eq("is_primary", true)
    .maybeSingle();
  if (error) {
    // Legacy wallet links keep working while the migration is being deployed.
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw new Error(error.message);
  }
  return normalizeReferralCode(data?.code);
}

export async function recordReferralServer(
  admin: SupabaseClient,
  referrerValue: unknown,
  refereeValue: unknown,
): Promise<boolean> {
  const referrer = await resolveReferralRefServer(admin, referrerValue);
  const referee = normalizeReferralWallet(refereeValue);
  if (!referrer || !referee) return false;
  if (referrer === referee) return false;

  const { data, error } = await admin
    .from("referrals")
    .upsert(
      { referrer, referee },
      { onConflict: "referee", ignoreDuplicates: true },
    )
    .select("referee")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function awardReferralFirstGameBonusServer(
  admin: SupabaseClient,
  referee: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("award_referral_first_game_bonus", {
    p_referee: referee,
  });

  if (error) {
    if (
      error.code === "PGRST202" ||
      /award_referral_first_game_bonus|schema cache|function/i.test(error.message ?? "")
    ) {
      return false;
    }
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function awardReferralGamePointsServer(
  admin: SupabaseClient,
  refereeValue: unknown,
  earnedPointsValue: number,
  sourceKeyValue: unknown,
): Promise<number> {
  const referee = normalizeReferralWallet(refereeValue);
  const earnedPoints = Math.floor(Number(earnedPointsValue));
  const sourceKey = String(sourceKeyValue ?? "").trim().toLowerCase();
  if (
    !referee ||
    !Number.isSafeInteger(earnedPoints) ||
    earnedPoints < 10 ||
    !/^[a-z0-9:_-]{1,160}$/.test(sourceKey)
  ) {
    return 0;
  }

  const { data, error } = await admin.rpc("award_referral_game_points", {
    p_referee: referee,
    p_earned_points: earnedPoints,
    p_source_key: sourceKey,
  });
  if (error) {
    // Keep game settlement available while the migration reaches an environment.
    if (
      error.code === "PGRST202" ||
      /award_referral_game_points|schema cache|function/i.test(error.message ?? "")
    ) {
      return awardReferralGamePointsFallback(admin, referee, earnedPoints);
    }
    throw new Error(error.message);
  }

  const awarded = Number(data ?? 0);
  return Number.isSafeInteger(awarded) && awarded > 0 ? awarded : 0;
}

async function awardReferralGamePointsFallback(
  admin: SupabaseClient,
  referee: string,
  earnedPoints: number,
): Promise<number> {
  const bonus = Math.floor(earnedPoints * 0.1);
  if (bonus <= 0) return 0;

  const { data: referral, error: referralError } = await admin
    .from("referrals")
    .select("referrer")
    .eq("referee", referee)
    .maybeSingle();
  if (referralError) throw new Error(referralError.message);

  const referrer = normalizeReferralWallet(referral?.referrer);
  if (!referrer || referrer === referee) return 0;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data: stats, error: statsError } = await admin
      .from("player_stats")
      .select("points")
      .eq("wallet", referrer)
      .maybeSingle();
    if (statsError) throw new Error(statsError.message);

    if (!stats) {
      const { error: insertError } = await admin.from("player_stats").insert({
        wallet: referrer,
        points: bonus,
      });
      if (!insertError) return bonus;
      if (insertError.code === "23505") continue;
      throw new Error(insertError.message);
    }

    const currentPoints = Number(stats.points ?? 0);
    const { data: updated, error: updateError } = await admin
      .from("player_stats")
      .update({
        points: currentPoints + bonus,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", referrer)
      .eq("points", currentPoints)
      .select("wallet");
    if (updateError) throw new Error(updateError.message);
    if (updated?.length) return bonus;
  }

  throw new Error("Could not atomically award referral points");
}
