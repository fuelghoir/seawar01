import { supabase } from "./supabase";
import { consumeItem, getItemQuantity } from "./season";

export type QuestMetric =
  | "total_wins"
  | "total_games"
  | "total_hits"
  | "total_checkins"
  | "checkin_streak"
  | "wager_wins"
  | "wager_games";

export interface QuestDefinition {
  id: number;
  name: string;
  desc: string;
  metric: QuestMetric;
  goal: number;
  reward: number;
}

export const QUEST_POOL: QuestDefinition[] = [
  // ─── Total Wins ───
  { id: 0,  name: "First Blood",      desc: "Win 1 game",             metric: "total_wins",     goal: 1,   reward: 200   },
  { id: 1,  name: "Lucky Shot",        desc: "Win 2 games",            metric: "total_wins",     goal: 2,   reward: 300   },
  { id: 2,  name: "Victor",            desc: "Win 3 games",            metric: "total_wins",     goal: 3,   reward: 500   },
  { id: 3,  name: "Hot Streak",        desc: "Win 4 games",            metric: "total_wins",     goal: 4,   reward: 700   },
  { id: 4,  name: "Conqueror",         desc: "Win 5 games",            metric: "total_wins",     goal: 5,   reward: 1000  },
  { id: 5,  name: "Destroyer",         desc: "Win 7 games",            metric: "total_wins",     goal: 7,   reward: 1400  },
  { id: 6,  name: "Warlord",           desc: "Win 10 games",           metric: "total_wins",     goal: 10,  reward: 2000  },
  { id: 7,  name: "Carrier Fleet",     desc: "Win 15 games",           metric: "total_wins",     goal: 15,  reward: 3000  },
  { id: 8,  name: "Grand Admiral",     desc: "Win 20 games",           metric: "total_wins",     goal: 20,  reward: 4000  },
  { id: 9,  name: "Ultimate Admiral",  desc: "Win 30 games",           metric: "total_wins",     goal: 30,  reward: 6000  },
  { id: 10, name: "Legend",            desc: "Win 50 games",           metric: "total_wins",     goal: 50,  reward: 10000 },

  // ─── Total Games ───
  { id: 11, name: "Sailor",            desc: "Play 3 games",           metric: "total_games",    goal: 3,   reward: 150   },
  { id: 12, name: "Navigator",         desc: "Play 5 games",           metric: "total_games",    goal: 5,   reward: 250   },
  { id: 13, name: "Relentless",        desc: "Play 7 games",           metric: "total_games",    goal: 7,   reward: 350   },
  { id: 14, name: "Captain",           desc: "Play 10 games",          metric: "total_games",    goal: 10,  reward: 500   },
  { id: 15, name: "Unstoppable",       desc: "Play 15 games",          metric: "total_games",    goal: 15,  reward: 750   },
  { id: 16, name: "Battle-Hardened",   desc: "Play 25 games",          metric: "total_games",    goal: 25,  reward: 1200  },
  { id: 17, name: "Commander",         desc: "Play 30 games",          metric: "total_games",    goal: 30,  reward: 1500  },
  { id: 18, name: "Fleet Admiral",     desc: "Play 50 games",          metric: "total_games",    goal: 50,  reward: 2500  },

  // ─── Total Hits ───
  { id: 19, name: "Sharpshooter",      desc: "Land 20 hits",           metric: "total_hits",     goal: 20,  reward: 200   },
  { id: 20, name: "Precision Strike",  desc: "Land 30 hits",           metric: "total_hits",     goal: 30,  reward: 300   },
  { id: 21, name: "Marksman",          desc: "Land 50 hits",           metric: "total_hits",     goal: 50,  reward: 500   },
  { id: 22, name: "Naval Gunner",      desc: "Land 75 hits",           metric: "total_hits",     goal: 75,  reward: 750   },
  { id: 23, name: "Cannoneer",         desc: "Land 100 hits",          metric: "total_hits",     goal: 100, reward: 1000  },
  { id: 24, name: "Sea Hunter",        desc: "Land 150 hits",          metric: "total_hits",     goal: 150, reward: 1500  },
  { id: 25, name: "Iron Fist",         desc: "Land 200 hits",          metric: "total_hits",     goal: 200, reward: 2000  },
  { id: 26, name: "Bombardier",        desc: "Land 250 hits",          metric: "total_hits",     goal: 250, reward: 2500  },
  { id: 27, name: "Artillery God",     desc: "Land 500 hits",          metric: "total_hits",     goal: 500, reward: 5000  },

  // ─── Weekly Check-in Streak ───
  { id: 28, name: "Morning Crew",      desc: "Reach 2-day streak",     metric: "checkin_streak", goal: 2,   reward: 150   },
  { id: 29, name: "Loyal Sailor",      desc: "Reach 3-day streak",     metric: "checkin_streak", goal: 3,   reward: 300   },
  { id: 30, name: "Consistent",        desc: "Reach 5-day streak",     metric: "checkin_streak", goal: 5,   reward: 400   },
  { id: 31, name: "Dedicated",         desc: "Reach 7-day streak",     metric: "checkin_streak", goal: 7,   reward: 700   },
  { id: 32, name: "Steady",            desc: "Reach 10-day streak",    metric: "checkin_streak", goal: 10,  reward: 1000  },
  { id: 33, name: "Veteran",           desc: "Reach 14-day streak",    metric: "checkin_streak", goal: 14,  reward: 1500  },
  { id: 34, name: "Sea Veteran",       desc: "Reach 20-day streak",    metric: "checkin_streak", goal: 20,  reward: 2200  },
  { id: 35, name: "Iron Will",         desc: "Reach 30-day streak",    metric: "checkin_streak", goal: 30,  reward: 3500  },
  { id: 36, name: "Living Legend",     desc: "Reach 60-day streak",    metric: "checkin_streak", goal: 60,  reward: 8000  },

  // ─── Total Check-ins ───
  { id: 37, name: "Daily Habit",       desc: "Check in 5 times",       metric: "total_checkins", goal: 5,   reward: 300   },
  { id: 38, name: "Fire at Will",       desc: "Land 40 hits",           metric: "total_hits",     goal: 40,  reward: 800   },
  { id: 39, name: "Grinder",           desc: "Play 20 games",          metric: "total_games",    goal: 20,  reward: 1600  },
  { id: 40, name: "Battlemaster",      desc: "Win 8 games",            metric: "total_wins",     goal: 8,   reward: 2500  },
  { id: 41, name: "All-In",            desc: "Play 3 wager games",     metric: "wager_games",    goal: 3,   reward: 5000  },

  // ─── Wager Wins ───
  { id: 42, name: "Risk Taker",        desc: "Win 1 wager game",       metric: "wager_wins",     goal: 1,   reward: 600   },
  { id: 43, name: "Weekend Warrior",   desc: "Win 2 wager games",      metric: "wager_wins",     goal: 2,   reward: 1000  },
  { id: 44, name: "Gambler",           desc: "Win 3 wager games",      metric: "wager_wins",     goal: 3,   reward: 1800  },
  { id: 45, name: "High Roller",       desc: "Win 5 wager games",      metric: "wager_wins",     goal: 5,   reward: 3500  },
  { id: 46, name: "Casino Captain",    desc: "Win 10 wager games",     metric: "wager_wins",     goal: 10,  reward: 8000  },

  // ─── Wager Games ───
  { id: 47, name: "Bettor",            desc: "Play 2 wager games",     metric: "wager_games",    goal: 2,   reward: 400   },
  { id: 48, name: "Stakeholder",       desc: "Play 5 wager games",     metric: "wager_games",    goal: 5,   reward: 1000  },
  { id: 49, name: "Whale",             desc: "Play 15 wager games",    metric: "wager_games",    goal: 15,  reward: 3000  },
];

// ─── Deterministic per-user weekly assignment ───

function isAssignableQuest(q: QuestDefinition): boolean {
  // Weekly daily/check-in quests must fit inside a 7-day week.
  if (q.metric === "total_checkins" || q.metric === "checkin_streak") {
    return q.goal <= 7;
  }
  return true;
}

const QUEST_BUCKETS: QuestMetric[][] = [
  ["total_hits"],
  ["checkin_streak", "total_checkins"],
  ["total_wins"],
  ["total_games"],
  ["wager_wins", "wager_games"],
];

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

export function getWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, "0")}`;
}

export function getAssignedQuestIds(wallet: string, weekKey: string): number[] {
  const seed = walletWeekSeed(wallet, weekKey);
  const assignable = QUEST_POOL.filter(isAssignableQuest);
  const selected = QUEST_BUCKETS.flatMap((metrics, index) => {
    const ids = assignable
      .filter(q => metrics.includes(q.metric))
      .map(q => q.id);
    const bucketSeed = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    return seededShuffle(ids, bucketSeed).slice(0, 1);
  });

  if (selected.length < 5) {
    const selectedSet = new Set(selected);
    const fallbackIds = assignable
      .map(q => q.id)
      .filter(id => !selectedSet.has(id));
    selected.push(...seededShuffle(fallbackIds, seed ^ 0x85ebca6b).slice(0, 5 - selected.length));
  }

  return seededShuffle(selected, seed ^ 0xc2b2ae35).slice(0, 5);
}

async function getAssignedQuestIdsForUser(wallet: string, weekKey: string): Promise<number[]> {
  const addr = wallet.toLowerCase();
  const baseIds = getAssignedQuestIds(addr, weekKey);
  const { data, error } = await supabase
    .from("user_quest_rerolls")
    .select("old_quest_id, new_quest_id")
    .eq("wallet", addr)
    .eq("week_key", weekKey);

  if (error) return baseIds;

  const rerollMap = new Map<number, number>();
  for (const row of data || []) {
    rerollMap.set(row.old_quest_id as number, row.new_quest_id as number);
  }

  const seen = new Set<number>();
  return baseIds.map((id) => {
    const next = rerollMap.get(id) ?? id;
    if (seen.has(next)) return id;
    seen.add(next);
    return next;
  });
}

// Encode quest claim as a unique sentinel address so the SoloResult event
// on-chain is identifiable as a quest claim (opponent = 0x...{questId+1000})
export function questSentinelAddress(questId: number): `0x${string}` {
  return `0x${(questId + 1000).toString(16).padStart(40, "0")}` as `0x${string}`;
}

// ─── Metric fetching ───

const DAY_MS = 86_400_000;

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
  lastCheckin: string | null | undefined
): number {
  if (totalCheckins <= 0) return 0;
  return Math.min(totalCheckins, getWeeklyCheckinStreak(globalStreak, lastCheckin));
}

interface UserMetrics {
  total_wins: number;
  total_games: number;
  total_hits: number;
  total_checkins: number;
  checkin_streak: number;
  wager_wins: number;
  wager_games: number;
}

async function getUserMetrics(wallet: string): Promise<UserMetrics> {
  const addr = wallet.toLowerCase();

  const [statsResult, wagerResult] = await Promise.all([
    supabase
      .from("player_stats")
      .select("wins, games_played, total_hits, total_checkins, checkin_streak, last_checkin")
      .eq("wallet", addr)
      .single(),
    supabase
      .from("games")
      .select("winner")
      .eq("game_mode", "wager")
      .eq("state", 3)
      .or(`player1.eq.${addr},player2.eq.${addr}`),
  ]);

  const stats = statsResult.data;
  const wagerRows = wagerResult.data || [];

  return {
    total_wins: stats?.wins ?? 0,
    total_games: stats?.games_played ?? 0,
    total_hits: stats?.total_hits ?? 0,
    total_checkins: getWeeklyCheckinCount(
      stats?.total_checkins ?? 0,
      stats?.checkin_streak ?? 0,
      stats?.last_checkin
    ),
    checkin_streak: getWeeklyCheckinStreak(stats?.checkin_streak ?? 0, stats?.last_checkin),
    wager_wins: wagerRows.filter(g => g.winner === addr).length,
    wager_games: wagerRows.length,
  };
}

// ─── Quest state ───

export interface UserQuestState {
  definition: QuestDefinition;
  baseline: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

function getQuestProgress(def: QuestDefinition, metrics: UserMetrics, baseline: number) {
  const currentValue = metrics[def.metric] ?? 0;
  return def.metric === "checkin_streak" || def.metric === "total_checkins"
    ? currentValue
    : Math.max(0, currentValue - baseline);
}

export async function getUserQuestsWithProgress(wallet: string): Promise<UserQuestState[]> {
  const addr = wallet.toLowerCase();
  const weekKey = getWeekKey();
  const assignedIds = await getAssignedQuestIdsForUser(addr, weekKey);
  const assignedDefs = assignedIds.map(id => QUEST_POOL.find(q => q.id === id)!);

  const [metrics, dbResult] = await Promise.all([
    getUserMetrics(addr),
    supabase
      .from("user_quests")
      .select("quest_id, baseline, claimed")
      .eq("wallet", addr)
      .eq("week_key", weekKey),
  ]);

  if (dbResult.error) {
    throw new Error("Could not load quest state");
  }

  const rowMap = new Map((dbResult.data || []).map(r => [r.quest_id as number, r]));

  // Insert rows for any quests not yet tracked this week
  const missing = assignedDefs.filter(d => !rowMap.has(d.id));
  if (missing.length > 0) {
    const inserts = missing.map(d => ({
      wallet: addr,
      quest_id: d.id,
      week_key: weekKey,
      // Weekly check-in quests should count the current week even if the
      // quest panel is opened after today's check-in.
      baseline: d.metric === "checkin_streak" || d.metric === "total_checkins"
        ? 0
        : (metrics[d.metric] ?? 0),
      }));
    const { data: inserted, error } = await supabase
      .from("user_quests")
      .insert(inserts)
      .select("quest_id, baseline, claimed");
    if (error) {
      throw new Error("Could not start weekly quests");
    }
    for (const row of inserted || []) {
      rowMap.set(row.quest_id as number, row);
    }
  }

  return assignedDefs.map(def => {
    const row = rowMap.get(def.id);
    const baseline = row?.baseline ?? 0;
    const claimed = row?.claimed ?? false;
    const progress = getQuestProgress(def, metrics, baseline);

    return {
      definition: def,
      baseline,
      progress,
      completed: progress >= def.goal,
      claimed,
    };
  });
}

async function getClaimableQuestState(wallet: string, questId: number) {
  const addr = wallet.toLowerCase();
  const weekKey = getWeekKey();

  if (!(await getAssignedQuestIdsForUser(addr, weekKey)).includes(questId)) {
    throw new Error("Quest not assigned this week");
  }

  const { data: row, error } = await supabase
    .from("user_quests")
    .select("baseline, claimed")
    .eq("wallet", addr)
    .eq("quest_id", questId)
    .eq("week_key", weekKey)
    .maybeSingle();

  if (error) throw new Error("Could not load quest state");
  if (!row) throw new Error("Quest not started");
  if (row.claimed) throw new Error("Already claimed");

  const metrics = await getUserMetrics(addr);
  const def = QUEST_POOL.find(q => q.id === questId)!;
  const progress = getQuestProgress(def, metrics, row.baseline);

  if (progress < def.goal) throw new Error(`Not completed yet (${progress}/${def.goal})`);

  return { addr, weekKey, def };
}

export async function validateUserQuestClaim(
  wallet: string,
  questId: number
): Promise<{ reward: number }> {
  const { def } = await getClaimableQuestState(wallet, questId);
  return { reward: def.reward };
}

export async function claimUserQuest(wallet: string, questId: number): Promise<{ reward: number }> {
  const { addr, weekKey, def } = await getClaimableQuestState(wallet, questId);

  // Award points and mark claimed atomically
  const { data: ps } = await supabase
    .from("player_stats")
    .select("points")
    .eq("wallet", addr)
    .single();

  await Promise.all([
    supabase
      .from("user_quests")
      .update({ claimed: true, claimed_at: new Date().toISOString() })
      .eq("wallet", addr)
      .eq("quest_id", questId)
      .eq("week_key", weekKey),
    ps
      ? supabase
          .from("player_stats")
          .update({ points: ps.points + def.reward, updated_at: new Date().toISOString() })
          .eq("wallet", addr)
      : supabase
          .from("player_stats")
          .insert({ wallet: addr, points: def.reward }),
  ]);

  return { reward: def.reward };
}

export async function rerollUserQuest(
  wallet: string,
  questId: number
): Promise<{ definition: QuestDefinition }> {
  const addr = wallet.toLowerCase();
  const weekKey = getWeekKey();
  const baseIds = getAssignedQuestIds(addr, weekKey);
  const currentIds = await getAssignedQuestIdsForUser(addr, weekKey);

  if (!currentIds.includes(questId)) {
    throw new Error("Quest not assigned this week");
  }

  const { data: questRow } = await supabase
    .from("user_quests")
    .select("claimed")
    .eq("wallet", addr)
    .eq("quest_id", questId)
    .eq("week_key", weekKey)
    .maybeSingle();

  if (questRow?.claimed) throw new Error("Claimed quests cannot be rerolled");

  const qty = await getItemQuantity(addr, "quest_reroll");
  if (qty <= 0) throw new Error("No reroll tokens");

  const { data: existingRerolls } = await supabase
    .from("user_quest_rerolls")
    .select("old_quest_id, new_quest_id")
    .eq("wallet", addr)
    .eq("week_key", weekKey);

  const rerollMap = new Map<number, number>();
  for (const row of existingRerolls || []) {
    rerollMap.set(row.old_quest_id as number, row.new_quest_id as number);
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

  const { error } = await supabase
    .from("user_quest_rerolls")
    .upsert(
      {
        wallet: addr,
        week_key: weekKey,
        old_quest_id: baseQuestId,
        new_quest_id: newQuestId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet,week_key,old_quest_id" }
    );

  if (error) throw new Error(error.message);

  await consumeItem(addr, "quest_reroll", 1);
  return { definition };
}
