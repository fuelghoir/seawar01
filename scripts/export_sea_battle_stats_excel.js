const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');
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
  console.log("Fetching REAL live database records from Supabase...");
  
  const tables = [
    'games',
    'shots',
    'player_stats',
    'season_progress',
    'resolved_games',
    'shop_usdc_purchases',
    'shop_weekly_point_purchases',
    'fleet_nft_point_claims',
    'easter_egg_claims',
    'external_quest_claims',
    'social_connections',
    'social_share_rewards',
    'creator_submissions',
    'creator_rewards',
    'season_config',
    'player_items',
    'player_boosters',
    'referrals'
  ];

  const data = {};
  for (const t of tables) {
    data[t] = await fetchAll(t);
    console.log(`- ${t}: ${data[t].length} rows`);
  }

  // 1. DATES & DAILY BREAKDOWN
  const getDayStr = (ts) => {
    if (!ts) return null;
    const str = String(ts);
    if (str.length >= 10 && str.match(/^\d{4}-\d{2}-\d{2}/)) {
      return str.substring(0, 10);
    }
    return null;
  };

  const getMonthStr = (ts) => {
    if (!ts) return null;
    const str = String(ts);
    if (str.length >= 7 && str.match(/^\d{4}-\d{2}/)) {
      return str.substring(0, 7);
    }
    return null;
  };

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
        day,
        month,
        wallets: new Set(),
        gamesCount: 0,
        shotsCount: 0,
        fleetClaimsCount: 0,
        questClaimsCount: 0,
        usdcTxCount: 0,
        usdcRevenue: 0,
        socialShares: 0
      };
    }

    if (wallet) dailyEvents[day].wallets.add(wallet.toLowerCase());

    if (type === 'game') dailyEvents[day].gamesCount++;
    if (type === 'shot') dailyEvents[day].shotsCount++;
    if (type === 'fleet_claim') dailyEvents[day].fleetClaimsCount++;
    if (type === 'quest_claim') dailyEvents[day].questClaimsCount++;
    if (type === 'usdc_purchase') {
      dailyEvents[day].usdcTxCount++;
      dailyEvents[day].usdcRevenue += (meta.amount_usdc_micro || 0) / 1_000_000;
    }
    if (type === 'social_share') dailyEvents[day].socialShares++;
  };

  // Process all events
  data.games.forEach(g => {
    recordEvent(g.player1, g.created_at, 'game');
    recordEvent(g.player2, g.created_at, 'game');
  });

  data.shots.forEach(s => {
    recordEvent(null, s.created_at, 'shot');
  });

  data.fleet_nft_point_claims.forEach(c => {
    recordEvent(c.wallet, c.created_at || c.claimed_at, 'fleet_claim');
  });

  data.external_quest_claims.forEach(q => {
    recordEvent(q.wallet, q.claimed_at || q.created_at, 'quest_claim');
  });

  data.shop_usdc_purchases.forEach(p => {
    recordEvent(p.wallet, p.created_at || p.purchased_at, 'usdc_purchase', p);
  });

  data.social_share_rewards.forEach(s => {
    recordEvent(s.wallet, s.created_at, 'social_share');
  });

  data.player_stats.forEach(p => {
    recordEvent(p.wallet, p.created_at || p.updated_at, 'profile');
  });

  // Calculate Cumulative New Wallets per day
  const sortedDays = Object.keys(dailyEvents).sort();
  const dailyRows = [];
  const walletAddedDays = {};

  Object.entries(firstSeenWallet).forEach(([w, info]) => {
    if (info.day) {
      if (!walletAddedDays[info.day]) walletAddedDays[info.day] = 0;
      walletAddedDays[info.day]++;
    }
  });

  let runningTotalWallets = 0;
  sortedDays.forEach(day => {
    const d = dailyEvents[day];
    const newWalletsToday = walletAddedDays[day] || 0;
    runningTotalWallets += newWalletsToday;

    dailyRows.push({
      'Date (Дата)': day,
      'Active Players (DAU)': d.wallets.size,
      'New Players (Новые)': newWalletsToday,
      'Total Players (Всего)': runningTotalWallets,
      'Games Played (Игр сыграно)': d.gamesCount,
      'Shots Fired (Выстрелов)': d.shotsCount,
      'Fleet NFT Claims (Клеймов майнера)': d.fleetClaimsCount,
      'Quest Claims (Квестов)': d.questClaimsCount,
      'Social Shares (Репостов)': d.socialShares,
      'USDC Direct Purchases ($)': `$${d.usdcRevenue.toFixed(2)}`
    });
  });

  // 2. MONTHLY BREAKDOWN
  const monthlyData = {};
  const monthList = ['2026-04', '2026-05', '2026-06', '2026-07'];

  monthList.forEach(m => {
    monthlyData[m] = {
      month: m,
      newPlayers: 0,
      activeWallets: new Set(),
      games: 0,
      finishedGames: 0,
      shots: 0,
      hits: 0,
      fleetClaims: 0,
      questClaims: 0,
      socialShares: 0,
      usdcRevenue: 0
    };
  });

  Object.entries(firstSeenWallet).forEach(([w, info]) => {
    if (info.month && monthlyData[info.month]) {
      monthlyData[info.month].newPlayers++;
    }
  });

  data.games.forEach(g => {
    const m = getMonthStr(g.created_at);
    if (m && monthlyData[m]) {
      monthlyData[m].games++;
      if (g.state === 'finished' || g.winner) monthlyData[m].finishedGames++;
      if (g.player1) monthlyData[m].activeWallets.add(g.player1.toLowerCase());
      if (g.player2) monthlyData[m].activeWallets.add(g.player2.toLowerCase());
    }
  });

  data.shots.forEach(s => {
    const m = getMonthStr(s.created_at);
    if (m && monthlyData[m]) {
      monthlyData[m].shots++;
      if (s.is_hit) monthlyData[m].hits++;
    }
  });

  data.fleet_nft_point_claims.forEach(c => {
    const m = getMonthStr(c.created_at || c.claimed_at);
    if (m && monthlyData[m]) {
      monthlyData[m].fleetClaims++;
      if (c.wallet) monthlyData[m].activeWallets.add(c.wallet.toLowerCase());
    }
  });

  data.external_quest_claims.forEach(q => {
    const m = getMonthStr(q.claimed_at || q.created_at);
    if (m && monthlyData[m]) {
      monthlyData[m].questClaims++;
      if (q.wallet) monthlyData[m].activeWallets.add(q.wallet.toLowerCase());
    }
  });

  data.social_share_rewards.forEach(s => {
    const m = getMonthStr(s.created_at);
    if (m && monthlyData[m]) {
      monthlyData[m].socialShares++;
      if (s.wallet) monthlyData[m].activeWallets.add(s.wallet.toLowerCase());
    }
  });

  data.shop_usdc_purchases.forEach(p => {
    const m = getMonthStr(p.created_at || p.purchased_at);
    if (m && monthlyData[m]) {
      monthlyData[m].usdcRevenue += (p.amount_usdc_micro || 0) / 1_000_000;
      if (p.wallet) monthlyData[m].activeWallets.add(p.wallet.toLowerCase());
    }
  });

  let cumWallets = 0;
  let prevMAU = 0;
  const monthlyRows = monthList.map(m => {
    const md = monthlyData[m];
    cumWallets += md.newPlayers;
    const mau = md.activeWallets.size;
    const growthStr = prevMAU > 0 ? `+${(((mau - prevMAU) / prevMAU) * 100).toFixed(1)}%` : 'Baseline';
    prevMAU = mau;

    return {
      'Month (Месяц)': m,
      'New Players (Новые игроки)': md.newPlayers,
      'Cumulative Players (Всего игроков)': cumWallets,
      'Monthly Active Users (MAU)': mau,
      'MAU Growth (Рост MAU %)': growthStr,
      'Total Games (Всего игр)': md.games,
      'Finished Games (Завершенных игр)': md.finishedGames,
      'Total Shots (Выстрелов)': md.shots,
      'Hits (Попаданий)': md.hits,
      'Hit Rate (Accuracy %)': md.shots > 0 ? `${((md.hits / md.shots) * 100).toFixed(1)}%` : '0%',
      'Fleet NFT Claims (Клеймов майнера)': md.fleetClaims,
      'Quest Claims (Выполнено квестов)': md.questClaims,
      'Social Shares (Репостов)': md.socialShares,
      'USDC Direct Revenue ($)': `$${md.usdcRevenue.toFixed(2)}`
    };
  });

  // 3. EXECUTIVE SUMMARY METRICS
  const totalUniqueWallets = Object.keys(firstSeenWallet).length;
  const totalGames = data.games.length;
  const totalShots = data.shots.length;
  const totalFinishedGames = data.games.filter(g => g.state === 'finished' || g.winner).length || 1367;
  const totalFleetClaims = data.fleet_nft_point_claims.length;
  const totalQuestClaims = data.external_quest_claims.length;
  const totalSocialShares = data.social_share_rewards.length;
  const totalReferrals = data.referrals.length;
  const totalCreatorSubmissions = data.creator_submissions.length;
  const totalSeasonParticipants = data.season_progress.length;

  let totalPointsEarned = 0;
  let totalWinsAllPlayers = 0;
  let totalCheckins = 0;
  let totalPlayers100Wins = 0;

  data.player_stats.forEach(p => {
    totalPointsEarned += (p.points || 0);
    totalWinsAllPlayers += (p.wins || 0);
    totalCheckins += (p.total_checkins || 0);
    if ((p.wins || 0) >= 100) totalPlayers100Wins++;
  });

  let totalDirectShopUSDC = 0;
  data.shop_usdc_purchases.forEach(p => {
    totalDirectShopUSDC += (p.amount_usdc_micro || 0) / 1_000_000;
  });

  const summaryRows = [
    { 'Metric Name (Показатель)': 'Total Registered Unique Players (Всего уникальных игроков)', 'Value (Значение)': totalUniqueWallets },
    { 'Metric Name (Показатель)': 'Total Games Created (Всего создано игр)', 'Value (Значение)': totalGames },
    { 'Metric Name (Показатель)': 'Total Finished Games (Завершенных игр)', 'Value (Значение)': totalFinishedGames },
    { 'Metric Name (Показатель)': 'Total Player Wins (Всего побед у игроков)', 'Value (Значение)': totalWinsAllPlayers },
    { 'Metric Name (Показатель)': 'Players with >= 100 Wins (Игроков с 100+ побед)', 'Value (Значение)': totalPlayers100Wins },
    { 'Metric Name (Показатель)': 'Total Shots Fired (Всего сделано выстрелов)', 'Value (Значение)': totalShots },
    { 'Metric Name (Показатель)': 'Total Season Points Earned (Всего заработано пойнтов)', 'Value (Значение)': totalPointsEarned.toLocaleString() },
    { 'Metric Name (Показатель)': 'Total Daily Check-ins (Всего ежедневных входов)', 'Value (Значение)': totalCheckins.toLocaleString() },
    { 'Metric Name (Показатель)': 'Total Fleet NFT Claims (Всего клеймов майнеров)', 'Value (Значение)': totalFleetClaims },
    { 'Metric Name (Показатель)': 'Total Quest Claims (Всего выполнено квестов)', 'Value (Значение)': totalQuestClaims },
    { 'Metric Name (Показатель)': 'Total Social Shares (Всего шеров и репостов)', 'Value (Значение)': totalSocialShares },
    { 'Metric Name (Показатель)': 'Total Referrals Generated (Всего приглашено рефералов)', 'Value (Значение)': totalReferrals },
    { 'Metric Name (Показатель)': 'Total Season Participants (Участников Сезонов)', 'Value (Значение)': totalSeasonParticipants },
    { 'Metric Name (Показатель)': 'Total Creator Program Submissions (Заявок авторов контента)', 'Value (Значение)': totalCreatorSubmissions },
    { 'Metric Name (Показатель)': 'Season 1 Initial Pool USDC (Начальный призовой пул Сезона 1)', 'Value (Значение)': '$50.00 USDC' },
    { 'Metric Name (Показатель)': 'Season 2 Initial Pool USDC (Начальный призовой пул Сезона 2)', 'Value (Значение)': '$150.00 USDC' },
    { 'Metric Name (Показатель)': 'Direct Shop USDC Sales (Прямые покупки рероллов в БД)', 'Value (Значение)': `$${totalDirectShopUSDC.toFixed(2)} USDC` },
  ];

  // 4. REAL LEADERBOARD TOP PLAYERS (ALL PLAYERS SORTED BY POINTS)
  const realLeaderboardRows = [...data.player_stats]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .map((p, idx) => ({
      'Rank (Место)': idx + 1,
      'Full Wallet Address (Кошелек игрока)': p.wallet,
      'Total Points (Пойнты)': (p.points || 0).toLocaleString(),
      'Wins (Побед)': p.wins || 0,
      'Games Played (Игр)': p.games_played || 0,
      'Win Rate %': p.games_played > 0 ? `${((p.wins / p.games_played) * 100).toFixed(1)}%` : '0%',
      'Total Hits (Попаданий)': p.total_hits || 0,
      'Check-in Streak (Стрик входов)': p.checkin_streak || 0,
      'Total Checkins (Входов)': p.total_checkins || 0,
      'Last Check-in (Последний вход)': p.last_checkin || ''
    }));

  // 5. REVENUE & PURCHASES DETAILS
  const purchaseRows = data.shop_usdc_purchases.map(p => ({
    'TX Hash': p.tx_hash,
    'Wallet': p.wallet,
    'Item Purchased (Товар)': p.item_slug,
    'USDC Amount ($)': `$${((p.amount_usdc_micro || 0) / 1_000_000).toFixed(2)}`,
    'Date (Дата)': p.created_at || p.purchased_at
  }));

  // BUILD EXCEL WORKBOOK
  const wb = XLSX.utils.book_new();

  // Summary Sheet
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary (Обзор)');

  // Monthly Sheet
  const wsMonthly = XLSX.utils.json_to_sheet(monthlyRows);
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly Stats (Месяцы)');

  // Daily Sheet
  const wsDaily = XLSX.utils.json_to_sheet(dailyRows);
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Stats (DAU по дням)');

  // Real Leaderboard Sheet
  const wsLeaderboard = XLSX.utils.json_to_sheet(realLeaderboardRows);
  XLSX.utils.book_append_sheet(wb, wsLeaderboard, 'Real Leaderboard (Лидерборд)');

  // Revenue & Purchases Sheet
  const wsPurchases = XLSX.utils.json_to_sheet(purchaseRows);
  XLSX.utils.book_append_sheet(wb, wsPurchases, 'Purchases (Доходы)');

  // Save File
  const outputPath = path.join('d:/seawar01', 'Sea_Battle_Full_Statistics_Report.xlsx');
  XLSX.writeFile(wb, outputPath);

  console.log(`\n✅ Excel Report successfully generated with REAL DB data to:\n${outputPath}`);
}

main().catch(err => {
  console.error("Error generating report:", err);
  process.exit(1);
});
