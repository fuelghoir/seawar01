const fs = require('fs');
const dotenv = require('dotenv');

// Parse .env.local manually since the dotenv package wasn't found globally in the previous attempt
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

async function fixSeason() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/season_config?id=eq.default`, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ season_key: "S1" })
    });
    
    if (!res.ok) {
      const err = await res.text();
      console.error("Failed:", res.status, err);
    } else {
      console.log("Success! Reverted season_key to S1");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

fixSeason();
