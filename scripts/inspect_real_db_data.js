const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== INSPECTING REAL LEADERBOARD & REVENUE ===");

  // 1. REAL TOP PLAYERS FROM player_stats
  const { data: realStats, error: statsErr } = await supabase
    .from('player_stats')
    .select('*')
    .order('points', { ascending: false })
    .limit(30);

  if (statsErr) console.error("Error fetching player_stats:", statsErr);

  console.log("\n--- REAL TOP 15 PLAYERS IN DB ---");
  realStats.slice(0, 15).forEach((p, i) => {
    console.log(`${i + 1}. Wallet: ${p.wallet} | Points: ${p.points} | Wins: ${p.wins} | Games: ${p.games_played} | Streak: ${p.checkin_streak}`);
  });

  // 2. REAL USDC PURCHASES
  const { data: usdcPurchases, error: usdcErr } = await supabase
    .from('shop_usdc_purchases')
    .select('*');

  if (usdcErr) console.error("Error fetching shop_usdc_purchases:", usdcErr);

  console.log("\n--- REAL USDC PURCHASES IN DB ---");
  console.log(`Total USDC Purchase Rows: ${usdcPurchases ? usdcPurchases.length : 0}`);
  if (usdcPurchases) {
    usdcPurchases.forEach(p => {
      console.log(`- Wallet: ${p.wallet} | Item: ${p.item_slug} | USDC Micro: ${p.amount_usdc_micro} ($${(p.amount_usdc_micro || 0)/1e6}) | Date: ${p.created_at || p.purchased_at}`);
    });
  }

  // 3. CHECK ALL OTHER PURCHASES / TRANSACTIONS / ITEMS
  const { data: playerItems } = await supabase.from('player_items').select('*');
  console.log(`\nTotal Player Items rows: ${playerItems ? playerItems.length : 0}`);

  const itemCounts = {};
  playerItems.forEach(i => {
    itemCounts[i.item_slug] = (itemCounts[i.item_slug] || 0) + (i.quantity || 0);
  });
  console.log("Items breakdown in inventory:", itemCounts);
}

main().catch(console.error);
