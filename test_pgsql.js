require('dotenv').config({path:'.env'});
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  await s.rpc('exec_sql_str', { query: `
    create or replace function test_select_into() returns json as $$
    declare
      v1 text;
      v2 text;
    begin
      create temp table if not exists test_tbl (c1 text, c2 text);
      insert into test_tbl values ('A', 'B');
      select c1, c2 into v1, v2 from test_tbl limit 1;
      return json_build_object('v1', v1, 'v2', v2);
    end;
    $$ language plpgsql;
  ` });
}
check();
