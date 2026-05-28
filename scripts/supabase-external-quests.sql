-- One-off external app quests.
-- Run this in Supabase SQL Editor before enabling global external quests in prod.

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

create or replace function claim_external_quest(
  p_wallet text,
  p_quest_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_quest_key text := lower(p_quest_key);
  v_points integer;
  v_target_url text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  did_insert boolean := false;
begin
  if v_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Invalid wallet';
  end if;

  select q.points, q.target_url, q.starts_at, q.ends_at
    into v_points, v_target_url, v_starts_at, v_ends_at
  from (values
    (
      'turbo-gum-2026-05'::text,
      1000::integer,
      'https://turbo-gum.xyz?ref=TDU0CGYP'::text,
      timestamptz '2026-05-24 00:00:00+00',
      timestamptz '2026-06-03 00:00:00+00'
    ),
    (
      'gld-pirate-checkin-2026-05'::text,
      1000::integer,
      'https://base.app/app/gldpiratebase.vercel.app/ref/0x7b92e59b2de9368e71843f9894ed63bfeebaaee7'::text,
      timestamptz '2026-05-28 00:00:00+00',
      null::timestamptz
    ),
    (
      'x-follow-0xherm-2026-05'::text,
      2000::integer,
      'twitter://user?screen_name=0xHerm'::text,
      timestamptz '2026-05-28 00:00:00+00',
      null::timestamptz
    ),
    (
      'x-like-repost-2058535046332510539'::text,
      1000::integer,
      'twitter://status?id=2058535046332510539'::text,
      timestamptz '2026-05-28 00:00:00+00',
      null::timestamptz
    ),
    (
      'telegram-subscribe-0xherm-2026-05'::text,
      2000::integer,
      'tg://join?invite=xWV1zyGwNOM1ZTFi'::text,
      timestamptz '2026-05-28 00:00:00+00',
      null::timestamptz
    )
  ) as q(quest_key, points, target_url, starts_at, ends_at)
  where q.quest_key = v_quest_key;

  if v_points is null then
    raise exception 'Unknown quest';
  end if;

  if v_starts_at is not null and now() < v_starts_at then
    raise exception 'Quest is not available yet';
  end if;

  if v_ends_at is not null and now() >= v_ends_at then
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

create or replace function claim_turbo_gum_quest(
  p_wallet text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return claim_external_quest(p_wallet, 'turbo-gum-2026-05');
end;
$$;

select pg_notify('pgrst', 'reload schema');
