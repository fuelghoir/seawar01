const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
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
  const games = await fetchAll('games');
  const shots = await fetchAll('shots');
  const playerStats = await fetchAll('player_stats');
  const fleetClaims = await fetchAll('fleet_nft_point_claims');
  const usdcPurchases = await fetchAll('shop_usdc_purchases');

  // Generate clean Leaderboard CSV
  let csvLeaderboard = "Rank,Wallet,Points,Wins,Games_Played,Win_Rate_Pct,Checkin_Streak\n";
  const sortedStats = [...playerStats].sort((a, b) => (b.points || 0) - (a.points || 0));
  
  sortedStats.forEach((p, idx) => {
    const wr = p.games_played > 0 ? (((p.wins || 0) / p.games_played) * 100).toFixed(1) : "0.0";
    csvLeaderboard += `${idx + 1},${p.wallet},${p.points || 0},${p.wins || 0},${p.games_played || 0},${wr},${p.checkin_streak || 0}\n`;
  });

  const csvPath = path.join('d:/seawar01', 'Sea_Battle_Leaderboard.csv');
  fs.writeFileSync(csvPath, csvLeaderboard, 'utf8');
  console.log(`Saved clean CSV to ${csvPath}`);
}

main().catch(console.error);
