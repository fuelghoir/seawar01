import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keccak256, toBytes } from "viem";
import { adminSupabase } from "../../lib/adminSupabase";
import { loadFleetSeasonDashboard } from "../../lib/fleetSeasonServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

type FleetAssignmentRow = {
  season_key: string;
  fleet_id: string;
  joined_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const wallet = normalizeWallet(req.nextUrl.searchParams.get("wallet"));
    const dashboard = await loadFleetSeasonDashboard(adminSupabase(), { publicOnly: true });
    if (!dashboard) return NextResponse.json({ season: null });
    if (dashboard.season.status === "active") {
      const now = Date.now();
      if (now < Date.parse(dashboard.season.startsAt) || now >= Date.parse(dashboard.season.endsAt)) {
        return NextResponse.json({ season: null });
      }
    }

    const member = wallet
      ? dashboard.stats.members.find((entry) => entry.wallet === wallet) ?? null
      : null;

    return NextResponse.json({
      season: publicSeason(dashboard),
      membership: member ? publicMembership(member, dashboard) : null,
    });
  } catch (error) {
    if (isMissingFleetSchema(error)) {
      return NextResponse.json({ season: null, migrationRequired: true });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load fleet season" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const wallet = normalizeWallet(body?.wallet);
    if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

    const admin = adminSupabase();
    const { data, error } = await admin.rpc("join_active_fleet_season", { p_wallet: wallet });
    if (error && !isAmbiguousAssignmentError(error.message)) throw new Error(error.message);
    const assignment = error
      ? await assignFleetSeasonFallback(admin, wallet)
      : normalizeAssignment(data);
    if (!assignment) throw new Error("Fleet assignment failed");

    const dashboard = await loadFleetSeasonDashboard(admin, {
      seasonKey: String(assignment.season_key),
    });
    if (!dashboard) throw new Error("Fleet season not found after assignment");
    const member = dashboard.stats.members.find((entry) => entry.wallet === wallet);
    if (!member) throw new Error("Fleet membership not found after assignment");

    return NextResponse.json({
      season: publicSeason(dashboard),
      membership: publicMembership(member, dashboard),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not join fleet season" },
      { status: 500 },
    );
  }
}

function publicSeason(dashboard: NonNullable<Awaited<ReturnType<typeof loadFleetSeasonDashboard>>>) {
  return {
    key: dashboard.season.seasonKey,
    title: dashboard.season.title,
    startsAt: dashboard.season.startsAt,
    endsAt: dashboard.season.endsAt,
    status: dashboard.season.status,
    rankingMetric: dashboard.season.rankingMetric,
    minGames: dashboard.season.minGames,
    shares: dashboard.season.sharesBps.map((value) => value / 100),
    drop: { secret: true },
    fleets: dashboard.stats.standings.map((fleet) => ({
      id: fleet.id,
      name: fleet.name,
      color: fleet.color,
      image: fleet.image,
      rank: fleet.rank,
      members: fleet.members,
      games: fleet.games,
      wins: fleet.wins,
      pointsEarned: fleet.pointsEarned,
    })),
  };
}

function publicMembership(
  member: NonNullable<Awaited<ReturnType<typeof loadFleetSeasonDashboard>>>["stats"]["members"][number],
  dashboard: NonNullable<Awaited<ReturnType<typeof loadFleetSeasonDashboard>>>,
) {
  const fleet = dashboard.stats.standings.find((entry) => entry.id === member.fleetId);
  return {
    fleetId: member.fleetId,
    fleetName: fleet?.name ?? member.fleetId,
    joinedAt: member.joinedAt,
    games: member.games,
    wins: member.wins,
    pointsEarned: member.pointsEarned,
    eligible: member.eligible,
  };
}

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

function isMissingFleetSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /fleet_seasons|schema cache|does not exist/i.test(message);
}

function isAmbiguousAssignmentError(message: string) {
  return /season_key.*ambiguous|ambiguous.*season_key/i.test(message);
}

function normalizeAssignment(data: unknown): FleetAssignmentRow | null {
  const row = (Array.isArray(data) ? data[0] : data) as Partial<FleetAssignmentRow> | null;
  if (!row?.season_key || !row.fleet_id || !row.joined_at) return null;
  return {
    season_key: String(row.season_key),
    fleet_id: String(row.fleet_id),
    joined_at: String(row.joined_at),
  };
}

async function assignFleetSeasonFallback(admin: SupabaseClient, wallet: string): Promise<FleetAssignmentRow> {
  const now = new Date().toISOString();
  const { data: season, error: seasonError } = await admin
    .from("fleet_seasons")
    .select("season_key")
    .eq("status", "active")
    .lte("starts_at", now)
    .gt("ends_at", now)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seasonError) throw new Error(seasonError.message);
  if (!season?.season_key) throw new Error("No active fleet season");

  const seasonKey = String(season.season_key);
  const existing = await loadMembership(admin, seasonKey, wallet);
  if (existing) return existing;

  const { data: fleets, error: fleetsError } = await admin
    .from("fleet_season_fleets")
    .select("fleet_id,display_order")
    .eq("season_key", seasonKey)
    .order("display_order", { ascending: true });
  if (fleetsError) throw new Error(fleetsError.message);
  if (!fleets?.length) throw new Error("Fleet season has no fleets");

  const candidates = await Promise.all(fleets.map(async (fleet) => {
    const { count, error: countError } = await admin
      .from("fleet_season_members")
      .select("wallet", { count: "exact", head: true })
      .eq("season_key", seasonKey)
      .eq("fleet_id", fleet.fleet_id);
    if (countError) throw new Error(countError.message);
    return {
      fleetId: String(fleet.fleet_id),
      displayOrder: Number(fleet.display_order),
      members: count ?? 0,
      tieBreak: keccak256(toBytes(`${wallet}:${fleet.fleet_id}`)),
    };
  }));
  candidates.sort((left, right) =>
    left.members - right.members ||
    left.tieBreak.localeCompare(right.tieBreak) ||
    left.displayOrder - right.displayOrder,
  );

  const { data: player } = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();
  const { data: inserted, error: insertError } = await admin
    .from("fleet_season_members")
    .insert({
      season_key: seasonKey,
      wallet,
      fleet_id: candidates[0].fleetId,
      points_at_join: Math.max(0, Math.floor(Number(player?.points ?? 0))),
    })
    .select("season_key,fleet_id,joined_at")
    .maybeSingle();
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

  const assignment = normalizeAssignment(inserted) ?? await loadMembership(admin, seasonKey, wallet);
  if (!assignment) throw new Error("Fleet assignment failed");
  return assignment;
}

async function loadMembership(admin: SupabaseClient, seasonKey: string, wallet: string) {
  const { data, error } = await admin
    .from("fleet_season_members")
    .select("season_key,fleet_id,joined_at")
    .eq("season_key", seasonKey)
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeAssignment(data);
}
