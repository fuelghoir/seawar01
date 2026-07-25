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
  console.log("=== RE-CALCULATING EXACT FLEET NFT & SHOP SPENT PER PLAYER ===");

  const playerStats = await fetchAll('player_stats');
  const games = await fetchAll('games');
  const shots = await fetchAll('shots');
  const usdcPurchases = await fetchAll('shop_usdc_purchases');
  const fleetClaims = await fetchAll('fleet_nft_point_claims');
  const questClaims = await fetchAll('external_quest_claims');
  const socialShares = await fetchAll('social_share_rewards');
  const seasonProgress = await fetchAll('season_progress');
  const playerItems = await fetchAll('player_items');
  const playerBoosters = await fetchAll('player_boosters');
  const referrals = await fetchAll('referrals');
  const creatorSubmissions = await fetchAll('creator_submissions');
  const creatorRewards = await fetchAll('creator_rewards');

  // Map purchases per wallet
  const claimsPerWallet = {};
  fleetClaims.forEach(c => {
    if (!c.wallet) return;
    const w = c.wallet.toLowerCase();
    claimsPerWallet[w] = (claimsPerWallet[w] || 0) + 1;
  });

  const usdcShopPerWallet = {};
  usdcPurchases.forEach(p => {
    if (!p.wallet) return;
    const w = p.wallet.toLowerCase();
    usdcShopPerWallet[w] = (usdcShopPerWallet[w] || 0) + ((p.amount_usdc_micro || 0) / 1e6);
  });

  // Enrich player_stats table rows with exact donation & spend columns
  const enrichedLeaderboard = [...playerStats]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .map((p, idx) => {
      const w = p.wallet.toLowerCase();
      const claims = claimsPerWallet[w] || 0;
      const shopSpent = usdcShopPerWallet[w] || 0;

      let nftSpentWeb = 0;
      let nftSpentBaseApp = 0;

      if (claims >= 20) {
        nftSpentWeb = 18.75;
        nftSpentBaseApp = 9.38;
      } else if (claims > 0) {
        nftSpentWeb = 0.50 + Math.min(claims, 8) * 1.50;
        nftSpentBaseApp = nftSpentWeb / 2;
      }

      const totalSpentWeb = shopSpent + nftSpentWeb;
      const totalSpentBaseApp = shopSpent + nftSpentBaseApp;

      return {
        Rank: idx + 1,
        Full_Wallet_Address: p.wallet,
        Total_USDC_Spent_Web: `$${totalSpentWeb.toFixed(2)} USDC`,
        Total_USDC_Spent_BaseApp: `$${totalSpentBaseApp.toFixed(2)} USDC`,
        Shop_USDC_Spent: `$${shopSpent.toFixed(2)} USDC`,
        Fleet_NFT_Spent_Web: `$${nftSpentWeb.toFixed(2)} USDC`,
        Fleet_NFT_Spent_BaseApp: `$${nftSpentBaseApp.toFixed(2)} USDC`,
        Fleet_NFT_Claims_Count: claims,
        Points: p.points || 0,
        Wins: p.wins || 0,
        Games_Played: p.games_played || 0,
        Win_Rate_Pct: p.games_played > 0 ? `${((p.wins / p.games_played) * 100).toFixed(1)}%` : '0%',
        Total_Hits: p.total_hits || 0,
        Checkin_Streak_Days: p.checkin_streak || 0,
        Total_Checkins: p.total_checkins || 0,
        Registered_At: p.created_at || '',
        Last_Active_At: p.updated_at || p.last_checkin || ''
      };
    });

  // Build Workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Players Leaderboard with Per-Player Exact Spend
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(enrichedLeaderboard), 'Players_With_Exact_Donations');

  // Raw DB Tables
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(games), 'All_Games');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shots), 'All_Shots');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(usdcPurchases), 'USDC_Purchases');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fleetClaims), 'Fleet_NFT_Claims');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(questClaims), 'Quest_Claims');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(socialShares), 'Social_Shares');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(seasonProgress), 'Season_Progress');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(playerItems), 'Player_Items');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(playerBoosters), 'Player_Boosters');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(referrals), 'Referrals');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(creatorSubmissions), 'Creator_Submissions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(creatorRewards), 'Creator_Rewards');

  const file1 = path.join('d:/seawar01', 'Sea_Battle_Master_Donations_Database.xlsx');
  const file2 = path.join('d:/seawar01', 'Sea_Battle_Statistics.xlsx');

  XLSX.writeFile(wb, file1);
  console.log(`\n✅ Exact Database Dump saved to:\n${file1}`);

  try {
    XLSX.writeFile(wb, file2);
    console.log(`✅ Exact Statistics saved to:\n${file2}`);
  } catch {
    // Ignore locked file
  }
}

main().catch(err => {
  console.error("Error exporting database dump:", err);
  process.exit(1);
});
