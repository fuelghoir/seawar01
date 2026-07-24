const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== DETAILED BREAKDOWN OF JULY 2026 (2026-07) ACTIVE PLAYERS ===");

  // 1. Unique wallets in games in July 2026
  const { data: games } = await supabase
    .from('games')
    .select('player1, player2, created_at')
    .gte('created_at', '2026-07-01T00:00:00Z');

  const gameWallets = new Set();
  games.forEach(g => {
    if (g.player1) gameWallets.add(g.player1.toLowerCase());
    if (g.player2) gameWallets.add(g.player2.toLowerCase());
  });

  console.log(`Wallets active in GAMES in July 2026: ${gameWallets.size}`);

  // 2. Unique wallets in Fleet NFT Claims in July 2026
  const { data: fleetClaims } = await supabase
    .from('fleet_nft_point_claims')
    .select('wallet, created_at')
    .gte('created_at', '2026-07-01T00:00:00Z');

  const fleetWallets = new Set();
  (fleetClaims || []).forEach(c => {
    if (c.wallet) fleetWallets.add(c.wallet.toLowerCase());
  });
  console.log(`Wallets claiming Fleet NFT points in July 2026: ${fleetWallets.size}`);

  // 3. Unique wallets in Social Share Rewards in July 2026
  const { data: socialRewards } = await supabase
    .from('social_share_rewards')
    .select('wallet, created_at')
    .gte('created_at', '2026-07-01T00:00:00Z');

  const socialWallets = new Set();
  (socialRewards || []).forEach(s => {
    if (s.wallet) socialWallets.add(s.wallet.toLowerCase());
  });
  console.log(`Wallets receiving Social Share Rewards in July 2026: ${socialWallets.size}`);

  // 4. Unique wallets in season_progress updated in July 2026
  const { data: seasonProgress } = await supabase
    .from('season_progress')
    .select('wallet, updated_at')
    .gte('updated_at', '2026-07-01T00:00:00Z');

  const seasonWallets = new Set();
  (seasonProgress || []).forEach(sp => {
    if (sp.wallet) seasonWallets.add(sp.wallet.toLowerCase());
  });
  console.log(`Wallets with updated Season Progress in July 2026: ${seasonWallets.size}`);

  // Combined total unique wallets across all July events
  const totalJulyActive = new Set([
    ...gameWallets,
    ...fleetWallets,
    ...socialWallets,
    ...seasonWallets
  ]);

  console.log(`Total COMBINED Unique Active Wallets (MAU) in July 2026: ${totalJulyActive.size}`);

  // Check top active wallets (game count per wallet in July)
  const walletGameCounts = {};
  games.forEach(g => {
    [g.player1, g.player2].forEach(w => {
      if (!w) return;
      const lw = w.toLowerCase();
      walletGameCounts[lw] = (walletGameCounts[lw] || 0) + 1;
    });
  });

  const sortedWallets = Object.entries(walletGameCounts).sort((a, b) => b[1] - a[1]);
  console.log("\nTop 15 most active player wallets in games in July 2026:");
  sortedWallets.slice(0, 15).forEach(([w, count]) => {
    console.log(`- ${w}: ${count} games`);
  });
}

main().catch(console.error);
