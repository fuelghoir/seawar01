const { createClient } = require('@supabase/supabase-js');
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
    
    if (error) {
      console.error(`Error fetching ${tableName}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    page++;
  }
  return allRows;
}

async function getCount(tableName) {
  const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
  if (error) return `Error: ${error.message}`;
  return count;
}

async function main() {
  const tableNames = [
    'games',
    'shots',
    'player_stats',
    'season_progress',
    'resolved_games',
    'shop_usdc_purchases',
    'shop_weekly_point_purchases',
    'fleet_nft_point_claims',
    'limited_sbt_claims',
    'easter_egg_claims',
    'external_quest_claims',
    'social_connections',
    'social_share_rewards',
    'wallet_activity',
    'creator_submissions',
    'creator_rewards',
    'challenge_games',
    'season_config',
    'player_items',
    'player_boosters',
    'referrals'
  ];

  console.log("=== TABLE COUNTS ===");
  for (const t of tableNames) {
    const cnt = await getCount(t);
    console.log(`${t}: ${cnt}`);
  }

  // Fetch all tables with select('*')
  console.log("\nFetching all table data...");
  const data = {};
  for (const t of tableNames) {
    data[t] = await fetchAll(t);
    console.log(`Fetched ${data[t].length} rows for ${t}`);
    if (data[t].length > 0) {
      console.log(`Sample keys for ${t}:`, Object.keys(data[t][0]));
    }
  }

  // AGGREGATION & MONTHLY BREAKDOWN
  // Helper to extract timestamp string YYYY-MM
  const getMonth = (ts) => {
    if (!ts) return null;
    const str = String(ts);
    if (str.length >= 7 && str.match(/^\d{4}-\d{2}/)) {
      return str.substring(0, 7);
    }
    return null;
  };

  // Collect all events with wallet, date, month, activity type
  const events = [];

  // games
  data['games'].forEach(g => {
    const m = getMonth(g.created_at);
    if (g.player1) events.push({ wallet: g.player1.toLowerCase(), date: g.created_at, month: m, type: 'game_player1', extra: g });
    if (g.player2) events.push({ wallet: g.player2.toLowerCase(), date: g.created_at, month: m, type: 'game_player2', extra: g });
  });

  // player_stats
  data['player_stats'].forEach(p => {
    const dt = p.created_at || p.updated_at;
    const m = getMonth(dt);
    if (p.wallet) events.push({ wallet: p.wallet.toLowerCase(), date: dt, month: m, type: 'player_stats', extra: p });
  });

  // season_progress
  data['season_progress'].forEach(s => {
    const dt = s.created_at || s.updated_at;
    const m = getMonth(dt);
    if (s.wallet) events.push({ wallet: s.wallet.toLowerCase(), date: dt, month: m, type: 'season_progress', extra: s });
  });

  // shop_usdc_purchases
  data['shop_usdc_purchases'].forEach(p => {
    const dt = p.created_at || p.purchased_at;
    const m = getMonth(dt);
    if (p.wallet) events.push({ wallet: p.wallet.toLowerCase(), date: dt, month: m, type: 'shop_usdc_purchase', extra: p });
  });

  // shop_weekly_point_purchases
  data['shop_weekly_point_purchases'].forEach(p => {
    const dt = p.created_at || p.purchased_at;
    const m = getMonth(dt);
    if (p.wallet) events.push({ wallet: p.wallet.toLowerCase(), date: dt, month: m, type: 'shop_point_purchase', extra: p });
  });

  // fleet_nft_point_claims
  data['fleet_nft_point_claims'].forEach(c => {
    const dt = c.claimed_at || c.created_at;
    const m = getMonth(dt);
    if (c.wallet) events.push({ wallet: c.wallet.toLowerCase(), date: dt, month: m, type: 'fleet_nft_claim', extra: c });
  });

  // limited_sbt_claims
  data['limited_sbt_claims'].forEach(c => {
    const dt = c.claimed_at || c.created_at;
    const m = getMonth(dt);
    if (c.wallet) events.push({ wallet: c.wallet.toLowerCase(), date: dt, month: m, type: 'limited_sbt_claim', extra: c });
  });

  // easter_egg_claims
  data['easter_egg_claims'].forEach(c => {
    const dt = c.claimed_at || c.created_at;
    const m = getMonth(dt);
    if (c.wallet) events.push({ wallet: c.wallet.toLowerCase(), date: dt, month: m, type: 'easter_egg_claim', extra: c });
  });

  // external_quest_claims
  data['external_quest_claims'].forEach(c => {
    const dt = c.claimed_at || c.created_at;
    const m = getMonth(dt);
    if (c.wallet) events.push({ wallet: c.wallet.toLowerCase(), date: dt, month: m, type: 'external_quest_claim', extra: c });
  });

  // social_share_rewards
  data['social_share_rewards'].forEach(s => {
    const dt = s.created_at || s.claimed_at;
    const m = getMonth(dt);
    if (s.wallet) events.push({ wallet: s.wallet.toLowerCase(), date: dt, month: m, type: 'social_share_reward', extra: s });
  });

  // referrals
  data['referrals'].forEach(r => {
    const dt = r.created_at;
    const m = getMonth(dt);
    if (r.referee) events.push({ wallet: r.referee.toLowerCase(), date: dt, month: m, type: 'referral_referee', extra: r });
    if (r.referrer) events.push({ wallet: r.referrer.toLowerCase(), date: dt, month: m, type: 'referral_referrer', extra: r });
  });

  // player_items & player_boosters
  data['player_items'].forEach(i => {
    const dt = i.created_at || i.updated_at;
    const m = getMonth(dt);
    if (i.wallet) events.push({ wallet: i.wallet.toLowerCase(), date: dt, month: m, type: 'player_item', extra: i });
  });

  data['player_boosters'].forEach(b => {
    const dt = b.created_at || b.updated_at;
    const m = getMonth(dt);
    if (b.wallet) events.push({ wallet: b.wallet.toLowerCase(), date: dt, month: m, type: 'player_booster', extra: b });
  });

  // Unique Wallets and First Seen
  const firstSeen = {};
  const monthlyActive = {};
  const monthlyEventsCount = {};

  events.forEach(ev => {
    const { wallet, date, month } = ev;
    if (!wallet) return;
    if (date && (!firstSeen[wallet] || date < firstSeen[wallet].date)) {
      firstSeen[wallet] = { date, month: getMonth(date) };
    } else if (!date && !firstSeen[wallet]) {
      firstSeen[wallet] = { date: null, month: null };
    }

    if (month) {
      if (!monthlyActive[month]) monthlyActive[month] = new Set();
      monthlyActive[month].add(wallet);

      if (!monthlyEventsCount[month]) monthlyEventsCount[month] = 0;
      monthlyEventsCount[month]++;
    }
  });

  // New Players by month (first seen)
  const newPlayersByMonth = {};
  Object.values(firstSeen).forEach(fs => {
    const m = fs.month;
    if (m) {
      if (!newPlayersByMonth[m]) newPlayersByMonth[m] = 0;
      newPlayersByMonth[m]++;
    }
  });

  // Games stats by month
  const gamesByMonth = {};
  data['games'].forEach(g => {
    const m = getMonth(g.created_at);
    if (!m) return;
    if (!gamesByMonth[m]) gamesByMonth[m] = { total: 0, finished: 0, active: 0, abandoned: 0 };
    gamesByMonth[m].total++;
    if (g.state === 3) gamesByMonth[m].finished++;
    else if (g.state === 2) gamesByMonth[m].active++;
    else gamesByMonth[m].abandoned++;
  });

  // Shots stats by month
  const shotsByMonth = {};
  data['shots'].forEach(s => {
    const m = getMonth(s.created_at);
    if (!m) return;
    if (!shotsByMonth[m]) shotsByMonth[m] = { total: 0, hits: 0, misses: 0 };
    shotsByMonth[m].total++;
    if (s.is_hit === true) shotsByMonth[m].hits++;
    else if (s.is_hit === false) shotsByMonth[m].misses++;
  });

  // Transactions / Claims breakdown by month
  const txByMonth = {};
  const addTx = (m, type, amount = 0) => {
    if (!m) return;
    if (!txByMonth[m]) {
      txByMonth[m] = {
        usdc_count: 0, usdc_revenue: 0,
        point_tx_count: 0, points_spent: 0,
        fleet_claims: 0, sbt_claims: 0, easter_egg_claims: 0, quest_claims: 0,
        social_share_rewards: 0, referrals: 0
      };
    }
    if (type === 'usdc') {
      txByMonth[m].usdc_count++;
      txByMonth[m].usdc_revenue += amount;
    } else if (type === 'points') {
      txByMonth[m].point_tx_count++;
      txByMonth[m].points_spent += amount;
    } else if (type === 'fleet') {
      txByMonth[m].fleet_claims++;
    } else if (type === 'sbt') {
      txByMonth[m].sbt_claims++;
    } else if (type === 'easter') {
      txByMonth[m].easter_egg_claims++;
    } else if (type === 'quest') {
      txByMonth[m].quest_claims++;
    } else if (type === 'social') {
      txByMonth[m].social_share_rewards++;
    } else if (type === 'referral') {
      txByMonth[m].referrals++;
    }
  };

  data['shop_usdc_purchases'].forEach(p => {
    const m = getMonth(p.created_at || p.purchased_at);
    const amt = parseFloat(p.amount_usdc || p.usdc_amount || p.amount || 0);
    addTx(m, 'usdc', amt);
  });

  data['shop_weekly_point_purchases'].forEach(p => {
    const m = getMonth(p.created_at || p.purchased_at);
    const pts = parseInt(p.points_spent || p.points || 0);
    addTx(m, 'points', pts);
  });

  data['fleet_nft_point_claims'].forEach(c => {
    addTx(getMonth(c.claimed_at || c.created_at), 'fleet');
  });

  data['limited_sbt_claims'].forEach(c => {
    addTx(getMonth(c.claimed_at || c.created_at), 'sbt');
  });

  data['easter_egg_claims'].forEach(c => {
    addTx(getMonth(c.claimed_at || c.created_at), 'easter');
  });

  data['external_quest_claims'].forEach(c => {
    addTx(getMonth(c.claimed_at || c.created_at), 'quest');
  });

  data['social_share_rewards'].forEach(s => {
    addTx(getMonth(s.created_at || s.claimed_at), 'social');
  });

  data['referrals'].forEach(r => {
    addTx(getMonth(r.created_at), 'referral');
  });

  // Sorted list of all months
  const allMonthsSet = new Set([
    ...Object.keys(gamesByMonth),
    ...Object.keys(monthlyActive),
    ...Object.keys(newPlayersByMonth),
    ...Object.keys(txByMonth),
    ...Object.keys(shotsByMonth)
  ]);
  const sortedMonths = Array.from(allMonthsSet).filter(m => m && m.length === 7).sort();

  console.log("\n========================================================");
  console.log(" FULL GAME STATISTICAL REPORT (BY MONTH)");
  console.log("========================================================\n");

  let cumulativePlayers = 0;
  let prevMAU = null;

  const monthlyReport = sortedMonths.map(m => {
    const newWallets = newPlayersByMonth[m] || 0;
    cumulativePlayers += newWallets;
    const mau = monthlyActive[m] ? monthlyActive[m].size : 0;
    
    let mauGrowthPct = "0.0%";
    let mauDiff = 0;
    if (prevMAU !== null && prevMAU > 0) {
      mauDiff = mau - prevMAU;
      mauGrowthPct = ((mauDiff / prevMAU) * 100).toFixed(1) + "%";
    } else if (prevMAU === 0 && mau > 0) {
      mauGrowthPct = "+100%";
    } else if (prevMAU === null) {
      mauGrowthPct = "Baseline";
    }
    prevMAU = mau;

    const gData = gamesByMonth[m] || { total: 0, finished: 0, active: 0, abandoned: 0 };
    const sData = shotsByMonth[m] || { total: 0, hits: 0, misses: 0 };
    const txData = txByMonth[m] || {
      usdc_count: 0, usdc_revenue: 0, point_tx_count: 0, points_spent: 0,
      fleet_claims: 0, sbt_claims: 0, easter_egg_claims: 0, quest_claims: 0,
      social_share_rewards: 0, referrals: 0
    };

    return {
      month: m,
      newPlayers: newWallets,
      cumulativePlayers,
      mau,
      mauChange: mauDiff >= 0 ? `+${mauDiff}` : `${mauDiff}`,
      mauGrowthPct,
      totalGames: gData.total,
      finishedGames: gData.finished,
      activeGames: gData.active,
      abandonedGames: gData.abandoned,
      totalShots: sData.total,
      shotHits: sData.hits,
      shotMisses: sData.misses,
      usdcTxCount: txData.usdc_count,
      usdcRevenue: `$${txData.usdc_revenue.toFixed(2)}`,
      pointTxCount: txData.point_tx_count,
      pointsSpent: txData.points_spent,
      fleetNftClaims: txData.fleet_claims,
      questClaims: txData.quest_claims,
      socialShareRewards: txData.social_share_rewards,
      easterEggClaims: txData.easter_egg_claims,
      referrals: txData.referrals,
      totalActivityEvents: monthlyEventsCount[m] || 0
    };
  });

  console.log(JSON.stringify(monthlyReport, null, 2));

  // Season progress aggregated totals
  const totalSeasonPoints = data['season_progress'].reduce((acc, r) => acc + (parseInt(r.points || 0)), 0);
  const avgSeasonPoints = data['season_progress'].length > 0 ? (totalSeasonPoints / data['season_progress'].length).toFixed(1) : 0;

  // Player stats aggregates
  const totalGamesPlayedInStats = data['player_stats'].reduce((acc, r) => acc + (parseInt(r.games_played || 0)), 0);
  const totalWinsInStats = data['player_stats'].reduce((acc, r) => acc + (parseInt(r.wins || 0)), 0);
  const totalCheckinsInStats = data['player_stats'].reduce((acc, r) => acc + (parseInt(r.total_checkins || 0)), 0);

  console.log("\n========================================================");
  console.log(" OVERALL METRICS & SYSTEM TOTALS");
  console.log("========================================================");
  console.log(`Total Registered / Tracked Unique Wallets (All Time): ${Object.keys(firstSeen).length}`);
  console.log(`Total Games Created (games table): ${data['games'].length}`);
  console.log(`Total Shots Fired (shots table): ${data['shots'].length}`);
  console.log(`Total Resolved / Finished Games: ${data['resolved_games'].length}`);
  console.log(`Total Player Stats Records: ${data['player_stats'].length}`);
  console.log(`Total Season Progress Participants: ${data['season_progress'].length}`);
  console.log(`Total Season Points Earned: ${totalSeasonPoints} (Avg per player: ${avgSeasonPoints})`);
  console.log(`Total Daily Check-ins Completed: ${totalCheckinsInStats}`);
  console.log(`Total Fleet NFT Claims: ${data['fleet_nft_point_claims'].length}`);
  console.log(`Total External Quest Claims: ${data['external_quest_claims'].length}`);
  console.log(`Total Social Share Rewards: ${data['social_share_rewards'].length}`);
  console.log(`Total Items Owned / Purchased: ${data['player_items'].length}`);
  console.log(`Total Boosters Active / Owned: ${data['player_boosters'].length}`);
  console.log(`Total Referrals Generated: ${data['referrals'].length}`);
  console.log(`Total Creator Submissions: ${data['creator_submissions'].length}`);
  console.log(`Total Creator Rewards Distributed: ${data['creator_rewards'].length}`);
}

main().catch(console.error);
