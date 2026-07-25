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
  const games = await fetchAll('games');
  const finished = games.filter(g => g.state === 'finished' || g.winner);
  
  const stats = await fetchAll('player_stats');
  let totalWins = 0;
  let totalGamesPlayed = 0;
  let playersWith100Wins = 0;

  stats.forEach(s => {
    totalWins += (s.wins || 0);
    totalGamesPlayed += (s.games_played || 0);
    if ((s.wins || 0) >= 100) playersWith100Wins++;
  });

  const { count: resolvedCount } = await supabase.from('resolved_games').select('*', { count: 'exact', head: true });

  console.log("=== FULL UNTRUNCATED GAME & WIN STATS ===");
  console.log(`- Total Games in DB: ${games.length}`);
  console.log(`- Total Finished Games in 'games' table: ${finished.length}`);
  console.log(`- Total Resolved Log Events in 'resolved_games': ${resolvedCount}`);
  console.log(`- Total Sum of Player Wins in 'player_stats': ${totalWins}`);
  console.log(`- Total Sum of Games Played by Players: ${totalGamesPlayed}`);
  console.log(`- Players with >= 100 Wins: ${playersWith100Wins}`);
}

main().catch(console.error);
