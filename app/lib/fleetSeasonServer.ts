import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFleetSeasonStats,
  DEFAULT_FLEETS,
  FLEET_CHOICE_RESET_SEASON_KEY,
  FLEET_CHOICE_ROLLOUT_AT,
  isFleetId,
  type FleetDefinition,
  type FleetGameInput,
  type FleetMemberInput,
  type FleetSeasonStats,
} from "./fleetSeason";

const PAGE_SIZE = 1000;
const POINTS_BATCH_SIZE = 100;

export type FleetSeasonRecord = {
  seasonKey: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "active" | "ended" | "snapshotted";
  rankingMetric: "total_wins";
  minGames: number;
  sharesBps: [number, number, number];
  dropId: string | null;
  claimStatus: "draft" | "active" | "closed" | null;
};

export type FleetSeasonDashboard = {
  season: FleetSeasonRecord;
  fleets: FleetDefinition[];
  stats: FleetSeasonStats;
};

export async function loadFleetSeasonDashboard(
  admin: SupabaseClient,
  options: { seasonKey?: string | null; publicOnly?: boolean } = {},
): Promise<FleetSeasonDashboard | null> {
  let query = admin
    .from("fleet_seasons")
    .select("season_key,title,starts_at,ends_at,status,ranking_metric,min_games,first_share_bps,second_share_bps,third_share_bps,drop_id");

  if (options.seasonKey) {
    query = query.eq("season_key", options.seasonKey);
  } else {
    if (options.publicOnly) query = query.in("status", ["active", "ended", "snapshotted"]);
    query = query.order("starts_at", { ascending: false }).limit(1);
  }

  const { data: seasonRow, error: seasonError } = await query.maybeSingle();
  if (seasonError) throw new Error(seasonError.message);
  if (!seasonRow) return null;

  const dropId = seasonRow.drop_id ? String(seasonRow.drop_id) : null;
  let claimStatus: FleetSeasonRecord["claimStatus"] = null;
  if (dropId) {
    const { data: dropRow, error: dropError } = await admin
      .from("drop_campaigns")
      .select("status")
      .eq("id", dropId)
      .maybeSingle();
    if (dropError) throw new Error(dropError.message);
    if (dropRow?.status === "draft" || dropRow?.status === "active" || dropRow?.status === "closed") {
      claimStatus = dropRow.status;
    }
  }

  const season: FleetSeasonRecord = {
    seasonKey: String(seasonRow.season_key),
    title: String(seasonRow.title || "Fleet Season"),
    startsAt: String(seasonRow.starts_at),
    endsAt: String(seasonRow.ends_at),
    status: seasonRow.status as FleetSeasonRecord["status"],
    rankingMetric: "total_wins",
    minGames: Math.max(0, Math.floor(Number(seasonRow.min_games ?? 0))),
    sharesBps: [
      Math.floor(Number(seasonRow.first_share_bps ?? 6000)),
      Math.floor(Number(seasonRow.second_share_bps ?? 3000)),
      Math.floor(Number(seasonRow.third_share_bps ?? 1000)),
    ],
    dropId,
    claimStatus,
  };

  const { data: fleetRows, error: fleetsError } = await admin
    .from("fleet_season_fleets")
    .select("fleet_id,name,color,image_path,display_order")
    .eq("season_key", season.seasonKey)
    .order("display_order", { ascending: true });
  if (fleetsError) throw new Error(fleetsError.message);

  const fleets = (fleetRows ?? [])
    .filter((row) => isFleetId(row.fleet_id))
    .map((row) => ({
      id: row.fleet_id,
      name: String(row.name),
      color: String(row.color),
      image: String(row.image_path),
      displayOrder: Math.floor(Number(row.display_order)),
    })) as FleetDefinition[];
  const safeFleets = fleets.length === 3 ? fleets : DEFAULT_FLEETS;

  const memberRows = await loadMembers(admin, season.seasonKey);
  const currentPoints = season.status === "active"
    ? await loadCurrentPoints(admin, memberRows.map((row) => row.wallet))
    : new Map<string, number>();
  const gameRows = await loadGames(admin, season.startsAt, statsEndDate(season));
  const members: FleetMemberInput[] = memberRows
    .filter((row) => isFleetId(row.fleet_id))
    .map((row) => ({
      wallet: String(row.wallet),
      fleetId: row.fleet_id as FleetMemberInput["fleetId"],
      joinedAt: String(row.joined_at),
      pointsAtJoin: Math.max(0, Math.floor(Number(row.points_at_join ?? 0))),
      currentPoints: season.status === "active"
        ? currentPoints.get(String(row.wallet).toLowerCase()) ?? 0
        : Math.max(0, Math.floor(Number(row.points_at_end ?? row.points_at_join ?? 0))),
    }));
  const games: FleetGameInput[] = gameRows.map((row) => ({
    id: row.id,
    player1: row.player1 ? String(row.player1) : null,
    player2: row.player2 ? String(row.player2) : null,
    winner: row.winner ? String(row.winner) : null,
    createdAt: String(row.created_at),
  }));

  return {
    season,
    fleets: safeFleets,
    stats: computeFleetSeasonStats(safeFleets, members, games, season.minGames),
  };
}

async function loadMembers(admin: SupabaseClient, seasonKey: string) {
  const rows: Array<{
    wallet: string;
    fleet_id: string;
    joined_at: string;
    points_at_join: number;
    points_at_end: number | null;
  }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = admin
      .from("fleet_season_members")
      .select("wallet,fleet_id,joined_at,points_at_join,points_at_end")
      .eq("season_key", seasonKey)
      .order("wallet", { ascending: true });
    if (seasonKey === FLEET_CHOICE_RESET_SEASON_KEY) {
      query = query.gte("joined_at", FLEET_CHOICE_ROLLOUT_AT);
    }
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

async function loadCurrentPoints(admin: SupabaseClient, wallets: string[]) {
  const result = new Map<string, number>();
  const uniqueWallets = Array.from(new Set(wallets.map((wallet) => wallet.toLowerCase())));
  for (let index = 0; index < uniqueWallets.length; index += POINTS_BATCH_SIZE) {
    const batch = uniqueWallets.slice(index, index + POINTS_BATCH_SIZE);
    const { data, error } = await admin
      .from("player_stats")
      .select("wallet,points")
      .in("wallet", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      result.set(String(row.wallet).toLowerCase(), Math.max(0, Math.floor(Number(row.points ?? 0))));
    }
  }
  return result;
}

async function loadGames(admin: SupabaseClient, startsAt: string, endsAt: string) {
  const rows: Array<{
    id: number;
    player1: string | null;
    player2: string | null;
    winner: string | null;
    created_at: string;
  }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("games")
      .select("id,player1,player2,winner,created_at")
      .eq("state", 3)
      .gte("created_at", startsAt)
      .lt("created_at", endsAt)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

function statsEndDate(season: FleetSeasonRecord) {
  const configuredEnd = Date.parse(season.endsAt);
  if (season.status !== "active") return season.endsAt;
  return new Date(Math.min(configuredEnd, Date.now() + 1000)).toISOString();
}
