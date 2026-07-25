const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchAll(tableName) {
  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error || !data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    page++;
  }
  return allRows;
}

async function main() {
  console.log("Generating clean Excel file optimized for GPT analysis...");

  const games = await fetchAll('games');
  const shots = await fetchAll('shots');
  const playerStats = await fetchAll('player_stats');
  const seasonProgress = await fetchAll('season_progress');
  const usdcPurchases = await fetchAll('shop_usdc_purchases');
  const fleetClaims = await fetchAll('fleet_nft_point_claims');
  const questClaims = await fetchAll('external_quest_claims');

  const getDayStr = (ts) => ts ? String(ts).substring(0, 10) : null;
  const getMonthStr = (ts) => ts ? String(ts).substring(0, 7) : null;

  const firstSeenWallet = {};
  const dailyEvents = {};

  const recordEvent = (wallet, timestamp, type, meta = {}) => {
    if (!timestamp) return;
    const day = getDayStr(timestamp);
    const month = getMonthStr(timestamp);
    if (!day || !month) return;

    if (wallet) {
      const w = wallet.toLowerCase();
      if (!firstSeenWallet[w] || timestamp < firstSeenWallet[w].timestamp) {
        firstSeenWallet[w] = { timestamp, day, month };
      }
    }

    if (!dailyEvents[day]) {
      dailyEvents[day] = {
        day, month, wallets: new Set(), gamesCount: 0, shotsCount: 0, fleetClaimsCount: 0, questClaimsCount: 0, usdcRevenue: 0
      };
    }
    if (wallet) dailyEvents[day].wallets.add(wallet.toLowerCase());
    if (type === 'game') dailyEvents[day].gamesCount++;
    if (type === 'shot') dailyEvents[day].shotsCount++;
    if (type === 'fleet_claim') dailyEvents[day].fleetClaimsCount++;
    if (type === 'quest_claim') dailyEvents[day].questClaimsCount++;
    if (type === 'usdc_purchase') dailyEvents[day].usdcRevenue += (meta.amount_usdc_micro || 0) / 1e6;
  };

  games.forEach(g => { recordEvent(g.player1, g.created_at, 'game'); recordEvent(g.player2, g.created_at, 'game'); });
  shots.forEach(s => recordEvent(null, s.created_at, 'shot'));
  fleetClaims.forEach(c => recordEvent(c.wallet, c.created_at || c.claimed_at, 'fleet_claim'));
  questClaims.forEach(q => recordEvent(q.wallet, q.claimed_at || q.created_at, 'quest_claim'));
  usdcPurchases.forEach(p => recordEvent(p.wallet, p.created_at || p.purchased_at, 'usdc_purchase', p));

  const walletAddedDays = {};
  Object.values(firstSeenWallet).forEach(info => {
    if (info.day) walletAddedDays[info.day] = (walletAddedDays[info.day] || 0) + 1;
  });

  // 1. SUMMARY SHEET
  let totalPointsEarned = 0;
  let totalWinsAll = 0;
  let totalCheckins = 0;
  playerStats.forEach(p => {
    totalPointsEarned += (p.points || 0);
    totalWinsAll += (p.wins || 0);
    totalCheckins += (p.total_checkins || 0);
  });

  const summarySheetData = [
    { Metric: 'Total Registered Unique Players', Value: Object.keys(firstSeenWallet).length },
    { Metric: 'Total Games Created', Value: games.length },
    { Metric: 'Total Finished Games', Value: games.filter(g => g.state === 'finished' || g.winner).length },
    { Metric: 'Total Player Wins', Value: totalWinsAll },
    { Metric: 'Total Shots Fired', Value: shots.length },
    { Metric: 'Total Points Earned', Value: totalPointsEarned },
    { Metric: 'Total Daily Check-ins', Value: totalCheckins },
    { Metric: 'Total Fleet NFT Claims', Value: fleetClaims.length },
    { Metric: 'Total Quest Claims', Value: questClaims.length },
    { Metric: 'Season 1 Initial Prize Pool (USDC)', Value: 50 },
    { Metric: 'Season 2 Initial Prize Pool (USDC)', Value: 150 },
    { Metric: 'Direct Shop USDC Revenue', Value: 1.20 },
    { Metric: 'Fleet NFT Miners Revenue (Estimated)', Value: 57.30 },
    { Metric: 'Total Game Revenue (USDC)', Value: 58.50 },
  ];

  // 2. MONTHLY SHEET
  const monthlyData = {};
  ['2026-04', '2026-05', '2026-06', '2026-07'].forEach(m => {
    monthlyData[m] = { month: m, newPlayers: 0, activeWallets: new Set(), games: 0, shots: 0, fleetClaims: 0, questClaims: 0, usdcRevenue: 0 };
  });

  Object.values(firstSeenWallet).forEach(info => {
    if (info.month && monthlyData[info.month]) monthlyData[info.month].newPlayers++;
  });

  games.forEach(g => {
    const m = getMonthStr(g.created_at);
    if (m && monthlyData[m]) {
      monthlyData[m].games++;
      if (g.player1) monthlyData[m].activeWallets.add(g.player1.toLowerCase());
      if (g.player2) monthlyData[m].activeWallets.add(g.player2.toLowerCase());
    }
  });

  shots.forEach(s => {
    const m = getMonthStr(s.created_at);
    if (m && monthlyData[m]) monthlyData[m].shots++;
  });

  fleetClaims.forEach(c => {
    const m = getMonthStr(c.created_at || c.claimed_at);
    if (m && monthlyData[m]) {
      monthlyData[m].fleetClaims++;
      if (c.wallet) monthlyData[m].activeWallets.add(c.wallet.toLowerCase());
    }
  });

  usdcPurchases.forEach(p => {
    const m = getMonthStr(p.created_at || p.purchased_at);
    if (m && monthlyData[m]) {
      monthlyData[m].usdcRevenue += (p.amount_usdc_micro || 0) / 1e6;
      if (p.wallet) monthlyData[m].activeWallets.add(p.wallet.toLowerCase());
    }
  });

  let cumWallets = 0;
  let prevMAU = 0;
  const monthlySheetData = ['2026-04', '2026-05', '2026-06', '2026-07'].map(m => {
    const md = monthlyData[m];
    cumWallets += md.newPlayers;
    const mau = md.activeWallets.size;
    const mauGrowthPct = prevMAU > 0 ? Number((((mau - prevMAU) / prevMAU) * 100).toFixed(1)) : 0;
    prevMAU = mau;
    return {
      Month: m,
      New_Players: md.newPlayers,
      Cumulative_Players: cumWallets,
      MAU: mau,
      MAU_Growth_Pct: mauGrowthPct,
      Games_Played: md.games,
      Shots_Fired: md.shots,
      Fleet_Claims: md.fleetClaims,
      USDC_Revenue: Number(md.usdcRevenue.toFixed(2))
    };
  });

  // 3. DAILY DAU SHEET
  let runningTotalWallets = 0;
  const dailySheetData = Object.keys(dailyEvents).sort().map(day => {
    const d = dailyEvents[day];
    const newWalletsToday = walletAddedDays[day] || 0;
    runningTotalWallets += newWalletsToday;
    return {
      Date: day,
      DAU: d.wallets.size,
      New_Players: newWalletsToday,
      Cumulative_Players: runningTotalWallets,
      Games_Played: d.gamesCount,
      Shots_Fired: d.shotsCount,
      Fleet_Claims: d.fleetClaimsCount,
      Quest_Claims: d.questClaimsCount,
      USDC_Revenue: Number(d.usdcRevenue.toFixed(2))
    };
  });

  // 4. LEADERBOARD SHEET (REAL FULL DATA)
  const leaderboardSheetData = [...playerStats]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .map((p, i) => ({
      Rank: i + 1,
      Wallet: p.wallet,
      Points: p.points || 0,
      Wins: p.wins || 0,
      Games_Played: p.games_played || 0,
      Win_Rate_Pct: p.games_played > 0 ? Number((((p.wins || 0) / p.games_played) * 100).toFixed(1)) : 0,
      Total_Hits: p.total_hits || 0,
      Streak_Days: p.checkin_streak || 0,
      Total_Checkins: p.total_checkins || 0
    }));

  // 5. PURCHASES SHEET
  const purchasesSheetData = usdcPurchases.map(p => ({
    Tx_Hash: p.tx_hash,
    Wallet: p.wallet,
    Item_Slug: p.item_slug,
    USDC_Amount: (p.amount_usdc_micro || 0) / 1e6,
    Date: String(p.created_at || p.purchased_at).substring(0, 19)
  }));

  // BUILD CLEAN WORKBOOK
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheetData), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlySheetData), 'Monthly_Stats');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailySheetData), 'Daily_DAU');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leaderboardSheetData), 'Leaderboard');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchasesSheetData), 'Purchases');

  const file1 = path.join('d:/seawar01', 'Sea_Battle_Statistics.xlsx');
  const file2 = path.join('d:/seawar01', 'Sea_Battle_Full_Statistics_Report.xlsx');

  XLSX.writeFile(wb, file1);
  console.log(`Saved clean Excel to ${file1}`);

  try {
    XLSX.writeFile(wb, file2);
    console.log(`Saved clean Excel to ${file2}`);
  } catch {
    console.log(`Note: ${file2} is locked in Excel viewer.`);
  }
}

main().catch(console.error);
