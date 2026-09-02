import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const sql = await readFile(
  new URL("./supabase-fleet-season-points-ledger.sql", import.meta.url),
  "utf8",
);
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await supabase.rpc("run_sql", { query: sql });

if (error) throw new Error(error.message);
console.log("Fleet Season points ledger migration applied");
