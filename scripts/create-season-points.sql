CREATE TABLE public.season_points (
  wallet text NOT NULL,
  season_key text NOT NULL,
  points integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (wallet, season_key)
);