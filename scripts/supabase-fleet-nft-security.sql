-- Lock passive-point crediting to the server after on-chain receipt validation.
begin;

revoke all on function public.grant_fleet_nft_points(text, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.grant_fleet_nft_points(text, text, bigint, bigint)
  to service_role;

alter table public.fleet_nft_point_claims enable row level security;
revoke all on table public.fleet_nft_point_claims from public, anon, authenticated;
grant all on table public.fleet_nft_point_claims to service_role;

commit;

select pg_notify('pgrst', 'reload schema');
