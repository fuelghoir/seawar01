const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== CHECKING FINANCIAL & REVENUE DATA ===");

  // 1. shop_usdc_purchases
  const { data: usdcPurchases, error: usdcErr } = await supabase
    .from('shop_usdc_purchases')
    .select('*');
  
  console.log("1. shop_usdc_purchases rows:", usdcPurchases);

  // 2. games with wager_amount > 0
  const { data: wagerGames, error: wagerErr } = await supabase
    .from('games')
    .select('id, wager_amount, game_mode, player1, player2, winner, created_at')
    .not('wager_amount', 'is', null);

  console.log("2. Wager games count:", wagerGames ? wagerGames.length : 0);
  if (wagerGames && wagerGames.length > 0) {
    console.log("Sample wager games:", wagerGames.slice(0, 10));
    let totalWagerVolume = 0;
    wagerGames.forEach(g => {
      totalWagerVolume += parseFloat(g.wager_amount || 0);
    });
    console.log(`Total Wager Volume (recorded in games DB): ${totalWagerVolume}`);
  }

  // 3. Check all other tables for financial/token values
  const { data: seasonConfig } = await supabase.from('season_config').select('*');
  console.log("3. season_config:", seasonConfig);

  const { data: shopWeeklyPoints } = await supabase.from('shop_weekly_point_purchases').select('*');
  console.log("4. shop_weekly_point_purchases:", shopWeeklyPoints);

  const { data: creatorRewards } = await supabase.from('creator_rewards').select('*');
  console.log("5. creator_rewards count:", creatorRewards ? creatorRewards.length : 0);
  if (creatorRewards && creatorRewards.length > 0) {
    console.log("Sample creator rewards:", creatorRewards.slice(0, 5));
  }
}

main().catch(console.error);
