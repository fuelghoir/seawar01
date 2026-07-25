const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  console.log("Building single-sheet master Excel report...");

  const games = await fetchAll('games');
  const shots = await fetchAll('shots');
  const playerStats = await fetchAll('player_stats');
  const seasonProgress = await fetchAll('season_progress');
  const usdcPurchases = await fetchAll('shop_usdc_purchases');
  const fleetClaims = await fetchAll('fleet_nft_point_claims');
  const questClaims = await fetchAll('external_quest_claims');
  const socialShares = await fetchAll('social_share_rewards');
  const referrals = await fetchAll('referrals');
  const creatorSubmissions = await fetchAll('creator_submissions');

  // Dates mapping
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

  const sortedDays = Object.keys(dailyEvents).sort();
  const walletAddedDays = {};
  Object.values(firstSeenWallet).forEach(info => {
    if (info.day) walletAddedDays[info.day] = (walletAddedDays[info.day] || 0) + 1;
  });

  let runningTotalWallets = 0;
  const dailyRows = sortedDays.map(day => {
    const d = dailyEvents[day];
    const newWalletsToday = walletAddedDays[day] || 0;
    runningTotalWallets += newWalletsToday;
    return {
      'Date': day,
      'Active Players (DAU)': d.wallets.size,
      'New Players': newWalletsToday,
      'Total Cumulative Players': runningTotalWallets,
      'Games Played': d.gamesCount,
      'Shots Fired': d.shotsCount,
      'Fleet NFT Claims': d.fleetClaimsCount,
      'Quest Claims': d.questClaimsCount,
      'Direct USDC Purchases ($)': `$${d.usdcRevenue.toFixed(2)}`
    };
  });

  // Monthly breakdown
  const monthlyData = {};
  ['2026-04', '2026-05', '2026-06', '2026-07'].forEach(m => {
    monthlyData[m] = { newPlayers: 0, activeWallets: new Set(), games: 0, shots: 0, fleetClaims: 0, questClaims: 0, usdcRevenue: 0 };
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
  const monthlyRows = ['2026-04', '2026-05', '2026-06', '2026-07'].map(m => {
    const md = monthlyData[m];
    cumWallets += md.newPlayers;
    const mau = md.activeWallets.size;
    const growthStr = prevMAU > 0 ? `+${(((mau - prevMAU) / prevMAU) * 100).toFixed(1)}%` : 'Baseline';
    prevMAU = mau;
    return {
      'Month': m,
      'New Players': md.newPlayers,
      'Total Players (Cum)': cumWallets,
      'Monthly Active Users (MAU)': mau,
      'MAU Growth %': growthStr,
      'Games Played': md.games,
      'Shots Fired': md.shots,
      'Fleet Claims': md.fleetClaims,
      'USDC Direct Purchases ($)': `$${md.usdcRevenue.toFixed(2)}`
    };
  });

  // Master Leaderboard
  const leaderboardRows = [...playerStats]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .map((p, i) => ({
      'Rank': i + 1,
      'Full Wallet Address': p.wallet,
      'Total Points': p.points || 0,
      'Wins': p.wins || 0,
      'Games Played': p.games_played || 0,
      'Win Rate %': p.games_played > 0 ? `${((p.wins / p.games_played) * 100).toFixed(1)}%` : '0%',
      'Total Hits': p.total_hits || 0,
      'Streak Days': p.checkin_streak || 0,
      'Total Checkins': p.total_checkins || 0
    }));

  // Revenue Breakdown Table
  let directUsdcTotal = 0;
  usdcPurchases.forEach(p => directUsdcTotal += (p.amount_usdc_micro || 0) / 1e6);
  const fleetMinersHolders = new Set(fleetClaims.map(c => c.wallet.toLowerCase())).size;

  const revenueRows = [
    { 'Category': 'Fleet Pass NFT Miners Sales & Upgrades', 'Details / Count': `${fleetMinersHolders} Miner Holders / 314 Claims`, 'Estimated USDC Revenue': '$38.25 - $76.50 USDC' },
    { 'Category': 'Direct Shop Purchases (Quest Rerolls)', 'Details / Count': `${usdcPurchases.length} Transactions in DB`, 'Estimated USDC Revenue': `$${directUsdcTotal.toFixed(2)} USDC` },
    { 'Category': 'TOTAL GAME REVENUE (ВСЕГО ДОХОД ИГРЫ)', 'Details / Count': 'Combined NFT Sales + In-App Shop', 'Estimated USDC Revenue': `$${(directUsdcTotal + 38.25).toFixed(2)} - $${(directUsdcTotal + 76.50).toFixed(2)} USDC` }
  ];

  // System Summary
  const summaryRows = [
    { 'Metric': 'Total Registered Unique Players (Всего уникальных игроков)', 'Value': Object.keys(firstSeenWallet).length },
    { 'Metric': 'Total Games Created (Всего создано игр)', 'Value': games.length },
    { 'Metric': 'Total Finished Games (Завершенных игр)', 'Value': games.filter(g => g.state === 'finished' || g.winner).length },
    { 'Metric': 'Total Shots Fired (Всего сделано выстрелов)', 'Value': shots.length },
    { 'Metric': 'Total Points Earned (Всего набрано очков)', 'Value': playerStats.reduce((s, p) => s + (p.points || 0), 0) },
    { 'Metric': 'Players with >= 100 Wins (Игроков с 100+ победами)', 'Value': playerStats.filter(p => (p.wins || 0) >= 100).length },
    { 'Metric': 'Season 1 Initial Prize Pool', 'Value': '$50.00 USDC' },
    { 'Metric': 'Season 2 Initial Prize Pool', 'Value': '$150.00 USDC' }
  ];

  // CREATE SINGLE MASTER WORKBOOK & SHEET
  const wb = XLSX.utils.book_new();

  // Combine everything into a single sheet array
  const singleSheetData = [];

  singleSheetData.push({ 'SEA BATTLE MASTER REPORT': '=== 1. EXECUTIVE SUMMARY (ОБЩИЕ ИТОГИ) ===' });
  summaryRows.forEach(r => singleSheetData.push({ 'SEA BATTLE MASTER REPORT': r.Metric, 'FIELD_2': r.Value }));

  singleSheetData.push({ 'SEA BATTLE MASTER REPORT': '' });
  singleSheetData.push({ 'SEA BATTLE MASTER REPORT': '=== 2. GAME REVENUE BREAKDOWN (ДОХОДЫ И ПРОДАЖИ) ===' });
  revenueRows.forEach(r => singleSheetData.push({ 'SEA BATTLE MASTER REPORT': r.Category, 'FIELD_2': r['Details / Count'], 'FIELD_3': r['Estimated USDC Revenue'] }));

  singleSheetData.push({ 'SEA BATTLE MASTER REPORT': '' });
  singleSheetData.push({ 'SEA BATTLE MASTER REPORT': '=== 3. MONTHLY METRICS (MAU & РОСТ ПО МЕСЯЦАМ) ===' });
  monthlyRows.forEach(r => singleSheetData.push({
    'SEA BATTLE MASTER REPORT': `Month: ${r.Month}`,
    'FIELD_2': `New: ${r['New Players']} | MAU: ${r['Monthly Active Users (MAU)']} (${r['MAU Growth %']})`,
    'FIELD_3': `Games: ${r['Games Played']} | Shots: ${r['Shots Fired']} | Claims: ${r['Fleet Claims']}`
  }));

  singleSheetData.push({ 'SEA BATTLE MASTER REPORT': '' });
  singleSheetData.push({ 'SEA BATTLE MASTER REPORT': '=== 4. LEADERBOARD TOP PLAYERS (ЛИДЕРБОРД 228 ИГРОКОВ) ===' });
  leaderboardRows.forEach(r => singleSheetData.push({
    'SEA BATTLE MASTER REPORT': `#${r.Rank} - ${r['Full Wallet Address']}`,
    'FIELD_2': `Points: ${r['Total Points'].toLocaleString()} | Wins: ${r.Wins} | Games: ${r['Games Played']}`,
    'FIELD_3': `WinRate: ${r['Win Rate %']} | Streak: ${r['Streak Days']}d`
  }));

  const wsMaster = XLSX.utils.json_to_sheet(singleSheetData, { skipHeader: true });
  XLSX.utils.book_append_sheet(wb, wsMaster, 'All Data');

  // Also include standalone clean sheets for Excel desktop users
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revenueRows), 'Revenue');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyRows), 'Monthly');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leaderboardRows), 'Leaderboard');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), 'Daily DAU');

  const outputPath = path.join('d:/seawar01', 'Sea_Battle_Full_Statistics_Report_v2.xlsx');
  XLSX.writeFile(wb, outputPath);
  console.log(`Saved master single-sheet report to ${outputPath}`);
  try {
    XLSX.writeFile(wb, path.join('d:/seawar01', 'Sea_Battle_Full_Statistics_Report.xlsx'));
  } catch {
    // Ignore lock if user has file open in Excel
  }
}

main().catch(console.error);
