import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env.local") });
dotenv.config({ path: path.join(projectRoot, ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TABLES = [
  "games",
  "shots",
  "player_stats",
  "season_progress",
  "resolved_games",
  "shop_usdc_purchases",
  "shop_weekly_point_purchases",
  "fleet_nft_point_claims",
  "limited_sbt_claims",
  "easter_egg_claims",
  "external_quest_claims",
  "social_connections",
  "social_share_rewards",
  "creator_submissions",
  "creator_rewards",
  "challenge_games",
  "player_items",
  "player_boosters",
  "referrals",
];

const ZERO_WALLET = "0x0000000000000000000000000000000000000000";
const BOT_WALLET = "0x0000000000000000000000000000000000000001";
const SYSTEM_WALLETS = new Set([ZERO_WALLET, BOT_WALLET]);

async function fetchAll(tableName) {
  const rows = [];
  const pageSize = 1000;

  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      throw new Error(`Unable to read ${tableName}: ${error.message}`);
    }

    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function normalizeWallet(value) {
  if (typeof value !== "string") return null;
  const wallet = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet) || SYSTEM_WALLETS.has(wallet)) return null;
  return wallet;
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(value) {
  const parsed = value instanceof Date ? value : timestamp(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function monthKey(value) {
  const parsed = value instanceof Date ? value : timestamp(value);
  return parsed ? parsed.toISOString().slice(0, 7) : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(part, total, digits = 1) {
  return total > 0 ? Number(((part / total) * 100).toFixed(digits)) : 0;
}

function round(value, digits = 1) {
  return Number(number(value).toFixed(digits));
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function countBy(rows, getKey) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(getKey(row) ?? "unknown");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function uniqueWalletCount(rows, fields) {
  const wallets = new Set();
  for (const row of rows) {
    for (const field of fields) {
      const wallet = normalizeWallet(row[field]);
      if (wallet) wallets.add(wallet);
    }
  }
  return wallets.size;
}

function addActivity(activity, walletValue, dateValue, type) {
  const wallet = normalizeWallet(walletValue);
  const at = timestamp(dateValue);
  if (!wallet || !at) return;
  activity.push({ wallet, at, type });
}

function shortWallet(wallet) {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function isoOrNull(value) {
  return value instanceof Date ? value.toISOString() : null;
}

async function main() {
  const entries = await Promise.all(
    TABLES.map(async (tableName) => [tableName, await fetchAll(tableName)])
  );
  const data = Object.fromEntries(entries);

  const allWallets = new Set();
  const addWallet = (value) => {
    const wallet = normalizeWallet(value);
    if (wallet) allWallets.add(wallet);
  };

  for (const row of data.games) {
    addWallet(row.player1);
    addWallet(row.player2);
    addWallet(row.winner);
  }

  const walletFields = {
    player_stats: ["wallet"],
    season_progress: ["wallet"],
    shop_usdc_purchases: ["wallet"],
    shop_weekly_point_purchases: ["wallet"],
    fleet_nft_point_claims: ["wallet"],
    limited_sbt_claims: ["wallet"],
    easter_egg_claims: ["wallet"],
    external_quest_claims: ["wallet"],
    social_connections: ["wallet"],
    social_share_rewards: ["wallet"],
    creator_submissions: ["wallet"],
    creator_rewards: ["wallet"],
    player_items: ["wallet"],
    player_boosters: ["wallet"],
    referrals: ["referrer", "referee"],
  };

  for (const [tableName, fields] of Object.entries(walletFields)) {
    for (const row of data[tableName]) {
      for (const field of fields) addWallet(row[field]);
    }
  }

  const activity = [];
  const coreActivity = [];
  for (const row of data.games) {
    addActivity(activity, row.player1, row.created_at, "game");
    addActivity(activity, row.player2, row.created_at, "game");
    addActivity(coreActivity, row.player1, row.created_at, "game");
    addActivity(coreActivity, row.player2, row.created_at, "game");
  }
  for (const row of data.player_stats) {
    addActivity(activity, row.wallet, row.updated_at, "profile");
  }
  for (const row of data.season_progress) {
    addActivity(activity, row.wallet, row.updated_at, "season");
  }

  const datedActivityTables = [
    ["shop_usdc_purchases", "wallet", ["created_at", "purchased_at"], "purchase"],
    ["shop_weekly_point_purchases", "wallet", ["created_at", "purchased_at"], "points_purchase"],
    ["fleet_nft_point_claims", "wallet", ["created_at", "claimed_at"], "fleet_claim"],
    ["limited_sbt_claims", "wallet", ["created_at", "claimed_at"], "sbt_claim"],
    ["easter_egg_claims", "wallet", ["last_claimed_at", "created_at"], "easter_egg"],
    ["external_quest_claims", "wallet", ["claimed_at", "created_at"], "quest"],
    ["social_connections", "wallet", ["connected_at", "created_at"], "social_connect"],
    ["social_share_rewards", "wallet", ["created_at", "claimed_at"], "share"],
    ["creator_submissions", "wallet", ["created_at"], "creator_submission"],
    ["creator_rewards", "wallet", ["created_at"], "creator_reward"],
    ["player_items", "wallet", ["updated_at", "created_at"], "inventory"],
    ["player_boosters", "wallet", ["updated_at", "created_at"], "booster"],
  ];

  for (const [tableName, walletField, dateFields, type] of datedActivityTables) {
    for (const row of data[tableName]) {
      const dateValue = dateFields.map((field) => row[field]).find(Boolean);
      addActivity(activity, row[walletField], dateValue, type);
      if (!["inventory", "booster"].includes(type)) {
        addActivity(coreActivity, row[walletField], dateValue, type);
      }
    }
  }

  for (const row of data.referrals) {
    addActivity(activity, row.referrer, row.created_at, "referral");
    addActivity(activity, row.referee, row.created_at, "referral");
    addActivity(coreActivity, row.referrer, row.created_at, "referral");
    addActivity(coreActivity, row.referee, row.created_at, "referral");
  }

  const activityDates = activity.map((event) => event.at);
  const coverageStart = activityDates.length
    ? new Date(Math.min(...activityDates.map((value) => value.getTime())))
    : null;
  const coverageEnd = activityDates.length
    ? new Date(Math.max(...activityDates.map((value) => value.getTime())))
    : null;

  const monthlyActivity = new Map();
  const monthlyCoreActivity = new Map();
  const monthlyGamePlayers = new Map();
  const firstSeen = new Map();
  const dailyCoreActivity = new Map();

  for (const event of activity) {
    const month = monthKey(event.at);
    if (month) {
      if (!monthlyActivity.has(month)) monthlyActivity.set(month, new Set());
      monthlyActivity.get(month).add(event.wallet);
    }
    const previous = firstSeen.get(event.wallet);
    if (!previous || event.at < previous) firstSeen.set(event.wallet, event.at);
  }

  for (const event of coreActivity) {
    const month = monthKey(event.at);
    const day = dateKey(event.at);
    if (month) {
      if (!monthlyCoreActivity.has(month)) monthlyCoreActivity.set(month, new Set());
      monthlyCoreActivity.get(month).add(event.wallet);
      if (event.type === "game") {
        if (!monthlyGamePlayers.has(month)) monthlyGamePlayers.set(month, new Set());
        monthlyGamePlayers.get(month).add(event.wallet);
      }
    }
    if (day) {
      if (!dailyCoreActivity.has(day)) dailyCoreActivity.set(day, new Set());
      dailyCoreActivity.get(day).add(event.wallet);
    }
  }

  const newWalletsByMonth = new Map();
  for (const firstDate of firstSeen.values()) {
    const month = monthKey(firstDate);
    if (month) newWalletsByMonth.set(month, (newWalletsByMonth.get(month) ?? 0) + 1);
  }

  const gamesByMonth = new Map();
  for (const game of data.games) {
    const month = monthKey(game.created_at);
    if (!month) continue;
    if (!gamesByMonth.has(month)) {
      gamesByMonth.set(month, { total: 0, finished: 0, active: 0, waiting: 0, cancelled: 0 });
    }
    const bucket = gamesByMonth.get(month);
    bucket.total += 1;
    if (number(game.state) === 3) bucket.finished += 1;
    else if (number(game.state) === 2) bucket.active += 1;
    else if (number(game.state) === 4) bucket.cancelled += 1;
    else bucket.waiting += 1;
  }

  const months = [...new Set([
    ...monthlyActivity.keys(),
    ...gamesByMonth.keys(),
    ...newWalletsByMonth.keys(),
  ])].sort();

  let cumulativeWallets = 0;
  const monthly = months.map((month, index) => {
    const activeWallets = monthlyActivity.get(month) ?? new Set();
    const previousWallets = index > 0 ? monthlyActivity.get(months[index - 1]) ?? new Set() : new Set();
    const retained = [...previousWallets].filter((wallet) => activeWallets.has(wallet)).length;
    const games = gamesByMonth.get(month) ?? {
      total: 0,
      finished: 0,
      active: 0,
      waiting: 0,
      cancelled: 0,
    };
    const newWallets = newWalletsByMonth.get(month) ?? 0;
    cumulativeWallets += newWallets;
    const previousMau = index > 0 ? (monthlyActivity.get(months[index - 1])?.size ?? 0) : 0;

    return {
      month,
      newWallets,
      cumulativeWallets,
      activeWallets: activeWallets.size,
      coreActiveWallets: monthlyCoreActivity.get(month)?.size ?? 0,
      gamePlayers: monthlyGamePlayers.get(month)?.size ?? 0,
      activeGrowthPct: previousMau ? round(((activeWallets.size - previousMau) / previousMau) * 100) : null,
      retainedFromPreviousMonth: retained,
      monthToMonthRetentionPct: previousWallets.size ? pct(retained, previousWallets.size) : null,
      games: games.total,
      finishedGames: games.finished,
      completionRatePct: pct(games.finished, games.total),
    };
  });

  const now = new Date();
  const activeInWindow = (events, days) => {
    const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return new Set(events.filter((event) => event.at >= threshold).map((event) => event.wallet)).size;
  };

  const dailySeries = [...dailyCoreActivity.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, wallets]) => ({ date, activeWallets: wallets.size }));

  const gameStates = {
    waiting: data.games.filter((row) => number(row.state) === 1).length,
    active: data.games.filter((row) => number(row.state) === 2).length,
    finished: data.games.filter((row) => number(row.state) === 3).length,
    cancelled: data.games.filter((row) => number(row.state) === 4).length,
    other: data.games.filter((row) => ![1, 2, 3, 4].includes(number(row.state))).length,
  };
  const finishedGames = data.games.filter((row) => number(row.state) === 3);
  const wagerGames = data.games.filter((row) => row.game_mode === "wager");
  const wagerStakeUnits = wagerGames.reduce((sum, row) => {
    const fundedPlayers = normalizeWallet(row.player2) ? 2 : 1;
    return sum + number(row.wager_amount) * fundedPlayers;
  }, 0);
  const completedWagerVolumeUnits = wagerGames
    .filter((row) => number(row.state) === 3)
    .reduce((sum, row) => sum + number(row.wager_amount) * 2, 0);

  const hits = data.shots.filter((row) => row.is_hit === true).length;
  const misses = data.shots.filter((row) => row.is_hit === false).length;
  const classifiedShots = hits + misses;

  const playerPoints = data.player_stats.map((row) => number(row.points));
  const leaderboard = [...data.player_stats]
    .sort((a, b) => number(b.points) - number(a.points))
    .slice(0, 10)
    .map((row, index) => ({
      rank: index + 1,
      wallet: shortWallet(normalizeWallet(row.wallet) ?? ZERO_WALLET),
      points: number(row.points),
      wins: number(row.wins),
      games: number(row.games_played),
      winRatePct: pct(number(row.wins), number(row.games_played)),
      checkinStreak: number(row.checkin_streak),
    }));

  const shopRevenueMicro = data.shop_usdc_purchases.reduce(
    (sum, row) => sum + number(row.amount_usdc_micro ?? row.amount),
    0
  );
  const seasonPoints = data.season_progress.reduce((sum, row) => sum + number(row.points), 0);
  const seasonXp = data.season_progress.reduce((sum, row) => sum + number(row.xp), 0);
  const fleetClaimPoints = data.fleet_nft_point_claims.reduce(
    (sum, row) => sum + number(row.points),
    0
  );

  const report = {
    project: {
      name: "Sea Battle",
      network: "Base Mainnet",
      website: "https://seabattle.top",
      primaryContract: "0x8de75fbc38b1e47e53fb2e85791c935f5f653aa6",
      generatedAt: now.toISOString(),
      coverageStart: isoOrNull(coverageStart),
      coverageEnd: isoOrNull(coverageEnd),
      methodology:
        "Read-only aggregation of production Supabase tables. Human-wallet metrics exclude the zero address and the internal bot sentinel. Tracked MAU includes profile, season, economy, social, creator, inventory, booster, referral, and game records; core activity excludes profile, season, inventory, and booster update timestamps. Game players are reported separately.",
    },
    headline: {
      uniqueHumanWallets: allWallets.size,
      playerProfiles: data.player_stats.length,
      totalGames: data.games.length,
      finishedGames: gameStates.finished,
      completionRatePct: pct(gameStates.finished, data.games.length),
      totalShots: data.shots.length,
      latestMau: monthly.at(-1)?.activeWallets ?? 0,
      latestCoreMau: monthly.at(-1)?.coreActiveWallets ?? 0,
      latestGamePlayers: monthly.at(-1)?.gamePlayers ?? 0,
      latestMauGrowthPct: monthly.at(-1)?.activeGrowthPct ?? null,
    },
    acquisition: {
      uniqueHumanWallets: allWallets.size,
      activityWallets: firstSeen.size,
      latestMau: monthly.at(-1)?.activeWallets ?? 0,
      latestCoreMau: monthly.at(-1)?.coreActiveWallets ?? 0,
      latestGamePlayers: monthly.at(-1)?.gamePlayers ?? 0,
      activeLast7Days: activeInWindow(coreActivity, 7),
      activeLast30Days: activeInWindow(coreActivity, 30),
      trackedActiveLast30Days: activeInWindow(activity, 30),
      peakCoreDau: dailySeries.length ? Math.max(...dailySeries.map((row) => row.activeWallets)) : 0,
      monthly,
      dailyLast30Days: dailySeries,
    },
    gameplay: {
      totalGames: data.games.length,
      states: gameStates,
      completionRatePct: pct(gameStates.finished, data.games.length),
      resolvedLedgerRows: data.resolved_games.length,
      byMode: countBy(data.games, (row) => row.game_mode || "legacy"),
      humanPlayersInGames: uniqueWalletCount(data.games, ["player1", "player2"]),
      gamesPerHumanWallet: round(data.games.length / Math.max(1, allWallets.size), 2),
      totalShots: data.shots.length,
      hits,
      misses,
      unclassifiedShots: data.shots.length - classifiedShots,
      hitRatePct: pct(hits, classifiedShots),
      shotsPerGame: round(data.shots.length / Math.max(1, data.games.length), 1),
      shotsPerFinishedGame: round(data.shots.length / Math.max(1, finishedGames.length), 1),
    },
    players: {
      profiles: data.player_stats.length,
      totalRecordedGames: data.player_stats.reduce((sum, row) => sum + number(row.games_played), 0),
      totalRecordedWins: data.player_stats.reduce((sum, row) => sum + number(row.wins), 0),
      totalCheckins: data.player_stats.reduce((sum, row) => sum + number(row.total_checkins), 0),
      totalRecordedShots: data.player_stats.reduce((sum, row) => sum + number(row.total_shots), 0),
      points: {
        total: playerPoints.reduce((sum, value) => sum + value, 0),
        median: quantile(playerPoints, 0.5),
        p90: quantile(playerPoints, 0.9),
        maximum: Math.max(0, ...playerPoints),
      },
      leaderboard,
    },
    economy: {
      wagerGames: wagerGames.length,
      completedWagerGames: wagerGames.filter((row) => number(row.state) === 3).length,
      uniqueWagerPlayers: uniqueWalletCount(wagerGames, ["player1", "player2"]),
      representedStakeVolumeUsdc: round(wagerStakeUnits / 1_000_000, 2),
      completedWagerVolumeUsdc: round(completedWagerVolumeUnits / 1_000_000, 2),
      shopUsdcTransactions: data.shop_usdc_purchases.length,
      shopRevenueUsdc: round(shopRevenueMicro / 1_000_000, 2),
      pointPurchases: data.shop_weekly_point_purchases.length,
      itemsInInventories: data.player_items.reduce((sum, row) => sum + number(row.quantity), 0),
      inventoryOwners: uniqueWalletCount(data.player_items, ["wallet"]),
      activeOrOwnedBoosters: data.player_boosters.length,
      inventoryByItem: Object.fromEntries(
        Object.entries(
          data.player_items.reduce((acc, row) => {
            const key = row.item_slug || "unknown";
            acc[key] = (acc[key] ?? 0) + number(row.quantity);
            return acc;
          }, {})
        ).sort((a, b) => b[1] - a[1])
      ),
    },
    seasonAndCollectibles: {
      seasonProgressRows: data.season_progress.length,
      uniqueSeasonParticipants: uniqueWalletCount(data.season_progress, ["wallet"]),
      seasonPoints,
      seasonXp,
      seasons: countBy(data.season_progress, (row) => row.season_key || "unknown"),
      fleetNftClaims: data.fleet_nft_point_claims.length,
      uniqueFleetClaimers: uniqueWalletCount(data.fleet_nft_point_claims, ["wallet"]),
      uniqueFleetTokenIds: new Set(
        data.fleet_nft_point_claims.map((row) => String(row.token_id)).filter(Boolean)
      ).size,
      fleetPointsClaimed: fleetClaimPoints,
      captainSbtClaims: data.limited_sbt_claims.length,
      easterEggClaimRows: data.easter_egg_claims.length,
      easterEggTotalClaims: data.easter_egg_claims.reduce(
        (sum, row) => sum + number(row.total_claims || 1),
        0
      ),
    },
    community: {
      externalQuestClaims: data.external_quest_claims.length,
      uniqueQuesters: uniqueWalletCount(data.external_quest_claims, ["wallet"]),
      socialConnections: data.social_connections.length,
      uniqueSocialWallets: uniqueWalletCount(data.social_connections, ["wallet"]),
      socialShareRewards: data.social_share_rewards.length,
      uniqueSharers: uniqueWalletCount(data.social_share_rewards, ["wallet"]),
      referrals: data.referrals.length,
      uniqueReferrers: uniqueWalletCount(data.referrals, ["referrer"]),
      creatorSubmissions: data.creator_submissions.length,
      creatorSubmissionStatuses: countBy(data.creator_submissions, (row) => row.status || "unknown"),
      creatorRewards: data.creator_rewards.length,
      creatorRewardStatuses: countBy(data.creator_rewards, (row) => row.status || "unknown"),
      uniqueCreatorsRewarded: uniqueWalletCount(data.creator_rewards, ["wallet"]),
    },
    sourceRows: Object.fromEntries(TABLES.map((tableName) => [tableName, data[tableName].length])),
  };

  const outputPath = path.join(projectRoot, "app", "stats", "grant-stats.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Grant statistics saved to ${outputPath}`);
  console.log(
    JSON.stringify(
      {
        generatedAt: report.project.generatedAt,
        coverage: [report.project.coverageStart, report.project.coverageEnd],
        headline: report.headline,
        economy: report.economy,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
