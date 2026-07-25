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
  console.log("=== CALCULATING PER-PLAYER USDC SPENT & DONATION STATS ===");

  const usdcPurchases = await fetchAll('shop_usdc_purchases');
  const fleetClaims = await fetchAll('fleet_nft_point_claims');
  const playerStats = await fetchAll('player_stats');

  // Map purchases per wallet
  const walletDonations = {};

  usdcPurchases.forEach(p => {
    if (!p.wallet) return;
    const w = p.wallet.toLowerCase();
    if (!walletDonations[w]) {
      walletDonations[w] = { usdcShop: 0, fleetClaimsCount: 0, nftEstimatedUsdc: 0, firstDate: p.created_at, lastDate: p.created_at };
    }
    const amt = (p.amount_usdc_micro || 0) / 1_000_000;
    walletDonations[w].usdcShop += amt;
  });

  fleetClaims.forEach(c => {
    if (!c.wallet) return;
    const w = c.wallet.toLowerCase();
    if (!walletDonations[w]) {
      walletDonations[w] = { usdcShop: 0, fleetClaimsCount: 0, nftEstimatedUsdc: 0, firstDate: c.created_at || c.claimed_at, lastDate: c.created_at || c.claimed_at };
    }
    walletDonations[w].fleetClaimsCount++;
    const dt = c.created_at || c.claimed_at;
    if (dt && (!walletDonations[w].firstDate || dt < walletDonations[w].firstDate)) walletDonations[w].firstDate = dt;
    if (dt && (!walletDonations[w].lastDate || dt > walletDonations[w].lastDate)) walletDonations[w].lastDate = dt;
  });

  // Calculate NFT estimated spend per player
  // Standard pricing: $0.50 per miner buy, +$4.00 for full upgrades. If they claim > 50 times, they maxed miner!
  Object.keys(walletDonations).forEach(w => {
    const claims = walletDonations[w].fleetClaimsCount;
    if (claims > 0) {
      if (claims >= 50) {
        // Maxed miner holder
        walletDonations[w].nftEstimatedUsdc = 4.50 * Math.ceil(claims / 50);
      } else {
        walletDonations[w].nftEstimatedUsdc = 0.50 + Math.floor(claims / 10) * 0.50;
      }
    }
  });

  console.log("\n--- WALLETS WITH DONATIONS / PURCHASES ---");
  Object.entries(walletDonations).forEach(([w, stats]) => {
    const totalUsdc = stats.usdcShop + stats.nftEstimatedUsdc;
    console.log(`Wallet: ${w}`);
    console.log(`  Shop USDC Purchases: $${stats.usdcShop.toFixed(2)}`);
    console.log(`  NFT Fleet Claims: ${stats.fleetClaimsCount} claims`);
    console.log(`  Estimated NFT USDC Spent: $${stats.nftEstimatedUsdc.toFixed(2)}`);
    console.log(`  TOTAL USDC SPENT: $${totalUsdc.toFixed(2)}`);
  });
}

main().catch(console.error);
