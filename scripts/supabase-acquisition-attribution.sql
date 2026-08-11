-- First-touch acquisition attribution.
-- Run in Supabase SQL Editor before enabling /api/acquisition in production.
--
-- This is intentionally a bounded, one-row-per-browser-session table instead
-- of an append-only page-view log. Old anonymous sessions can be removed with:
--   delete from public.acquisition_sessions as session
--   where session.last_seen_at < now() - interval '180 days'
--     and not exists (
--       select 1 from public.acquisition_wallet_links as link
--       where link.session_id = session.id
--     );

begin;

create table if not exists public.acquisition_sessions (
  id uuid primary key,
  ref_token text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referrer_host text,
  landing_path text,
  platform text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visit_count bigint not null default 0,
  constraint acquisition_sessions_ref_token_format check (
    ref_token is null
    or ref_token ~ '^(0x[0-9a-f]{40}|[a-z0-9][a-z0-9_-]{2,31})$'
  ),
  constraint acquisition_sessions_utm_source_length check (
    utm_source is null or char_length(utm_source) <= 64
  ),
  constraint acquisition_sessions_utm_medium_length check (
    utm_medium is null or char_length(utm_medium) <= 64
  ),
  constraint acquisition_sessions_utm_campaign_length check (
    utm_campaign is null or char_length(utm_campaign) <= 128
  ),
  constraint acquisition_sessions_utm_content_length check (
    utm_content is null or char_length(utm_content) <= 128
  ),
  constraint acquisition_sessions_referrer_host_length check (
    referrer_host is null or char_length(referrer_host) <= 253
  ),
  constraint acquisition_sessions_landing_path_format check (
    landing_path is null
    or (char_length(landing_path) <= 512 and landing_path like '/%')
  ),
  constraint acquisition_sessions_platform_format check (
    platform is null
    or platform in ('base_app', 'farcaster', 'web')
  ),
  constraint acquisition_sessions_visit_count_nonnegative check (visit_count >= 0),
  constraint acquisition_sessions_seen_order check (last_seen_at >= first_seen_at)
);

comment on table public.acquisition_sessions is
  'First-touch web acquisition sessions. Attribution columns are immutable after the first visit.';
comment on column public.acquisition_sessions.referrer_host is
  'Hostname only; full document.referrer URLs are never stored.';

create table if not exists public.acquisition_wallet_links (
  session_id uuid not null references public.acquisition_sessions(id) on delete cascade,
  wallet text not null,
  attached_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  attach_count bigint not null default 1,
  referral_recorded_at timestamptz,
  primary key (session_id, wallet),
  constraint acquisition_wallet_links_wallet_format check (
    wallet ~ '^0x[0-9a-f]{40}$'
  ),
  constraint acquisition_wallet_links_attach_count_positive check (attach_count > 0),
  constraint acquisition_wallet_links_seen_order check (last_seen_at >= attached_at)
);

comment on table public.acquisition_wallet_links is
  'Many-to-many session/wallet attribution. A browser session may connect multiple wallets.';

create table if not exists public.acquisition_rate_limit_buckets (
  bucket_start timestamptz not null,
  scope text not null,
  subject_hash text not null,
  request_count bigint not null default 1,
  primary key (bucket_start, scope, subject_hash),
  constraint acquisition_rate_limit_scope_format check (
    scope in ('global', 'subject')
  ),
  constraint acquisition_rate_limit_subject_format check (
    (scope = 'global' and subject_hash = '*')
    or (scope = 'subject' and subject_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint acquisition_rate_limit_count_positive check (request_count > 0)
);

comment on table public.acquisition_rate_limit_buckets is
  'Durable fixed-window acquisition API counters. Subject keys are HMAC digests; raw IP addresses are never stored.';

create index if not exists idx_acquisition_sessions_last_seen
  on public.acquisition_sessions(last_seen_at);

create index if not exists idx_acquisition_sessions_first_seen
  on public.acquisition_sessions(first_seen_at);

create index if not exists idx_acquisition_sessions_source_first_seen
  on public.acquisition_sessions(utm_source, first_seen_at desc)
  where utm_source is not null;

create index if not exists idx_acquisition_sessions_ref_first_seen
  on public.acquisition_sessions(ref_token, first_seen_at desc)
  where ref_token is not null;

create index if not exists idx_acquisition_wallet_links_wallet
  on public.acquisition_wallet_links(wallet);

create index if not exists idx_acquisition_wallet_links_last_seen
  on public.acquisition_wallet_links(last_seen_at);

create index if not exists idx_acquisition_wallet_links_referral_recorded
  on public.acquisition_wallet_links(referral_recorded_at)
  where referral_recorded_at is not null;

alter table public.acquisition_sessions enable row level security;
alter table public.acquisition_sessions force row level security;
alter table public.acquisition_wallet_links enable row level security;
alter table public.acquisition_wallet_links force row level security;
alter table public.acquisition_rate_limit_buckets enable row level security;
alter table public.acquisition_rate_limit_buckets force row level security;

revoke all on table public.acquisition_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.acquisition_sessions to service_role;
revoke all on table public.acquisition_wallet_links from public, anon, authenticated;
grant select, insert, update, delete on table public.acquisition_wallet_links to service_role;
revoke all on table public.acquisition_rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.acquisition_rate_limit_buckets to service_role;

drop function if exists public.consume_acquisition_rate_limit(text, integer, integer);

create function public.consume_acquisition_rate_limit(
  p_subject_hash text,
  p_subject_limit integer default 60,
  p_global_limit integer default 2000
) returns table (
  rate_limit_allowed boolean,
  rate_limit_retry_after integer,
  rate_limit_subject_count bigint,
  rate_limit_global_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_bucket_start timestamptz := date_trunc('minute', v_now);
  v_subject_count bigint;
  v_global_count bigint;
  v_retry_after integer;
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid acquisition rate-limit subject' using errcode = '22023';
  end if;
  if p_subject_limit is null or p_subject_limit < 1 or p_subject_limit > 10000 then
    raise exception 'invalid acquisition subject rate limit' using errcode = '22023';
  end if;
  if p_global_limit is null or p_global_limit < 1 or p_global_limit > 1000000 then
    raise exception 'invalid acquisition global rate limit' using errcode = '22023';
  end if;

  -- Consume the per-subject slot first. Requests already over that limit do
  -- not burn the shared global budget, so one abusive IP cannot deny tracking
  -- for every other visitor.
  insert into public.acquisition_rate_limit_buckets as rate_bucket (
    bucket_start,
    scope,
    subject_hash,
    request_count
  ) values (
    v_bucket_start,
    'subject',
    p_subject_hash,
    1
  )
  on conflict (bucket_start, scope, subject_hash) do update set
    request_count = rate_bucket.request_count + 1
  returning rate_bucket.request_count into v_subject_count;

  if v_subject_count > p_subject_limit then
    select coalesce(max(current_bucket.request_count), 0)
    into v_global_count
    from public.acquisition_rate_limit_buckets as current_bucket
    where current_bucket.bucket_start = v_bucket_start
      and current_bucket.scope = 'global'
      and current_bucket.subject_hash = '*';

    v_retry_after := least(
      60,
      greatest(
        1,
        ceil(extract(epoch from (v_bucket_start + interval '1 minute' - v_now)))::integer
      )
    );

    return query select
      false,
      v_retry_after,
      v_subject_count,
      v_global_count;
    return;
  end if;

  -- Only requests inside their subject budget consume the global budget.
  insert into public.acquisition_rate_limit_buckets as rate_bucket (
    bucket_start,
    scope,
    subject_hash,
    request_count
  ) values (
    v_bucket_start,
    'global',
    '*',
    1
  )
  on conflict (bucket_start, scope, subject_hash) do update set
    request_count = rate_bucket.request_count + 1
  returning rate_bucket.request_count into v_global_count;

  v_retry_after := least(
    60,
    greatest(
      1,
      ceil(extract(epoch from (v_bucket_start + interval '1 minute' - v_now)))::integer
    )
  );

  -- Keep the durable limiter bounded without adding a cleanup job dependency.
  -- A small batch is deleted opportunistically on roughly one in 64 calls.
  if random() < 0.015625 then
    delete from public.acquisition_rate_limit_buckets as expired
    where expired.ctid in (
      select candidate.ctid
      from public.acquisition_rate_limit_buckets as candidate
      where candidate.bucket_start < v_bucket_start - interval '48 hours'
      order by candidate.bucket_start
      limit 5000
    );
  end if;

  return query select
    v_subject_count <= p_subject_limit and v_global_count <= p_global_limit,
    v_retry_after,
    v_subject_count,
    v_global_count;
end;
$$;

-- An earlier unpublished draft used the same input signature with a different
-- TABLE return shape. PostgreSQL cannot replace changed OUT parameters in
-- place, so drop it inside this transaction before installing the final RPC.
drop function if exists public.record_acquisition_session(
  uuid, text, text, text, text, text, text, text, text, text, text
);

create or replace function public.record_acquisition_session(
  p_session_id uuid,
  p_event text,
  p_ref_token text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_referrer_host text default null,
  p_landing_path text default null,
  p_platform text default null,
  p_wallet text default null
) returns table (
  session_id uuid,
  recorded_first_seen_at timestamptz,
  recorded_last_seen_at timestamptz,
  recorded_visit_count bigint,
  recorded_wallet_attached boolean,
  recorded_wallet_attached_at timestamptz,
  recorded_referral_recorded_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_first_seen_at timestamptz;
  v_last_seen_at timestamptz;
  v_visit_count bigint;
  v_wallet_attached boolean := false;
  v_wallet_attached_at timestamptz;
  v_referral_recorded_at timestamptz;
begin
  if p_event is null or p_event not in ('visit', 'wallet') then
    raise exception 'invalid acquisition event' using errcode = '22023';
  end if;

  if p_event = 'wallet' and (p_wallet is null or p_wallet !~ '^0x[0-9a-f]{40}$') then
    raise exception 'valid wallet required for wallet event' using errcode = '22023';
  end if;

  if p_event = 'visit' then
    insert into public.acquisition_sessions as acquisition (
      id,
      ref_token,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      referrer_host,
      landing_path,
      platform,
      first_seen_at,
      last_seen_at,
      visit_count
    ) values (
      p_session_id,
      p_ref_token,
      p_utm_source,
      p_utm_medium,
      p_utm_campaign,
      p_utm_content,
      p_referrer_host,
      p_landing_path,
      p_platform,
      now(),
      now(),
      1
    )
    on conflict (id) do update set
      last_seen_at = now(),
      visit_count = acquisition.visit_count + 1
    returning
      acquisition.first_seen_at,
      acquisition.last_seen_at,
      acquisition.visit_count
    into v_first_seen_at, v_last_seen_at, v_visit_count;
  else
    update public.acquisition_sessions as acquisition
    set last_seen_at = now()
    where acquisition.id = p_session_id
    returning
      acquisition.first_seen_at,
      acquisition.last_seen_at,
      acquisition.visit_count
    into v_first_seen_at, v_last_seen_at, v_visit_count;

    if not found then
      raise exception 'acquisition session not found' using errcode = 'P0002';
    end if;
  end if;

  if p_event = 'wallet' then
    -- The session row was updated (and therefore locked) above. This makes the
    -- fan-out check safe against concurrent wallet events for the same cookie.
    if not exists (
      select 1
      from public.acquisition_wallet_links as existing_link
      where existing_link.session_id = p_session_id
        and existing_link.wallet = p_wallet
    ) and (
      select count(*)
      from public.acquisition_wallet_links as existing_link
      where existing_link.session_id = p_session_id
    ) >= 32 then
      raise exception 'acquisition wallet link limit reached' using errcode = '54000';
    end if;

    insert into public.acquisition_wallet_links as wallet_link (
      session_id,
      wallet,
      attached_at,
      last_seen_at,
      attach_count
    ) values (
      p_session_id,
      p_wallet,
      now(),
      now(),
      1
    )
    on conflict on constraint acquisition_wallet_links_pkey do update set
      last_seen_at = now(),
      attach_count = wallet_link.attach_count + 1
    returning
      true,
      wallet_link.attached_at,
      wallet_link.referral_recorded_at
    into v_wallet_attached, v_wallet_attached_at, v_referral_recorded_at;
  end if;

  return query select
    p_session_id,
    v_first_seen_at,
    v_last_seen_at,
    v_visit_count,
    v_wallet_attached,
    v_wallet_attached_at,
    v_referral_recorded_at;
end;
$$;

create or replace function public.mark_acquisition_referral_recorded(
  p_session_id uuid,
  p_wallet text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated boolean := false;
begin
  if p_wallet is null or p_wallet !~ '^0x[0-9a-f]{40}$' then
    return false;
  end if;

  -- Lock the parent row so the per-session wallet cap is race-safe across both
  -- telemetry events and verified referral attachment.
  update public.acquisition_sessions
  set last_seen_at = now()
  where id = p_session_id;

  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.acquisition_wallet_links as existing_link
    where existing_link.session_id = p_session_id
      and existing_link.wallet = p_wallet
  ) and (
    select count(*)
    from public.acquisition_wallet_links as existing_link
    where existing_link.session_id = p_session_id
  ) >= 32 then
    return false;
  end if;

  insert into public.acquisition_wallet_links as wallet_link (
    session_id,
    wallet,
    attached_at,
    last_seen_at,
    attach_count,
    referral_recorded_at
  )
  select
    acquisition.id,
    p_wallet,
    now(),
    now(),
    1,
    now()
  from public.acquisition_sessions as acquisition
  where acquisition.id = p_session_id
  on conflict on constraint acquisition_wallet_links_pkey do update set
    last_seen_at = now(),
    referral_recorded_at = coalesce(wallet_link.referral_recorded_at, now())
  returning true into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.record_acquisition_session(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_acquisition_session(
  uuid, text, text, text, text, text, text, text, text, text, text
) to service_role;

revoke all on function public.mark_acquisition_referral_recorded(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_acquisition_referral_recorded(uuid, text)
  to service_role;

revoke all on function public.consume_acquisition_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_acquisition_rate_limit(text, integer, integer)
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
