-- One-off external app quests.
-- Run this in Supabase SQL Editor before enabling the Turbo Gum quest in prod.

create table if not exists external_quest_claims (
  wallet text not null,
  quest_key text not null,
  points integer not null,
  target_url text not null,
  claimed_at timestamptz not null default now(),
  primary key (wallet, quest_key),
  constraint external_quest_claims_points_positive check (points > 0)
);

create index if not exists idx_external_quest_claims_wallet
  on external_quest_claims(wallet);

create or replace function claim_turbo_gum_quest(
  p_wallet text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_quest_key text := 'turbo-gum-2026-05';
  v_points integer := 1000;
  v_target_url text := 'https://turbo-gum.xyz?ref=TDU0CGYP';
  v_starts_at timestamptz := timestamptz '2026-05-24 00:00:00+00';
  v_ends_at timestamptz := timestamptz '2026-06-03 00:00:00+00';
  did_insert boolean := false;
begin
  if v_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Invalid wallet';
  end if;

  if now() < v_starts_at or now() >= v_ends_at then
    raise exception 'Quest expired';
  end if;

  insert into external_quest_claims (
    wallet,
    quest_key,
    points,
    target_url,
    claimed_at
  ) values (
    v_wallet,
    v_quest_key,
    v_points,
    v_target_url,
    now()
  )
  on conflict (wallet, quest_key) do nothing
  returning true into did_insert;

  if coalesce(did_insert, false) then
    insert into player_stats (wallet, points, updated_at)
    values (v_wallet, v_points, now())
    on conflict (wallet) do update
      set points = player_stats.points + excluded.points,
          updated_at = now();
  end if;

  return coalesce(did_insert, false);
end;
$$;

select pg_notify('pgrst', 'reload schema');
