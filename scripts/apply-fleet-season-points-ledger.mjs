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
const attempts = [
  ["run_sql", { query: sql }],
  ["exec_sql", { query: sql }],
  ["exec_sql", { sql }],
];

for (const [functionName, args] of attempts) {
  const { error } = await supabase.rpc(functionName, args);
  if (!error) {
    console.log(`Fleet Season points ledger migration applied via ${functionName}`);
    process.exit(0);
  }
  if (!/schema cache|could not find the function/i.test(error.message)) {
    throw new Error(error.message);
  }
}

throw new Error("No database SQL executor RPC is installed");
