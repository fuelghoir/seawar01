import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../lib/adminSupabase";
import { loadFleetSeasonDashboard } from "../../lib/fleetSeasonServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

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
    if (error) throw new Error(error.message);
    const assignment = Array.isArray(data) ? data[0] : data;
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
