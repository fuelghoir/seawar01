import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUEST_POOL,
  getAssignedQuestIds,
  getWeekKey,
  type QuestDefinition,
  type QuestMetric,
} from "./quests";
import {
  consumeItemServer,
  getItemQuantityServer,
  grantItemServer,
  grantRawPointsServer,
} from "./seasonServer";

type QuestGameMetricRow = {
  id: number;
  player1: string;
  player2: string | null;
  winner: string | null;
  state: number;
  game_mode: string | null;
  player1_hits: number | null;
  player2_hits: number | null;
  created_at: string;
};

type UserMetrics = Record<QuestMetric, number> & {
  weekly_total_wins: number;
  weekly_total_games: number;
  weekly_total_hits: number;
  weekly_wager_wins: number;
  weekly_wager_games: number;
};

const DAY_MS = 86_400_000;

export async function claimUserQuestServer(
  admin: SupabaseClient,
  wallet: string,
  questIdValue: unknown,
): Promise<{ reward: number }> {
  const questId = normalizeQuestId(questIdValue);
  const { addr, weekKey, def } = await getClaimableQuestStateServer(admin, wallet, questId);

  const markClaimed = await admin
    .from("user_quests")
    .update({ claimed: true, claimed_at: new Date().toISOString() })
    .eq("wallet", addr)
    .eq("quest_id", questId)
    .eq("week_key", weekKey)
    .eq("claimed", false)
    .select("quest_id")
    .maybeSingle();

  if (markClaimed.error) throw new Error(markClaimed.error.message);
  if (!markClaimed.data) throw new Error("Already claimed");

  try {
    await grantRawPointsServer(admin, addr, def.reward);
  } catch (err) {
    await admin
      .from("user_quests")
      .update({ claimed: false, claimed_at: null })
      .eq("wallet", addr)
      .eq("quest_id", questId)
      .eq("week_key", weekKey);
    throw err;
  }

  return { reward: def.reward };
}

export async function rerollUserQuestServer(
  admin: SupabaseClient,
  wallet: string,
  questIdValue: unknown,
): Promise<{ definition: QuestDefinition }> {
  const questId = normalizeQuestId(questIdValue);
  const addr = wallet.toLowerCase();
  const weekKey = getWeekKey();
  const baseIds = getAssignedQuestIds(addr, weekKey);
  const currentIds = await getAssignedQuestIdsForUserServer(admin, addr, weekKey);

  if (!currentIds.includes(questId)) throw new Error("Quest not assigned this week");

  const { data: questRow, error: questError } = await admin
    .from("user_quests")
    .select("claimed")
    .eq("wallet", addr)
    .eq("quest_id", questId)
    .eq("week_key", weekKey)
    .maybeSingle();
  if (questError) throw new Error(questError.message);
  if (questRow?.claimed) throw new Error("Claimed quests cannot be rerolled");

  const qty = await getItemQuantityServer(admin, addr, "quest_reroll");
  if (qty <= 0) throw new Error("No reroll tokens");

  const existingRerolls = await getRerollRows(admin, addr, weekKey);
  const rerollMap = new Map<number, number>();
  for (const row of existingRerolls) {
    rerollMap.set(Number(row.old_quest_id), Number(row.new_quest_id));
  }

  const baseQuestId =
    baseIds.find((id) => (rerollMap.get(id) ?? id) === questId) ?? questId;
  const currentSet = new Set(currentIds);
  const currentDef = QUEST_POOL.find((q) => q.id === questId);
  const sameMetric = QUEST_POOL
    .filter(isAssignableQuest)
    .filter((q) => q.metric === currentDef?.metric)
    .filter((q) => !currentSet.has(q.id) && q.id !== questId);
  const fallback = QUEST_POOL
    .filter(isAssignableQuest)
    .filter((q) => !currentSet.has(q.id) && q.id !== questId);
  const candidates = sameMetric.length > 0 ? sameMetric : fallback;
  if (candidates.length === 0) throw new Error("No replacement quest available");

  const seed = walletWeekSeed(addr, `${weekKey}:${questId}:${Date.now()}`);
  const [newQuestId] = seededShuffle(candidates.map((q) => q.id), seed);
  const definition = QUEST_POOL.find((q) => q.id === newQuestId)!;

  await consumeItemServer(admin, addr, "quest_reroll", 1);

  const { error } = await admin.from("user_quest_rerolls").upsert(
    {
      wallet: addr,
      week_key: weekKey,
      old_quest_id: baseQuestId,
      new_quest_id: newQuestId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet,week_key,old_quest_id" },
  );

  if (error) {
    await grantItemServer(admin, addr, "quest_reroll", 1).catch(() => {});
    throw new Error(error.message);
  }

  return { definition };
}

async function getClaimableQuestStateServer(
  admin: SupabaseClient,
  wallet: string,
  questId: number,
) {
  const addr = wallet.toLowerCase();
  const weekKey = getWeekKey();

  if (!(await getAssignedQuestIdsForUserServer(admin, addr, weekKey)).includes(questId)) {
    throw new Error("Quest not assigned this week");
  }

  const { data: row, error } = await admin
    .from("user_quests")
    .select("baseline, claimed")
    .eq("wallet", addr)
    .eq("quest_id", questId)
    .eq("week_key", weekKey)
    .maybeSingle();

  if (error) throw new Error("Could not load quest state");
  if (!row) throw new Error("Quest not started");
  if (row.claimed) throw new Error("Already claimed");

  const metrics = await getUserMetricsServer(admin, addr);
  const def = QUEST_POOL.find((q) => q.id === questId);
  if (!def) throw new Error("Unknown quest");

  const progress = getQuestProgress(def, metrics, Number(row.baseline ?? 0));
  if (progress < def.goal) throw new Error(`Not completed yet (${progress}/${def.goal})`);

  return { addr, weekKey, def };
}

async function getAssignedQuestIdsForUserServer(
  admin: SupabaseClient,
  wallet: string,
  weekKey: string,
): Promise<number[]> {
  const baseIds = getAssignedQuestIds(wallet, weekKey);
  const rows = await getRerollRows(admin, wallet, weekKey);
  const rerollMap = new Map<number, number>();
  for (const row of rows) {
    rerollMap.set(Number(row.old_quest_id), Number(row.new_quest_id));
  }

  const seen = new Set<number>();
  return baseIds.map((id) => {
    const next = rerollMap.get(id) ?? id;
    if (seen.has(next)) return id;
    seen.add(next);
    return next;
  });
}

async function getRerollRows(admin: SupabaseClient, wallet: string, weekKey: string) {
  const { data, error } = await admin
    .from("user_quest_rerolls")
    .select("old_quest_id, new_quest_id")
    .eq("wallet", wallet)
    .eq("week_key", weekKey);
  if (error) throw new Error(error.message);
  return data || [];
}

async function getUserMetricsServer(admin: SupabaseClient, wallet: string): Promise<UserMetrics> {
  const addr = wallet.toLowerCase();
  const weekStartMs = getWeekStartUTC().getTime();

  const [statsResult, gamesResult] = await Promise.all([
    admin
      .from("player_stats")
      .select("wins, games_played, total_hits, total_checkins, checkin_streak, last_checkin")
      .eq("wallet", addr)
      .maybeSingle(),
    admin
      .from("games")
      .select("id, player1, player2, winner, state, game_mode, player1_hits, player2_hits, created_at")
      .or(`player1.eq.${addr},player2.eq.${addr}`),
  ]);
  if (statsResult.error) throw new Error(statsResult.error.message);
  if (gamesResult.error) throw new Error(gamesResult.error.message);

  const stats = statsResult.data;
  const gameRows = (gamesResult.data || []) as QuestGameMetricRow[];
  const playableRows = gameRows.filter((game) => game.state !== 4);
  const finishedRows = playableRows.filter((game) => game.state === 3);
  const weeklyRows = playableRows.filter(
    (game) => new Date(game.created_at).getTime() >= weekStartMs,
  );
  const weeklyFinishedRows = weeklyRows.filter((game) => game.state === 3);
  const wagerRows = finishedRows.filter((game) => game.game_mode === "wager");
  const weeklyWagerRows = weeklyFinishedRows.filter((game) => game.game_mode === "wager");
  const gameWins = finishedRows.filter((game) => game.winner === addr).length;
  const gameHits = playableRows.reduce((sum, game) => {
    if (game.player1 === addr) return sum + Number(game.player1_hits ?? 0);
    if (game.player2 === addr) return sum + Number(game.player2_hits ?? 0);
    return sum;
  }, 0);
  const weeklyGameWins = weeklyFinishedRows.filter((game) => game.winner === addr).length;
  const weeklyGameHits = weeklyRows.reduce((sum, game) => {
    if (game.player1 === addr) return sum + Number(game.player1_hits ?? 0);
    if (game.player2 === addr) return sum + Number(game.player2_hits ?? 0);
    return sum;
  }, 0);

  return {
    total_wins: Math.max(stats?.wins ?? 0, gameWins),
    total_games: Math.max(stats?.games_played ?? 0, finishedRows.length),
    total_hits: Math.max(stats?.total_hits ?? 0, gameHits),
    total_checkins: getWeeklyCheckinCount(
      stats?.total_checkins ?? 0,
      stats?.checkin_streak ?? 0,
      stats?.last_checkin,
    ),
    checkin_streak: getWeeklyCheckinStreak(stats?.checkin_streak ?? 0, stats?.last_checkin),
    wager_wins: wagerRows.filter((game) => game.winner === addr).length,
    wager_games: wagerRows.length,
    weekly_total_wins: weeklyGameWins,
    weekly_total_games: weeklyFinishedRows.length,
    weekly_total_hits: weeklyGameHits,
    weekly_wager_wins: weeklyWagerRows.filter((game) => game.winner === addr).length,
    weekly_wager_games: weeklyWagerRows.length,
  };
}

function getQuestProgress(def: QuestDefinition, metrics: UserMetrics, baseline: number) {
  const currentValue = metrics[def.metric] ?? 0;
  if (def.metric === "checkin_streak" || def.metric === "total_checkins") {
    return currentValue;
  }

  const baselineDelta = Math.max(0, currentValue - baseline);
  if (def.metric === "total_wins") return Math.max(baselineDelta, metrics.weekly_total_wins);
  if (def.metric === "total_games") return Math.max(baselineDelta, metrics.weekly_total_games);
  if (def.metric === "total_hits") return Math.max(baselineDelta, metrics.weekly_total_hits);
  if (def.metric === "wager_wins") return Math.max(baselineDelta, metrics.weekly_wager_wins);
  if (def.metric === "wager_games") return Math.max(baselineDelta, metrics.weekly_wager_games);
  return baselineDelta;
}

function isAssignableQuest(q: QuestDefinition): boolean {
  if (q.metric === "total_checkins" || q.metric === "checkin_streak") return q.goal <= 7;
  return true;
}

function walletWeekSeed(wallet: string, weekKey: string): number {
  const str = wallet.toLowerCase() + weekKey;
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function seededShuffle(arr: number[], seed: number): number[] {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function getWeekStartUTC(date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 1 - day);
  return d;
}

function parseUTCDateKey(dateKey: string | null | undefined): Date | null {
  if (!dateKey) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function getWeeklyCheckinStreak(globalStreak: number, lastCheckin: string | null | undefined): number {
  const lastCheckinDate = parseUTCDateKey(lastCheckin);
  if (!lastCheckinDate || globalStreak <= 0) return 0;

  const weekStart = getWeekStartUTC();
  if (lastCheckinDate.getTime() < weekStart.getTime()) return 0;

  const daysIntoWeek = Math.floor((lastCheckinDate.getTime() - weekStart.getTime()) / DAY_MS) + 1;
  return Math.max(0, Math.min(globalStreak, daysIntoWeek, 7));
}

function getWeeklyCheckinCount(
  totalCheckins: number,
  globalStreak: number,
  lastCheckin: string | null | undefined,
): number {
  if (totalCheckins <= 0) return 0;
  return Math.min(totalCheckins, getWeeklyCheckinStreak(globalStreak, lastCheckin));
}

function normalizeQuestId(value: unknown) {
  const questId = Number(value);
  if (!Number.isInteger(questId)) throw new Error("Invalid quest id");
  return questId;
}
