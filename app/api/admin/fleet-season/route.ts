import { NextRequest, NextResponse } from "next/server";
import { calculateFleetDrop, DEFAULT_FLEETS, FLEET_BPS_TOTAL, isFleetId } from "../../../lib/fleetSeason";
import { loadFleetSeasonDashboard } from "../../../lib/fleetSeasonServer";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;
const ADDR_RE = /^0x[a-f0-9]{40}$/;

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession();
    const dashboard = await loadFleetSeasonDashboard(adminSupabase(), {
      seasonKey: req.nextUrl.searchParams.get("seasonKey"),
    });
    return NextResponse.json({ dashboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load fleet season" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminSession();
    const admin = adminSupabase();
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "").trim();

    if (action === "save") {
      const config = parseConfig(body);
      const { data: existing, error: existingError } = await admin
        .from("fleet_seasons")
        .select("status")
        .eq("season_key", config.seasonKey)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing && existing.status !== "draft") {
        return NextResponse.json({ error: "Only a draft fleet season can be edited" }, { status: 409 });
      }

      const { error: seasonError } = await admin.from("fleet_seasons").upsert({
        season_key: config.seasonKey,
        title: config.title,
        starts_at: config.startsAt,
        ends_at: config.endsAt,
        status: "draft",
        ranking_metric: "total_wins",
        min_games: config.minGames,
        first_share_bps: config.sharesBps[0],
        second_share_bps: config.sharesBps[1],
        third_share_bps: config.sharesBps[2],
        created_by: session.address,
      }, { onConflict: "season_key" });
      if (seasonError) throw new Error(seasonError.message);

      const { error: fleetError } = await admin.from("fleet_season_fleets").upsert(
        config.fleets.map((fleet) => ({
          season_key: config.seasonKey,
          fleet_id: fleet.id,
          name: fleet.name,
          color: fleet.color,
          image_path: fleet.image,
          display_order: fleet.displayOrder,
        })),
        { onConflict: "season_key,fleet_id" },
      );
      if (fleetError) throw new Error(fleetError.message);
      return NextResponse.json({ dashboard: await loadFleetSeasonDashboard(admin, { seasonKey: config.seasonKey }) });
    }

    const seasonKey = String(body?.seasonKey ?? "").trim();
    if (!KEY_RE.test(seasonKey)) return NextResponse.json({ error: "Invalid season key" }, { status: 400 });

    if (action === "activate") {
      const { error } = await admin.rpc("activate_fleet_season", { p_season_key: seasonKey });
      if (error) throw new Error(error.message);
      return NextResponse.json({ dashboard: await loadFleetSeasonDashboard(admin, { seasonKey }) });
    }

    if (action === "finish") {
      const { error } = await admin.rpc("end_fleet_season", { p_season_key: seasonKey });
      if (error) throw new Error(error.message);
      return NextResponse.json({ dashboard: await loadFleetSeasonDashboard(admin, { seasonKey }) });
    }

    if (action === "preview_snapshot" || action === "create_snapshot") {
      const dashboard = await loadFleetSeasonDashboard(admin, { seasonKey });
      if (!dashboard) return NextResponse.json({ error: "Fleet season not found" }, { status: 404 });
      const drop = parseDrop(body);
      const calculation = calculateFleetDrop(
        dashboard.stats,
        BigInt(drop.totalAmountRaw),
        dashboard.season.sharesBps,
      );

      if (action === "create_snapshot") {
        const { error } = await admin.rpc("create_fleet_season_snapshot", {
          p_season_key: seasonKey,
          p_drop_id: drop.id,
          p_drop_title: drop.title,
          p_token_address: drop.tokenAddress,
          p_token_symbol: drop.tokenSymbol,
          p_decimals: drop.decimals,
          p_total_amount_raw: drop.totalAmountRaw,
          p_contract_address: drop.contractAddress,
          p_signer_address: drop.signerAddress,
          p_created_by: session.address,
          p_results: calculation.buckets,
          p_payouts: calculation.payouts,
        });
        if (error) throw new Error(error.message);
      }

      return NextResponse.json({
        preview: action === "preview_snapshot",
        calculation,
        dashboard: action === "create_snapshot"
          ? await loadFleetSeasonDashboard(admin, { seasonKey })
          : dashboard,
      });
    }

    if (action === "activate_claim") {
      const { data: season, error: seasonError } = await admin
        .from("fleet_seasons")
        .select("drop_id,status")
        .eq("season_key", seasonKey)
        .maybeSingle();
      if (seasonError) throw new Error(seasonError.message);
      if (!season?.drop_id || season.status !== "snapshotted") {
        return NextResponse.json({ error: "Create the fleet snapshot first" }, { status: 409 });
      }
      const { data: activatedDrop, error } = await admin
        .from("drop_campaigns")
        .update({ status: "active" })
        .eq("id", season.drop_id)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!activatedDrop) {
        return NextResponse.json({ error: "Claim is already active or closed" }, { status: 409 });
      }
      return NextResponse.json({
        success: true,
        dropId: season.drop_id,
        dashboard: await loadFleetSeasonDashboard(admin, { seasonKey }),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fleet season admin action failed" },
      { status: 500 },
    );
  }
}

function parseConfig(body: Record<string, unknown>) {
  const seasonKey = String(body.seasonKey ?? "").trim();
  const title = String(body.title ?? "Fleet Season").trim().slice(0, 120);
  const startsAt = new Date(String(body.startsAt ?? "")).toISOString();
  const endsAt = new Date(String(body.endsAt ?? "")).toISOString();
  const minGames = Math.max(0, Math.floor(Number(body.minGames ?? 3)));
  const shares = Array.isArray(body.shares) ? body.shares : [60, 30, 10];
  const sharesBps = shares.map((value) => Math.round(Number(value) * 100));
  if (!KEY_RE.test(seasonKey)) throw new Error("Invalid season key");
  if (!title) throw new Error("Season title is required");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("Season end must be after season start");
  if (sharesBps.length !== 3 || sharesBps.reduce((sum, value) => sum + value, 0) !== FLEET_BPS_TOTAL) {
    throw new Error("Fleet shares must total 100%");
  }

  const requestedFleets = Array.isArray(body.fleets) ? body.fleets : DEFAULT_FLEETS;
  const fleets = requestedFleets.map((raw, index) => {
    const row = raw as Record<string, unknown>;
    const id = String(row.id ?? "");
    if (!isFleetId(id)) throw new Error("Invalid fleet id");
    return {
      id,
      name: String(row.name ?? id).trim().slice(0, 40),
      color: String(row.color ?? DEFAULT_FLEETS[index]?.color ?? "#28d7ef"),
      image: String(row.image ?? DEFAULT_FLEETS[index]?.image ?? ""),
      displayOrder: index + 1,
    };
  });
  if (new Set(fleets.map((fleet) => fleet.id)).size !== 3) throw new Error("Exactly three unique fleets are required");

  return { seasonKey, title, startsAt, endsAt, minGames, sharesBps, fleets };
}

function parseDrop(body: Record<string, unknown>) {
  const source = (body.drop ?? {}) as Record<string, unknown>;
  const id = String(source.id ?? "").trim();
  const title = String(source.title ?? id).trim().slice(0, 120);
  const tokenAddress = normalizeAddress(source.tokenAddress);
  const contractAddress = normalizeOptionalAddress(source.contractAddress);
  const signerAddress = normalizeOptionalAddress(source.signerAddress);
  const tokenSymbol = String(source.tokenSymbol ?? "TOKEN").trim().slice(0, 24);
  const decimals = Math.max(0, Math.min(36, Math.floor(Number(source.decimals ?? 18))));
  const totalAmountRaw = String(source.totalAmountRaw ?? "").trim();
  if (!KEY_RE.test(id)) throw new Error("Invalid drop id");
  if (!title) throw new Error("Drop title is required");
  if (!/^\d+$/.test(totalAmountRaw) || BigInt(totalAmountRaw) <= BigInt(0)) throw new Error("Invalid raw drop amount");
  return { id, title, tokenAddress, contractAddress, signerAddress, tokenSymbol, decimals, totalAmountRaw };
}

function normalizeAddress(value: unknown) {
  const address = String(value ?? "").trim().toLowerCase();
  if (!ADDR_RE.test(address)) throw new Error("Invalid token address");
  return address;
}

function normalizeOptionalAddress(value: unknown) {
  const address = String(value ?? "").trim().toLowerCase();
  if (!address) return "";
  if (!ADDR_RE.test(address)) throw new Error("Invalid contract or signer address");
  return address;
}
