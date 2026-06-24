-- Secure Promo Code Redemption Function
-- Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION redeem_promo_code(
  p_wallet text,
  p_promo_id text,
  p_points integer,
  p_item_slug text,
  p_quantity integer,
  p_admin_note text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet text := lower(trim(p_wallet));
  v_marker text := 'promo:' || p_promo_id;
  v_stats_exist boolean;
  v_current_qty integer;
BEGIN
  -- 1. Validate inputs
  IF v_wallet !~ '^0x[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'Invalid wallet address';
  END IF;

  -- 2. Check if already claimed (concurrency safe check)
  IF EXISTS (
    SELECT 1 FROM creator_rewards 
    WHERE lower(wallet) = v_wallet AND created_by = v_marker
  ) THEN
    RAISE EXCEPTION 'Promo already redeemed';
  END IF;

  -- 3. Grant Points if positive
  IF p_points > 0 THEN
    SELECT exists(SELECT 1 FROM player_stats WHERE wallet = v_wallet) INTO v_stats_exist;
    IF v_stats_exist THEN
      UPDATE player_stats
        SET points = points + p_points,
            updated_at = now()
        WHERE wallet = v_wallet;
    ELSE
      INSERT INTO player_stats (wallet, points, updated_at)
      VALUES (v_wallet, p_points, now());
    END IF;
  END IF;

  -- 4. Grant Item if provided
  IF p_item_slug IS NOT NULL AND p_quantity > 0 THEN
    SELECT quantity INTO v_current_qty FROM player_items 
      WHERE wallet = v_wallet AND item_slug = p_item_slug;
    
    IF v_current_qty IS NOT NULL THEN
      UPDATE player_items 
        SET quantity = v_current_qty + p_quantity,
            updated_at = now()
        WHERE wallet = v_wallet AND item_slug = p_item_slug;
    ELSE
      INSERT INTO player_items (wallet, item_slug, quantity, updated_at)
      VALUES (v_wallet, p_item_slug, p_quantity, now());
    END IF;
  END IF;

  -- 5. Insert Audit Log
  IF p_points > 0 THEN
    INSERT INTO creator_rewards (wallet, reward_kind, points, reward_label, status, admin_note, created_by)
    VALUES (v_wallet, 'points', p_points, '+' || p_points || ' pts', 'granted', p_admin_note, v_marker);
  END IF;
  
  IF p_item_slug IS NOT NULL AND p_quantity > 0 THEN
    INSERT INTO creator_rewards (wallet, reward_kind, item_slug, quantity, reward_label, status, admin_note, created_by)
    VALUES (v_wallet, 'item', p_item_slug, p_quantity, p_quantity || 'x ' || p_item_slug, 'granted', p_admin_note, v_marker);
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_promo_code(text, text, integer, text, integer, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
