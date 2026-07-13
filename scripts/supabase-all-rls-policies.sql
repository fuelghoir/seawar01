-- Robust Database RLS Policies Migration
-- Dynamically checks if each table exists before enabling RLS and creating policies.
-- Run this in the Supabase SQL Editor.

DO $$
DECLARE
  t_name text;
  -- Read-only tables: public read enabled, client writes blocked.
  readonly_tables text[] := array[
    'player_stats',
    'referrals',
    'player_items',
    'player_boosters',
    'season_progress',
    'shop_weekly_point_purchases',
    'shop_usdc_purchases',
    'social_connections',
    'social_share_rewards',
    'creator_submissions',
    'creator_rewards',
    'wallet_activity',
    'drop_campaigns',
    'drop_allocations',
    'external_quest_campaigns',
    'external_quest_participations',
    'external_quest_claims'
  ];
  -- Play / Interaction tables: public read, insert and update allowed.
  interaction_tables text[] := array[
    'games',
    'shots',
    'sunk_reports',
    'game_reactions',
    'user_quests',
    'user_quest_rerolls',
    'push_subscriptions'
  ];
BEGIN
  -- 1. Process Read-Only Tables
  FOREACH t_name IN ARRAY readonly_tables LOOP
    IF to_regclass(format('public.%I', t_name)) IS NOT NULL THEN
      -- Enable RLS
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t_name);
      
      -- Create SELECT policy
      EXECUTE format('DROP POLICY IF EXISTS select_%I ON public.%I', t_name, t_name);
      EXECUTE format('CREATE POLICY select_%I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t_name, t_name);
    END IF;
  END LOOP;

  -- 2. Process Play / Interaction Tables
  FOREACH t_name IN ARRAY interaction_tables LOOP
    IF to_regclass(format('public.%I', t_name)) IS NOT NULL THEN
      -- Enable RLS
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t_name);
      
      -- Create SELECT policy
      EXECUTE format('DROP POLICY IF EXISTS select_%I ON public.%I', t_name, t_name);
      EXECUTE format('CREATE POLICY select_%I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t_name, t_name);
      
      -- Create INSERT policy
      EXECUTE format('DROP POLICY IF EXISTS insert_%I ON public.%I', t_name, t_name);
      EXECUTE format('CREATE POLICY insert_%I ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)', t_name, t_name);
      
      -- Create UPDATE policy (if not sunk_reports which shouldn't be updated by players)
      IF t_name NOT IN ('sunk_reports') THEN
        EXECUTE format('DROP POLICY IF EXISTS update_%I ON public.%I', t_name, t_name);
        EXECUTE format('CREATE POLICY update_%I ON public.%I FOR UPDATE TO anon, authenticated USING (true)', t_name, t_name);
      END IF;
    END IF;
  END LOOP;

  -- 3. Custom additional constraints for specific tables if they exist
  
  -- referrals: add insert check to prevent self-referrals
  IF to_regclass('public.referrals') IS NOT NULL THEN
    DROP POLICY IF EXISTS insert_referrals ON referrals;
    CREATE POLICY insert_referrals ON referrals 
      FOR INSERT TO anon, authenticated WITH CHECK (lower(referrer) <> lower(referee));
  END IF;

END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
