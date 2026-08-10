-- Admin-managed global quests and server-only atomic claims.

create table if not exists external_quest_claims (
  wallet text not null,
  quest_key text not null,
  points integer not null check (points > 0),
  target_url text not null,
  claimed_at timestamptz not null default now(),
  primary key (wallet, quest_key),
  constraint external_quest_claims_wallet_format
    check (wallet ~ '^0x[0-9a-f]{40}$')
);

create index if not exists idx_external_quest_claims_wallet
  on external_quest_claims(wallet);

create table if not exists external_quest_campaigns (
  quest_key text primary key,
  kind text not null check (kind in ('baseApp', 'twitter', 'telegram')),
  target_url text not null,
  app_url text,
  points integer not null check (points > 0 and points <= 1000000),
  title_en text not null,
  title_ru text not null,
  subtitle_en text not null default '',
  subtitle_ru text not null default '',
  action_en text not null default 'Open',
  action_ru text not null default 'Открыть',
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep the existing quests available when the registry table is introduced.
insert into external_quest_campaigns (
  quest_key, kind, target_url, app_url, points,
  title_en, title_ru, subtitle_en, subtitle_ru, action_en, action_ru,
  starts_at, ends_at, enabled
) values
  (
    'turbo-gum-2026-05', 'baseApp',
    'https://turbo-gum.xyz?ref=TDU0CGYP', null, 1000,
    'Turbo Gum Quest', 'Квест Turbo Gum',
    'Open Turbo Gum and make a transaction there.',
    'Открой Turbo Gum и сделай там транзакцию.',
    'Open Turbo Gum', 'Открыть Turbo Gum',
    '2026-05-24 00:00:00+00', '2026-06-03 00:00:00+00', true
  ),
  (
    'gld-pirate-checkin-2026-05', 'baseApp',
    'https://gldpiratebase.vercel.app/ref/0x7b92e59b2de9368e71843f9894ed63bfeebaaee7', null, 1000,
    'GLD Pirate Check-in', 'Чекин в GLD Pirate',
    'Open GLD Pirate and check in.',
    'Открой GLD Pirate и сделай чекин.',
    'Open GLD Pirate', 'Открыть GLD Pirate',
    '2026-05-28 00:00:00+00', null, true
  ),
  (
    'x-follow-0xherm-2026-05', 'twitter',
    'https://x.com/0xHerm', 'twitter://user?screen_name=0xHerm', 2000,
    'Follow 0xHerm on X', 'Подписка на X',
    'Connect X, open the profile and follow @0xHerm.',
    'Подключи X, открой профиль и подпишись на @0xHerm.',
    'Open X', 'Открыть X',
    '2026-05-28 00:00:00+00', null, true
  ),
  (
    'x-like-repost-2058535046332510539', 'twitter',
    'https://x.com/0xHerm/status/2058535046332510539',
    'twitter://status?id=2058535046332510539', 1000,
    'Read the post on X', 'Пост в X',
    'Connect X and open the post.',
    'Подключи X и открой пост.',
    'Open post', 'Открыть пост',
    '2026-05-28 00:00:00+00', null, true
  ),
  (
    'telegram-subscribe-0xherm-2026-05', 'telegram',
    'https://t.me/+xWV1zyGwNOM1ZTFi', 'tg://join?invite=xWV1zyGwNOM1ZTFi', 2000,
    'Join Telegram', 'Подписка на Telegram',
    'Connect Telegram and join the channel.',
    'Подключи Telegram и подпишись на канал.',
    'Open Telegram', 'Открыть Telegram',
    '2026-05-28 00:00:00+00', null, true
  )
on conflict (quest_key) do nothing;

alter table external_quest_campaigns enable row level security;
drop policy if exists select_external_quest_campaigns on external_quest_campaigns;
create policy select_external_quest_campaigns on external_quest_campaigns
  for select to anon, authenticated using (true);
revoke insert, update, delete on external_quest_campaigns from public, anon, authenticated;
grant select, insert, update, delete on external_quest_campaigns to service_role;

alter table external_quest_claims enable row level security;
drop policy if exists select_external_quest_claims on external_quest_claims;
create policy select_external_quest_claims on external_quest_claims
  for select to anon, authenticated using (true);
revoke insert, update, delete on external_quest_claims from public, anon, authenticated;
grant select, insert, update, delete on external_quest_claims to service_role;

create or replace function claim_external_quest(
  p_wallet text,
  p_quest_key text,
  p_is_base_app boolean default false
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
  did_insert boolean := false;
begin
  if v_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Invalid wallet';
  end if;

  select points, target_url into v_points, v_target_url
  from external_quest_campaigns
  where quest_key = v_quest_key
    and enabled = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now());

  if v_points is null then raise exception 'Quest is not available'; end if;
  if p_is_base_app then v_points := v_points * 2; end if;

  insert into external_quest_claims(wallet, quest_key, points, target_url, claimed_at)
  values (v_wallet, v_quest_key, v_points, v_target_url, now())
  on conflict (wallet, quest_key) do nothing
  returning true into did_insert;

  if coalesce(did_insert, false) then
    insert into player_stats(wallet, points, updated_at)
    values (v_wallet, v_points, now())
    on conflict (wallet) do update
      set points = player_stats.points + excluded.points,
          updated_at = now();
  end if;

  return coalesce(did_insert, false);
end;
$$;

-- SECURITY DEFINER must never be callable with the public API key. Claims go
-- through /api/external-quests/claim after the server verifies the campaign.
revoke all on function claim_external_quest(text, text, boolean)
  from public, anon, authenticated;
grant execute on function claim_external_quest(text, text, boolean)
  to service_role;

select pg_notify('pgrst', 'reload schema');
