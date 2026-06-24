-- Emergency compatibility rollback for the legacy browser Supabase client.
-- Run once in Supabase Dashboard -> SQL Editor.
-- This intentionally restores the old public game-data access model.

do $$
declare
  table_name text;
  legacy_tables text[] := array[
    'games',
    'shots',
    'player_stats',
    'sunk_reports',
    'referrals',
    'user_quests',
    'user_quest_rerolls',
    'player_items',
    'player_boosters',
    'season_progress',
    'shop_weekly_point_purchases',
    'shop_usdc_purchases',
    'game_reactions',
    'push_subscriptions'
  ];
begin
  foreach table_name in array legacy_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I disable row level security', table_name);
      execute format(
        'grant select, insert, update, delete on table public.%I to anon, authenticated',
        table_name
      );
    end if;
  end loop;
end;
$$;

grant usage, select on all sequences in schema public to anon, authenticated;

-- Keep the RPC calls used by the current client callable.
grant execute on function public.award_referral_first_game_bonus(text) to anon, authenticated;
grant execute on function public.sync_referral_first_game_bonuses(text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
