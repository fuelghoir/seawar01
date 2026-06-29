import type { SupabaseClient } from "@supabase/supabase-js";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

export function normalizeReferralWallet(value: unknown): string | null {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

export async function recordReferralServer(
  admin: SupabaseClient,
  referrer: string,
  referee: string,
): Promise<boolean> {
  if (referrer === referee) return false;

  const { error } = await admin.from("referrals").upsert(
    { referrer, referee },
    { onConflict: "referee", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return true;
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
  referee: string,
  earnedPointsValue: number,
): Promise<number> {
  const earnedPoints = Math.floor(Number(earnedPointsValue));
  const bonus = Math.floor(Math.max(0, earnedPoints) * 0.1);
  if (bonus <= 0) return 0;

  const { data, error } = await admin
    .from("referrals")
    .select("referrer")
    .eq("referee", referee)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const referrer = normalizeReferralWallet(data?.referrer);
  if (!referrer || referrer === referee) return 0;

  await grantReferralPoints(admin, referrer, bonus);
  return bonus;
}

async function grantReferralPoints(
  admin: SupabaseClient,
  wallet: string,
  points: number,
) {
  const { data, error } = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    const { error: updateError } = await admin
      .from("player_stats")
      .update({
        points: Number(data.points ?? 0) + points,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", wallet);
    if (updateError) throw new Error(updateError.message);
    return;
  }

  const { error: insertError } = await admin.from("player_stats").insert({
    wallet,
    points,
  });
  if (insertError) throw new Error(insertError.message);
}
