require('dotenv').config({path:'.env'});
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await s.rpc('exec_sql', { query: "SELECT prosrc FROM pg_proc WHERE proname = 'resolve_offchain_game_stats'" });
  console.log(data, error);
}
check();
