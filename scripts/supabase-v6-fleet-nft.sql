-- V6 Fleet NFT passive points.
-- Run in Supabase SQL Editor before enabling NFT point claims.

create table if not exists fleet_nft_point_claims (
  tx_hash text primary key,
  wallet text not null,
  token_id bigint not null,
  points bigint not null,
  created_at timestamptz not null default now(),
  constraint fleet_nft_point_claims_positive check (points > 0)
);

create index if not exists idx_fleet_nft_point_claims_wallet
  on fleet_nft_point_claims(wallet, created_at desc);

create or replace function grant_fleet_nft_points(
  p_wallet text,
  p_tx_hash text,
  p_token_id bigint,
  p_points bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  did_grant boolean := false;
begin
  p_wallet := lower(p_wallet);
  p_tx_hash := lower(p_tx_hash);

  if p_points <= 0 then
    raise exception 'Points must be positive';
  end if;

  insert into fleet_nft_point_claims (tx_hash, wallet, token_id, points)
  values (p_tx_hash, p_wallet, p_token_id, p_points)
  on conflict (tx_hash) do nothing
  returning true into did_grant;

  if coalesce(did_grant, false) then
    insert into player_stats (wallet, points, updated_at)
    values (p_wallet, p_points::integer, now())
    on conflict (wallet) do update
      set points = player_stats.points + excluded.points,
          updated_at = now();
    return p_points;
  end if;

  return 0;
end;
$$;

select pg_notify('pgrst', 'reload schema');
