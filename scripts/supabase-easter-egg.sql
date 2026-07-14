-- Create table for tracking homepage Easter Egg claims and cooldowns
create table if not exists easter_egg_claims (
  wallet text not null primary key,
  last_claimed_at timestamp with time zone default timezone('utc'::text, now()) not null,
  total_claims integer default 1 not null,
  usd_eligible boolean default false not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create table for Easter Egg settings (winners limit and reward amount)
create table if not exists easter_egg_config (
  id text not null primary key,
  max_winners integer default 1 not null,
  reward_amount_raw text default '5000000' not null, -- $5 USDC (6 decimals)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Insert default config row
insert into easter_egg_config (id, max_winners, reward_amount_raw)
values ('default', 1, '5000000')
on conflict (id) do nothing;

-- Enable Row Level Security (RLS)
alter table easter_egg_claims enable row level security;
alter table easter_egg_config enable row level security;

-- Admin read policy
create policy "Admin read easter_egg_claims" on easter_egg_claims
  for select using (true);

create policy "Admin read easter_egg_config" on easter_egg_config
  for select using (true);

-- Force PostgREST/Supabase API to see newly created tables/columns immediately.
notify pgrst, 'reload schema';

