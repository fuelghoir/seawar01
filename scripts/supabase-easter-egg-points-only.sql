-- Retire USDC prizes from the homepage Easter Egg while preserving points claims.
begin;

update easter_egg_claims
set usd_eligible = false,
    updated_at = now()
where usd_eligible = true;

update creator_rewards
set status = 'cancelled',
    updated_at = now()
where reward_kind = 'usdc'
  and reward_label = 'Easter Egg Grand Prize'
  and status in ('planned', 'claimable');

commit;

notify pgrst, 'reload schema';
