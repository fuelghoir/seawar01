const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/seawar01/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const sources = {};

  const addWallet = (w, src) => {
    if (!w) return;
    const lw = w.toLowerCase().trim();
    if (!sources[lw]) sources[lw] = new Set();
    sources[lw].add(src);
  };

  // player_stats
  const { data: ps } = await supabase.from('player_stats').select('wallet');
  (ps || []).forEach(r => addWallet(r.wallet, 'player_stats'));

  // season_progress
  const { data: sp } = await supabase.from('season_progress').select('wallet');
  (sp || []).forEach(r => addWallet(r.wallet, 'season_progress'));

  // games
  const { data: g } = await supabase.from('games').select('player1, player2');
  (g || []).forEach(r => { addWallet(r.player1, 'games'); addWallet(r.player2, 'games'); });

  // shop_usdc_purchases
  const { data: su } = await supabase.from('shop_usdc_purchases').select('wallet');
  (su || []).forEach(r => addWallet(r.wallet, 'shop_usdc_purchases'));

  // fleet_nft_point_claims
  const { data: fn } = await supabase.from('fleet_nft_point_claims').select('wallet');
  (fn || []).forEach(r => addWallet(r.wallet, 'fleet_nft_point_claims'));

  // external_quest_claims
  const { data: eq } = await supabase.from('external_quest_claims').select('wallet');
  (eq || []).forEach(r => addWallet(r.wallet, 'external_quest_claims'));

  // social_connections
  const { data: sc } = await supabase.from('social_connections').select('wallet');
  (sc || []).forEach(r => addWallet(r.wallet, 'social_connections'));

  // social_share_rewards
  const { data: ss } = await supabase.from('social_share_rewards').select('wallet');
  (ss || []).forEach(r => addWallet(r.wallet, 'social_share_rewards'));

  // referrals
  const { data: ref } = await supabase.from('referrals').select('referrer, referee');
  (ref || []).forEach(r => { addWallet(r.referrer, 'referrals_referrer'); addWallet(r.referee, 'referrals_referee'); });

  // creator_submissions & creator_rewards
  const { data: cs } = await supabase.from('creator_submissions').select('wallet');
  (cs || []).forEach(r => addWallet(r.wallet, 'creator_submissions'));
  const { data: cr } = await supabase.from('creator_rewards').select('wallet');
  (cr || []).forEach(r => addWallet(r.wallet, 'creator_rewards'));

  const allWallets = Object.keys(sources);
  console.log(`GRAND TOTAL UNIQUE WALLETS ACROSS ALL DB TABLES: ${allWallets.length}`);
  console.log(`Wallets in player_stats (leaderboard): ${ps.length}`);

  const notInLeaderboard = allWallets.filter(w => !sources[w].has('player_stats'));
  console.log(`\nWallets NOT in player_stats (${notInLeaderboard.length}):`);
  notInLeaderboard.forEach(w => {
    console.log(`- ${w}: found in [${Array.from(sources[w]).join(', ')}]`);
  });
}

main().catch(console.error);
