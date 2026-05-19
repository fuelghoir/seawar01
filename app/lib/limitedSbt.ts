import { supabase } from "./supabase";

export const LIMITED_SBT_MAX_SUPPLY = 20;
export const LIMITED_SBT_REQUIRED_WINS = 100;
export const LIMITED_SBT_WEEKLY_POINTS = 10_000;

const LIMITED_SBT_SCHEMA_MISSING =
  "Limited SBT database tables are missing. Run scripts/supabase-limited-sbt.sql in Supabase, then reload the app.";

export interface LimitedSbtState {
  wallet: string;
  wins: number;
  tokenId: number | null;
  claimedAt: string | null;
  claimedSupply: number;
  remainingSupply: number;
  canClaim: boolean;
  weekKey: string;
  weeklyClaimed: boolean;
  canClaimWeekly: boolean;
}

function normalizeWallet(wallet: string) {
  return wallet.toLowerCase();
}

function isMissingSbtTableError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    /schema cache|limited_sbt_claims|limited_sbt_weekly_rewards|get_limited_sbt|claim_limited_sbt/i.test(error.message ?? "")
  );
}

function sbtTableError(error: { code?: string; message?: string }): Error {
  return new Error(isMissingSbtTableError(error) ? LIMITED_SBT_SCHEMA_MISSING : error.message);
}

export function getLimitedSbtWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, "0")}`;
}

export async function getLimitedSbtState(wallet: string): Promise<LimitedSbtState> {
  const addr = normalizeWallet(wallet);
  const { data, error } = await supabase
    .rpc("get_limited_sbt_state", { p_wallet: addr })
    .maybeSingle();

  if (error) throw sbtTableError(error);

  const row = data as {
    wins?: number;
    token_id?: number | null;
    claimed_at?: string | null;
    claimed_supply?: number;
    remaining_supply?: number;
    week_key?: string;
    weekly_claimed?: boolean;
  } | null;

  const wins = Number(row?.wins ?? 0);
  const tokenId = row?.token_id ? Number(row.token_id) : null;
  const claimedSupply = Number(row?.claimed_supply ?? 0);
  const weeklyClaimed = !!row?.weekly_claimed;
  const owns = tokenId !== null;

  return {
    wallet: addr,
    wins,
    tokenId,
    claimedAt: row?.claimed_at ?? null,
    claimedSupply,
    remainingSupply: Math.max(0, Number(row?.remaining_supply ?? LIMITED_SBT_MAX_SUPPLY - claimedSupply)),
    canClaim: !owns && wins >= LIMITED_SBT_REQUIRED_WINS && claimedSupply < LIMITED_SBT_MAX_SUPPLY,
    weekKey: row?.week_key ?? getLimitedSbtWeekKey(),
    weeklyClaimed,
    canClaimWeekly: owns && !weeklyClaimed,
  };
}

export async function claimLimitedSbt(wallet: string): Promise<{ tokenId: number }> {
  const { data, error } = await supabase.rpc("claim_limited_sbt", {
    p_wallet: normalizeWallet(wallet),
  });

  if (error) throw sbtTableError(error);
  return { tokenId: Number(data) };
}

export async function claimLimitedSbtWeeklyPoints(
  wallet: string
): Promise<{ points: number; weekKey: string }> {
  const res = await fetch("/api/captain-sbt/weekly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: normalizeWallet(wallet) }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || "Weekly reward failed");
  }
  return {
    points: Number(data?.points ?? 0),
    weekKey: data?.weekKey ?? getLimitedSbtWeekKey(),
  };
}
