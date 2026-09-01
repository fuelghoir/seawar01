import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminSupabase } from "../../lib/adminSupabase";
import {
  FLEET_CHOICE_RESET_SEASON_KEY,
  FLEET_CHOICE_ROLLOUT_AT,
  isFleetId,
  type FleetId,
} from "../../lib/fleetSeason";
import { loadFleetSeasonDashboard } from "../../lib/fleetSeasonServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

type FleetAssignmentRow = {
  season_key: string;
  fleet_id: FleetId;
  joined_at: string;
};

class FleetChoiceLockedError extends Error {}
class FleetChoiceNotOpenError extends Error {}

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
      choiceRequired: dashboard.season.status === "active" && !member,
      choiceOpensAt: dashboard.season.seasonKey === FLEET_CHOICE_RESET_SEASON_KEY
        ? FLEET_CHOICE_ROLLOUT_AT
        : undefined,
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
    if (!isFleetId(body?.fleetId)) {
      return NextResponse.json({ error: "Choose a valid fleet" }, { status: 400 });
    }

    const admin = adminSupabase();
    const assignment = await chooseFleet(admin, wallet, body.fleetId);
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
      {
        status: error instanceof FleetChoiceLockedError
          ? 409
          : error instanceof FleetChoiceNotOpenError
            ? 503
            : 500,
      },
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

function normalizeAssignment(data: unknown): FleetAssignmentRow | null {
  const row = (Array.isArray(data) ? data[0] : data) as Partial<FleetAssignmentRow> | null;
  if (!row?.season_key || !isFleetId(row.fleet_id) || !row.joined_at) return null;
  return {
    season_key: String(row.season_key),
    fleet_id: row.fleet_id,
    joined_at: String(row.joined_at),
  };
}

async function chooseFleet(admin: SupabaseClient, wallet: string, fleetId: FleetId): Promise<FleetAssignmentRow> {
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
  if (seasonKey === FLEET_CHOICE_RESET_SEASON_KEY && Date.parse(now) < Date.parse(FLEET_CHOICE_ROLLOUT_AT)) {
    throw new FleetChoiceNotOpenError("Fleet choice opens in a moment. Please retry.");
  }
  const existing = await loadMembership(admin, seasonKey, wallet);
  const choiceResetApplies = seasonKey === FLEET_CHOICE_RESET_SEASON_KEY;
  const existingIsConfirmed = Boolean(
    existing && (!choiceResetApplies || Date.parse(existing.joined_at) >= Date.parse(FLEET_CHOICE_ROLLOUT_AT)),
  );
  if (existingIsConfirmed) {
    if (existing?.fleet_id !== fleetId) throw new FleetChoiceLockedError("Fleet choice is locked for this season");
    return existing;
  }

  const { data: fleet, error: fleetError } = await admin
    .from("fleet_season_fleets")
    .select("fleet_id")
    .eq("season_key", seasonKey)
    .eq("fleet_id", fleetId)
    .maybeSingle();
  if (fleetError) throw new Error(fleetError.message);
  if (!fleet) throw new Error("Fleet is not available in this season");

  const { data: player, error: playerError } = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();
  if (playerError) throw new Error(playerError.message);
  const pointsAtJoin = Math.max(0, Math.floor(Number(player?.points ?? 0)));

  if (existing) {
    const { data: updated, error: updateError } = await admin
      .from("fleet_season_members")
      .update({
        fleet_id: fleetId,
        joined_at: now,
        points_at_join: pointsAtJoin,
        points_at_end: null,
      })
      .eq("season_key", seasonKey)
      .eq("wallet", wallet)
      .lt("joined_at", FLEET_CHOICE_ROLLOUT_AT)
      .select("season_key,fleet_id,joined_at")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    const assignment = normalizeAssignment(updated);
    if (assignment) return assignment;
  }

  const { data: inserted, error: insertError } = await admin
    .from("fleet_season_members")
    .insert({
      season_key: seasonKey,
      wallet,
      fleet_id: fleetId,
      joined_at: now,
      points_at_join: pointsAtJoin,
    })
    .select("season_key,fleet_id,joined_at")
    .maybeSingle();
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

  const assignment = normalizeAssignment(inserted) ?? await loadMembership(admin, seasonKey, wallet);
  if (!assignment) throw new Error("Fleet assignment failed");
  if (assignment.fleet_id !== fleetId) throw new FleetChoiceLockedError("Fleet choice is locked for this season");
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
