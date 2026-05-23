-- Referral tracking table.
-- Run this in Supabase SQL Editor before enabling referral rewards.

create table if not exists referrals (
  id bigserial primary key,
  referrer text not null,
  referee text not null unique,
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (lower(referrer) <> lower(referee))
);

create index if not exists idx_referrals_referrer
  on referrals(referrer);

create index if not exists idx_referrals_referee
  on referrals(referee);

alter table referrals
  add column if not exists first_game_bonus_paid_at timestamptz,
  add column if not exists first_game_bonus_points integer not null default 0;

create index if not exists idx_referrals_unpaid_first_game
  on referrals(referee)
  where first_game_bonus_paid_at is null;

create or replace function award_referral_first_game_bonus(
  p_referee text
) returns boolean
language plpgsql
security definer
as $$
declare
  v_referee text := lower(trim(p_referee));
  v_referrer text;
begin
  if v_referee !~ '^0x[a-f0-9]{40}$' then
    return false;
  end if;

  if not exists (
    select 1
    from player_stats
    where wallet = v_referee
      and games_played > 0
  ) then
    return false;
  end if;

  update referrals
    set first_game_bonus_paid_at = now(),
        first_game_bonus_points = 1000
    where referee = v_referee
      and first_game_bonus_paid_at is null
    returning lower(referrer) into v_referrer;

  if v_referrer is null then
    return false;
  end if;

  insert into player_stats (wallet, points, updated_at)
  values (v_referrer, 1000, now())
  on conflict (wallet) do update
    set points = player_stats.points + excluded.points,
        updated_at = now();

  return true;
end;
$$;

create or replace function sync_referral_first_game_bonuses(
  p_referrer text default null
) returns integer
language plpgsql
security definer
as $$
declare
  v_referrer_filter text := nullif(lower(trim(coalesce(p_referrer, ''))), '');
  v_paid integer := 0;
  r record;
begin
  for r in
    select ref.id, lower(ref.referrer) as referrer
    from referrals ref
    join player_stats referee_stats
      on referee_stats.wallet = lower(ref.referee)
     and referee_stats.games_played > 0
    where ref.first_game_bonus_paid_at is null
      and (
        v_referrer_filter is null
        or lower(ref.referrer) = v_referrer_filter
      )
  loop
    update referrals
      set first_game_bonus_paid_at = now(),
          first_game_bonus_points = 1000
      where id = r.id
        and first_game_bonus_paid_at is null;

    if found then
      insert into player_stats (wallet, points, updated_at)
      values (r.referrer, 1000, now())
      on conflict (wallet) do update
        set points = player_stats.points + excluded.points,
            updated_at = now();

      v_paid := v_paid + 1;
    end if;
  end loop;

  return v_paid;
end;
$$;

grant execute on function award_referral_first_game_bonus(text) to anon, authenticated;
grant execute on function sync_referral_first_game_bonuses(text) to anon, authenticated;

-- Force PostgREST/Supabase API to see newly created columns/functions immediately.
select pg_notify('pgrst', 'reload schema');
