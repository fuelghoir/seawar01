const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: stats } = await supabase.from('player_stats').select('wallet');
  const statsWallets = new Set(stats.map(s => s.wallet.toLowerCase()));

  console.log(`Total rows in player_stats (leaderboard): ${statsWallets.size}`);

  const { data: games } = await supabase.from('games').select('player1, player2');
  const gameWallets = new Set();
  games.forEach(g => {
    if (g.player1) gameWallets.add(g.player1.toLowerCase());
    if (g.player2) gameWallets.add(g.player2.toLowerCase());
  });

  console.log(`Total unique wallets in games table: ${gameWallets.size}`);

  const extraWalletsInGames = Array.from(gameWallets).filter(w => !statsWallets.has(w));
  console.log(`Wallets in games that are NOT in player_stats:`, extraWalletsInGames);
}

main().catch(console.error);
