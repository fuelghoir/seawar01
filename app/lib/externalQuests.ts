import { supabase } from "./supabase";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const DAY_MS = 86_400_000;

export const TURBO_GUM_QUEST = {
  key: "turbo-gum-2026-05",
  url: "https://turbo-gum.xyz?ref=TDU0CGYP",
  baseAppUrl: "https://base.app/app/turbo-gum.xyz?ref=TDU0CGYP",
  reward: 1000,
  startsAt: "2026-05-24T00:00:00.000Z",
  endsAt: "2026-06-03T00:00:00.000Z",
} as const;

export interface TurboGumQuestStatus {
  active: boolean;
  claimed: boolean;
  claimedAt: string | null;
  reward: number;
  startsAt: string;
  endsAt: string;
  daysLeft: number;
  loadError?: string;
}

export interface TurboGumQuestClaimResult {
  reward: number;
  alreadyClaimed: boolean;
}

export function isTurboGumQuestActive(date = new Date()): boolean {
  const now = date.getTime();
  return (
    now >= new Date(TURBO_GUM_QUEST.startsAt).getTime() &&
    now < new Date(TURBO_GUM_QUEST.endsAt).getTime()
  );
}

export async function getTurboGumQuestStatus(
  wallet: string,
): Promise<TurboGumQuestStatus> {
  const addr = normalizeWallet(wallet);
  if (!addr) throw new Error("Invalid wallet");

  const active = isTurboGumQuestActive();
  const daysLeft = getDaysLeft();
  const baseStatus = {
    active,
    claimed: false,
    claimedAt: null,
    reward: TURBO_GUM_QUEST.reward,
    startsAt: TURBO_GUM_QUEST.startsAt,
    endsAt: TURBO_GUM_QUEST.endsAt,
    daysLeft,
  };

  const { data, error } = await supabase
    .from("external_quest_claims")
    .select("claimed_at")
    .eq("wallet", addr)
    .eq("quest_key", TURBO_GUM_QUEST.key)
    .maybeSingle();

  if (error) {
    return { ...baseStatus, loadError: error.message };
  }

  return {
    ...baseStatus,
    claimed: Boolean(data?.claimed_at),
    claimedAt: (data?.claimed_at as string | undefined) ?? null,
  };
}

export async function claimTurboGumQuest(
  wallet: string,
): Promise<TurboGumQuestClaimResult> {
  const addr = normalizeWallet(wallet);
  if (!addr) throw new Error("Invalid wallet");
  if (!isTurboGumQuestActive()) throw new Error("Quest expired");

  const { data, error } = await supabase.rpc("claim_turbo_gum_quest", {
    p_wallet: addr,
  });

  if (error) throw new Error(error.message);

  const awarded = Boolean(data);
  return {
    reward: awarded ? TURBO_GUM_QUEST.reward : 0,
    alreadyClaimed: !awarded,
  };
}

function normalizeWallet(wallet: string | null | undefined): string | null {
  const addr = wallet?.trim().toLowerCase();
  if (!addr || !WALLET_RE.test(addr)) return null;
  return addr;
}

function getDaysLeft(): number {
  const ms = new Date(TURBO_GUM_QUEST.endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}
