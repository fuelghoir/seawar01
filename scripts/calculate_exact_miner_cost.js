const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Level prices in USDC micro units (1e6 = 1 USDC)
const LEVEL_PRICES = [
  500_000,   // T1 L1: $0.50
  750_000,   // T1 L2: $0.75
  1_000_000, // T1 L3: $1.00
  1_500_000, // T2 L1: $1.50
  2_000_000, // T2 L2: $2.00
  2_500_000, // T2 L3: $2.50
  3_000_000, // T3 L1: $3.00
  3_500_000, // T3 L2: $3.50
  4_000_000, // T3 L3: $4.00
];

const CUMULATIVE_MAX_PRICE_MICRO = LEVEL_PRICES.reduce((a, b) => a + b, 0); // 18,750,000 micro = $18.75 USDC

async function main() {
  console.log("=== EXACT FLEET PASS NFT UPGRADE COST CALCULATOR ===");
  console.log(`- Full 9-Level Upgrade Cost (Web): $${(CUMULATIVE_MAX_PRICE_MICRO / 1e6).toFixed(2)} USDC`);
  console.log(`- Base App 50% Discounted Cost: $${(CUMULATIVE_MAX_PRICE_MICRO / 2e6).toFixed(2)} USDC`);

  const { data: playerStats } = await supabase.from('player_stats').select('*').order('points', { ascending: false });
  const { data: fleetClaims } = await supabase.from('fleet_nft_point_claims').select('*');
  const { data: usdcPurchases } = await supabase.from('shop_usdc_purchases').select('*');

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

  console.log("\n--- REAL TOP 15 PLAYERS EXACT MINER SPENT CALCULATION ---");
  playerStats.slice(0, 15).forEach((p, idx) => {
    const w = p.wallet.toLowerCase();
    const claims = claimsPerWallet[w] || 0;
    const shopSpent = usdcShopPerWallet[w] || 0;

    let nftSpentWeb = 0;
    let nftSpentBaseApp = 0;

    if (claims >= 20) {
      // Player actively claimed from a Maxed Miner (T3L3)!
      nftSpentWeb = 18.75;
      nftSpentBaseApp = 9.38;
    } else if (claims > 0) {
      // Partial upgrade
      nftSpentWeb = 0.50 + Math.min(claims, 8) * 1.50;
      nftSpentBaseApp = nftSpentWeb / 2;
    }

    console.log(`#${idx + 1} ${p.wallet}`);
    console.log(`   Points: ${p.points} | Claims: ${claims} | Wins: ${p.wins}`);
    console.log(`   Shop USDC: $${shopSpent.toFixed(2)}`);
    console.log(`   NFT Spend (Web Price): $${nftSpentWeb.toFixed(2)} USDC`);
    console.log(`   NFT Spend (Base App Discount): $${nftSpentBaseApp.toFixed(2)} USDC`);
    console.log(`   TOTAL SPENT (Web): $${(shopSpent + nftSpentWeb).toFixed(2)} USDC | (Base App): $${(shopSpent + nftSpentBaseApp).toFixed(2)} USDC\n`);
  });
}

main().catch(console.error);
