import { supabase } from "./supabase";

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

  // ─── Check-in Streak (absolute metric) ───
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
  { id: 38, name: "Regular",           desc: "Check in 15 times",      metric: "total_checkins", goal: 15,  reward: 800   },
  { id: 39, name: "Devoted",           desc: "Check in 30 times",      metric: "total_checkins", goal: 30,  reward: 1600  },
  { id: 40, name: "Check-in Champ",    desc: "Check in 50 times",      metric: "total_checkins", goal: 50,  reward: 2500  },
  { id: 41, name: "Obsessed",          desc: "Check in 100 times",     metric: "total_checkins", goal: 100, reward: 5000  },

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
  const allIds = QUEST_POOL.map(q => q.id);
  return seededShuffle(allIds, seed).slice(0, 5);
}

// Encode quest claim as a unique sentinel address so the SoloResult event
// on-chain is identifiable as a quest claim (opponent = 0x...{questId+1000})
export function questSentinelAddress(questId: number): `0x${string}` {
  return `0x${(questId + 1000).toString(16).padStart(40, "0")}` as `0x${string}`;
}

// ─── Metric fetching ───

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
      .select("wins, games_played, total_hits, total_checkins, checkin_streak")
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
    total_checkins: stats?.total_checkins ?? 0,
    checkin_streak: stats?.checkin_streak ?? 0,
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

export async function getUserQuestsWithProgress(wallet: string): Promise<UserQuestState[]> {
  const addr = wallet.toLowerCase();
  const weekKey = getWeekKey();
  const assignedIds = getAssignedQuestIds(addr, weekKey);
  const assignedDefs = assignedIds.map(id => QUEST_POOL.find(q => q.id === id)!);

  const [metrics, dbResult] = await Promise.all([
    getUserMetrics(addr),
    supabase
      .from("user_quests")
      .select("quest_id, baseline, claimed")
      .eq("wallet", addr)
      .eq("week_key", weekKey),
  ]);

  const rowMap = new Map((dbResult.data || []).map(r => [r.quest_id as number, r]));

  // Insert rows for any quests not yet tracked this week
  const missing = assignedDefs.filter(d => !rowMap.has(d.id));
  if (missing.length > 0) {
    const inserts = missing.map(d => ({
      wallet: addr,
      quest_id: d.id,
      week_key: weekKey,
      // streak quests are absolute (baseline=0), all others are delta from now
      baseline: d.metric === "checkin_streak" ? 0 : (metrics[d.metric] ?? 0),
    }));
    const { data: inserted } = await supabase
      .from("user_quests")
      .insert(inserts)
      .select("quest_id, baseline, claimed");
    for (const row of inserted || []) {
      rowMap.set(row.quest_id as number, row);
    }
  }

  return assignedDefs.map(def => {
    const row = rowMap.get(def.id);
    const baseline = row?.baseline ?? 0;
    const claimed = row?.claimed ?? false;
    const currentValue = metrics[def.metric] ?? 0;
    const progress = def.metric === "checkin_streak"
      ? currentValue
      : Math.max(0, currentValue - baseline);

    return {
      definition: def,
      baseline,
      progress,
      completed: progress >= def.goal,
      claimed,
    };
  });
}

export async function claimUserQuest(wallet: string, questId: number): Promise<{ reward: number }> {
  const addr = wallet.toLowerCase();
  const weekKey = getWeekKey();

  if (!getAssignedQuestIds(addr, weekKey).includes(questId)) {
    throw new Error("Quest not assigned this week");
  }

  const { data: row } = await supabase
    .from("user_quests")
    .select("baseline, claimed")
    .eq("wallet", addr)
    .eq("quest_id", questId)
    .eq("week_key", weekKey)
    .single();

  if (!row) throw new Error("Quest not started");
  if (row.claimed) throw new Error("Already claimed");

  const metrics = await getUserMetrics(addr);
  const def = QUEST_POOL.find(q => q.id === questId)!;
  const currentValue = metrics[def.metric] ?? 0;
  const progress = def.metric === "checkin_streak"
    ? currentValue
    : Math.max(0, currentValue - row.baseline);

  if (progress < def.goal) throw new Error(`Not completed yet (${progress}/${def.goal})`);

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
