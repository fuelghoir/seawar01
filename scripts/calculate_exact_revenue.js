const { createClient } = require('@supabase/supabase-js');
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
  const usdcPurchases = await fetchAll('shop_usdc_purchases');
  const fleetClaims = await fetchAll('fleet_nft_point_claims');
  const playerStats = await fetchAll('player_stats');

  console.log("=== REVENUE & FINANCIAL BREAKDOWN ===");
  
  let totalUsdcDb = 0;
  usdcPurchases.forEach(p => {
    totalUsdcDb += (p.amount_usdc_micro || 0) / 1_000_000;
  });

  console.log(`1. Direct Shop USDC Purchases in DB: $${totalUsdcDb.toFixed(2)} USDC`);

  // Count maxed miners and owned fleet passes from player_stats / fleet_nft_point_claims
  const fleetWallets = new Set(fleetClaims.map(c => c.wallet.toLowerCase()));
  console.log(`2. Unique Wallets with Fleet NFT Miners: ${fleetWallets.size}`);
  console.log(`3. Total Fleet NFT Claim Transactions: ${fleetClaims.length}`);

  // Calculate Fleet Pass NFT revenue estimation
  // Base App / Web price: Tier 1 L1 = $0.25 - $0.50 USDC. Full 9-level upgrade = ~$4.50 - $9.00 USDC.
  // 10 maxed miners per active fleet player.
  const maxedPlayers = playerStats.filter(p => (p.points || 0) >= 100000).length;
  console.log(`4. Players with >100k points (Likely upgraded Fleet NFT): ${maxedPlayers}`);
}

main().catch(console.error);
