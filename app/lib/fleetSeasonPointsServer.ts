import type { SupabaseClient } from "@supabase/supabase-js";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const MAX_UPDATE_ATTEMPTS = 5;

export type FleetSeasonPointsCheckpoint = {
  wallet: string;
  seasonKey: string;
  pointsBefore: number;
};

export async function getFleetSeasonPointsCheckpoint(
  admin: SupabaseClient,
  walletValue: unknown,
): Promise<FleetSeasonPointsCheckpoint | null> {
  const wallet = String(walletValue ?? "").trim().toLowerCase();
  if (!WALLET_RE.test(wallet)) return null;

  const now = new Date().toISOString();
  const { data: season, error: seasonError } = await admin
    .from("fleet_seasons")
    .select("season_key")
    .eq("status", "active")
    .lte("starts_at", now)
    .gt("ends_at", now)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seasonError || !season?.season_key) return null;

  const seasonKey = String(season.season_key);
  const { data: member, error: memberError } = await admin
    .from("fleet_season_members")
    .select("wallet")
    .eq("season_key", seasonKey)
    .eq("wallet", wallet)
    .lte("joined_at", now)
    .maybeSingle();
  if (memberError || !member) return null;

  const { data: progress, error: progressError } = await admin
    .from("season_progress")
    .select("points")
    .eq("wallet", wallet)
    .eq("season_key", seasonKey)
    .maybeSingle();
  if (progressError) return null;

  return {
    wallet,
    seasonKey,
    pointsBefore: nonNegativeInteger(progress?.points),
  };
}

export async function recordFleetSeasonPointGain(
  admin: SupabaseClient,
  checkpoint: FleetSeasonPointsCheckpoint | null,
  awardedPointsValue: unknown,
): Promise<void> {
  if (!checkpoint) return;
  const awardedPoints = nonNegativeInteger(awardedPointsValue);
  if (awardedPoints <= 0) return;

  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
    const { data: progress, error: readError } = await admin
      .from("season_progress")
      .select("xp,claimed_levels,points")
      .eq("wallet", checkpoint.wallet)
      .eq("season_key", checkpoint.seasonKey)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const currentPoints = nonNegativeInteger(progress?.points);
    const pointsAlreadyRecorded = Math.max(0, currentPoints - checkpoint.pointsBefore);
    const remainingPoints = Math.max(0, awardedPoints - pointsAlreadyRecorded);
    if (remainingPoints === 0) return;

    if (!progress) {
      const { error: insertError } = await admin.from("season_progress").insert({
        wallet: checkpoint.wallet,
        season_key: checkpoint.seasonKey,
        xp: 0,
        claimed_levels: [],
        points: remainingPoints,
        updated_at: new Date().toISOString(),
      });
      if (!insertError) return;
      if (insertError.code === "23505") continue;
      throw new Error(insertError.message);
    }

    const { data: updated, error: updateError } = await admin
      .from("season_progress")
      .update({
        points: currentPoints + remainingPoints,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", checkpoint.wallet)
      .eq("season_key", checkpoint.seasonKey)
      .eq("points", currentPoints)
      .select("points")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (updated) return;
  }

  throw new Error("Could not record Fleet Season points after concurrent updates");
}

function nonNegativeInteger(value: unknown) {
  return Math.max(0, Math.floor(Number(value ?? 0)));
}
