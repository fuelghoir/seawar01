require("dotenv").config({ path: ".env.local" });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Adding bp_season_key...");
  const { error: err1 } = await supabase.rpc('run_sql', {
    query: 'ALTER TABLE public.season_config ADD COLUMN IF NOT EXISTS bp_season_key text DEFAULT \'S1\';'
  });
  if (err1) console.error('Error 1:', err1.message);

  console.log("Resetting S2 points to 0...");
  const { error: err2 } = await supabase.rpc('run_sql', {
    query: 'UPDATE public.season_progress SET points = 0 WHERE season_key = \'S2\';'
  });
  if (err2) console.error('Error 2:', err2.message);

  console.log("Done.");
}
run();
