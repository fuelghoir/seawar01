-- Minimal schema required by Admin -> Referrals and short profile links.
-- Run once in the Supabase SQL Editor for the production project.

begin;

create table if not exists public.referral_codes (
  code text primary key,
  wallet text not null,
  is_primary boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_codes_code_format check (
    code = lower(trim(code))
    and code ~ '^[a-z0-9][a-z0-9_-]{2,31}$'
  ),
  constraint referral_codes_wallet_format check (
    wallet = lower(trim(wallet))
    and wallet ~ '^0x[a-f0-9]{40}$'
  ),
  constraint referral_codes_created_by_format check (
    created_by is null
    or (
      created_by = lower(trim(created_by))
      and created_by ~ '^0x[a-f0-9]{40}$'
    )
  )
);

create unique index if not exists referral_codes_one_primary_per_wallet
  on public.referral_codes (wallet)
  where is_primary;

create index if not exists referral_codes_wallet_idx
  on public.referral_codes (wallet);

alter table public.referral_codes enable row level security;
revoke all on table public.referral_codes from public, anon, authenticated;
grant all on table public.referral_codes to service_role;

create or replace function public.set_primary_referral_code(
  p_wallet text,
  p_code text,
  p_created_by text default null
) returns table (
  code text,
  wallet text,
  is_primary boolean,
  created_by text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_wallet text := lower(trim(coalesce(p_wallet, '')));
  v_code text := lower(trim(coalesce(p_code, '')));
  v_created_by text := nullif(lower(trim(coalesce(p_created_by, ''))), '');
begin
  if v_wallet !~ '^0x[a-f0-9]{40}$' then
    raise exception 'Invalid referral wallet' using errcode = '22023';
  end if;

  if v_code !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    raise exception 'Invalid referral code' using errcode = '22023';
  end if;

  if v_created_by is not null and v_created_by !~ '^0x[a-f0-9]{40}$' then
    raise exception 'Invalid admin wallet' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_wallet, 0));

  if exists (
    select 1
    from public.referral_codes existing
    where existing.code = v_code
      and existing.wallet <> v_wallet
  ) then
    raise exception 'Referral code is already assigned' using errcode = '23505';
  end if;

  update public.referral_codes existing
  set is_primary = false,
      updated_at = now()
  where existing.wallet = v_wallet
    and existing.is_primary
    and existing.code <> v_code;

  insert into public.referral_codes as existing (
    code,
    wallet,
    is_primary,
    created_by,
    created_at,
    updated_at
  ) values (
    v_code,
    v_wallet,
    true,
    v_created_by,
    now(),
    now()
  )
  on conflict on constraint referral_codes_pkey do update
  set is_primary = true,
      created_by = coalesce(excluded.created_by, existing.created_by),
      updated_at = now()
  where existing.wallet = excluded.wallet;

  if not found then
    raise exception 'Referral code is already assigned' using errcode = '23505';
  end if;

  return query
  select
    result.code,
    result.wallet,
    result.is_primary,
    result.created_by,
    result.created_at,
    result.updated_at
  from public.referral_codes result
  where result.code = v_code;
end;
$$;

revoke all on function public.set_primary_referral_code(text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_primary_referral_code(text, text, text)
  to service_role;

commit;

select pg_notify('pgrst', 'reload schema');
