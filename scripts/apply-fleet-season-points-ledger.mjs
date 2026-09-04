import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1_000;
const BATCH_SIZE = 100;
const BASE_APP_GAME_BONUS = 1_000;
const FLEET_CHOICE_ROLLOUT_AT = "2026-09-01T16:33:00.000Z";
const WALLET_RE = /^0x[a-f0-9]{40}$/;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const now = new Date().toISOString();
const { data: season, error: seasonError } = await supabase
  .from("fleet_seasons")
  .select("season_key,starts_at,ends_at,status")
  .eq("status", "active")
  .lte("starts_at", now)
  .gt("ends_at", now)
  .order("starts_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (seasonError) throw new Error(seasonError.message);
if (!season?.season_key) throw new Error("No active Fleet Season found");

const seasonKey = String(season.season_key);
const members = await fetchPaged((from, to) => {
  let query = supabase
    .from("fleet_season_members")
    .select("wallet,joined_at,points_at_join")
    .eq("season_key", seasonKey)
    .order("wallet", { ascending: true });
  if (seasonKey === "S3") query = query.gte("joined_at", FLEET_CHOICE_ROLLOUT_AT);
  return query.range(from, to);
});

const memberByWallet = new Map();
for (const row of members) {
  const wallet = normalizeWallet(row.wallet);
  if (!wallet) continue;
  memberByWallet.set(wallet, {
    wallet,
    joinedAt: String(row.joined_at),
    pointsAtJoin: nonNegativeInteger(row.points_at_join),
  });
}
const wallets = Array.from(memberByWallet.keys());

const [stats, progress, baseAppWallets] = await Promise.all([
  loadPlayerStats(wallets),
  loadSeasonProgress(seasonKey, wallets),
  loadBaseAppWallets(wallets),
]);

const statsEnd = new Date(Math.min(Date.parse(String(season.ends_at)), Date.now() + 1_000)).toISOString();
const games = await fetchPaged((from, to) => supabase
  .from("games")
  .select("id,player1,player2,winner,player1_hits,player2_hits,created_at")
  .eq("state", 3)
  .gte("created_at", String(season.starts_at))
  .lt("created_at", statsEnd)
  .order("id", { ascending: true })
  .range(from, to));
const minerClaims = await fetchPaged((from, to) => supabase
  .from("fleet_nft_point_claims")
  .select("wallet,points,created_at")
  .gte("created_at", String(season.starts_at))
  .lt("created_at", statsEnd)
  .order("created_at", { ascending: true })
  .range(from, to));

const verifiedPoints = new Map(wallets.map((wallet) => [wallet, 0]));
for (const game of games) {
  const createdAt = Date.parse(String(game.created_at));
  const winner = normalizeWallet(game.winner);
  const players = [
    [normalizeWallet(game.player1), game.player1_hits],
    [normalizeWallet(game.player2), game.player2_hits],
  ];
  for (const [wallet, hits] of players) {
    const member = wallet ? memberByWallet.get(wallet) : null;
    if (!member || createdAt < Date.parse(member.joinedAt)) continue;
    const points = nonNegativeInteger(hits)
      + (winner === wallet ? 50 : 0)
      + (baseAppWallets.has(wallet) ? BASE_APP_GAME_BONUS : 0);
    verifiedPoints.set(wallet, (verifiedPoints.get(wallet) ?? 0) + points);
  }
}

for (const claim of minerClaims) {
  const wallet = normalizeWallet(claim.wallet);
  const member = wallet ? memberByWallet.get(wallet) : null;
  if (!member || Date.parse(String(claim.created_at)) < Date.parse(member.joinedAt)) continue;
  verifiedPoints.set(wallet, (verifiedPoints.get(wallet) ?? 0) + nonNegativeInteger(claim.points));
}

const updates = [];
const report = [];
for (const member of memberByWallet.values()) {
  const currentStats = stats.get(member.wallet) ?? 0;
  const currentProgress = progress.get(member.wallet) ?? {
    points: 0,
    xp: 0,
    claimedLevels: [],
  };
  const netEarned = Math.max(0, currentStats - member.pointsAtJoin);
  const verifiedEarned = verifiedPoints.get(member.wallet) ?? 0;
  const correctedPoints = Math.max(currentProgress.points, netEarned, verifiedEarned);
  if (correctedPoints <= currentProgress.points) continue;

  updates.push({
    wallet: member.wallet,
    season_key: seasonKey,
    xp: currentProgress.xp,
    claimed_levels: currentProgress.claimedLevels,
    points: correctedPoints,
    updated_at: now,
  });
  report.push({
    wallet: member.wallet,
    before: currentProgress.points,
    after: correctedPoints,
    baseApp: baseAppWallets.has(member.wallet),
  });
}

for (const batch of chunk(updates, BATCH_SIZE)) {
  const { error } = await supabase
    .from("season_progress")
    .upsert(batch, { onConflict: "wallet,season_key" });
  if (error) throw new Error(error.message);
}

console.log(JSON.stringify({
  seasonKey,
  members: memberByWallet.size,
  baseAppWallets: baseAppWallets.size,
  updated: updates.length,
  corrections: report,
}, null, 2));

async function loadPlayerStats(targetWallets) {
  const result = new Map();
  for (const batch of chunk(targetWallets, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("player_stats")
      .select("wallet,points")
      .in("wallet", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const wallet = normalizeWallet(row.wallet);
      if (wallet) result.set(wallet, nonNegativeInteger(row.points));
    }
  }
  return result;
}

async function loadSeasonProgress(targetSeasonKey, targetWallets) {
  const result = new Map();
  for (const batch of chunk(targetWallets, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("season_progress")
      .select("wallet,points,xp,claimed_levels")
      .eq("season_key", targetSeasonKey)
      .in("wallet", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const wallet = normalizeWallet(row.wallet);
      if (!wallet) continue;
      result.set(wallet, {
        points: nonNegativeInteger(row.points),
        xp: nonNegativeInteger(row.xp),
        claimedLevels: Array.isArray(row.claimed_levels) ? row.claimed_levels : [],
      });
    }
  }
  return result;
}

async function loadBaseAppWallets(targetWallets) {
  const result = new Set();
  const sessionWallets = new Map();

  for (const batch of chunk(targetWallets, BATCH_SIZE)) {
    const [{ data: links, error: linksError }, { data: checkins, error: checkinsError }] = await Promise.all([
      supabase.from("acquisition_wallet_links").select("session_id,wallet").in("wallet", batch),
      supabase.from("daily_checkin_claims").select("wallet").eq("is_base_app", true).in("wallet", batch),
    ]);
    if (linksError) throw new Error(linksError.message);
    if (checkinsError) throw new Error(checkinsError.message);

    for (const row of links ?? []) {
      const wallet = normalizeWallet(row.wallet);
      const sessionId = String(row.session_id ?? "");
      if (!wallet || !sessionId) continue;
      const linked = sessionWallets.get(sessionId) ?? new Set();
      linked.add(wallet);
      sessionWallets.set(sessionId, linked);
    }
    for (const row of checkins ?? []) {
      const wallet = normalizeWallet(row.wallet);
      if (wallet) result.add(wallet);
    }
  }

  for (const batch of chunk(Array.from(sessionWallets.keys()), BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("acquisition_sessions")
      .select("id")
      .eq("platform", "base_app")
      .in("id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      for (const wallet of sessionWallets.get(String(row.id)) ?? []) result.add(wallet);
    }
  }

  return result;
}

async function fetchPaged(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

function chunk(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function normalizeWallet(value) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(Number(value ?? 0)));
}
