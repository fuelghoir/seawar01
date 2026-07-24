require('dotenv').config({path:'.env'});
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: s2Data } = await s.from('season_progress').select('*').eq('season_key', 'S2').gt('xp', 0);
  if (!s2Data || s2Data.length === 0) return console.log('No S2 XP found');

  for (const row of s2Data) {
    console.log(`Transferring ${row.xp} XP for ${row.wallet} from S2 to S1`);
    
    // Get current S1 XP
    const { data: s1Data } = await s.from('season_progress').select('*').eq('wallet', row.wallet).eq('season_key', 'S1').maybeSingle();
    const currentS1Xp = s1Data ? s1Data.xp : 0;
    
    // Add S2 XP to S1 XP
    await s.from('season_progress').upsert({
      wallet: row.wallet,
      season_key: 'S1',
      xp: currentS1Xp + row.xp,
      updated_at: new Date().toISOString()
    }, { onConflict: 'wallet, season_key' });
    
    // Reset S2 XP to 0
    await s.from('season_progress').update({ xp: 0 }).eq('wallet', row.wallet).eq('season_key', 'S2');
  }
  console.log('Done');
}
run();
