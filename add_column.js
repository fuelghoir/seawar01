require("dotenv").config({ path: ".env.local" });
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('run_sql', {
    query: 'ALTER TABLE public.season_config ADD COLUMN IF NOT EXISTS virtual_pool_usdc numeric DEFAULT 0;'
  });
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Success:', data);
  }
}
run();
