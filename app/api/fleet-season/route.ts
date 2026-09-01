import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  decodeEventLog,
  fallback,
  http,
  parseAbiItem,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { adminSupabase } from "../../lib/adminSupabase";
import {
  FLEET_CHANGE_PRICE_USDC_MICRO,
  FLEET_CHOICE_RESET_SEASON_KEY,
  FLEET_CHOICE_ROLLOUT_AT,
  isFleetId,
  type FleetId,
} from "../../lib/fleetSeason";
import { loadFleetSeasonDashboard } from "../../lib/fleetSeasonServer";
import { SHOP_TREASURY_ADDRESS, USDC_ADDRESS } from "../../contracts/seaBattleAbi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^0x[a-f0-9]{40}$/;
const TX_HASH_RE = /^0x[a-f0-9]{64}$/;
const BASE_RPCS = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
].filter(Boolean) as string[];
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const baseClient = createPublicClient({
  chain: base,
  transport: fallback(
    BASE_RPCS.map((url) => http(url, { retryCount: 0, timeout: 4_000 })),
    { retryCount: 0 },
  ),
});

type FleetAssignmentRow = {
  season_key: string;
  fleet_id: FleetId;
  joined_at: string;
};

class FleetChoiceLockedError extends Error {}
class FleetChoiceNotOpenError extends Error {}
class FleetPaymentError extends Error {}

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
    const assignment = await chooseFleet(admin, wallet, body.fleetId, normalizeTxHash(body?.txHash));
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
            : error instanceof FleetPaymentError
              ? 400
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
    members: dashboard.stats.members
      .map((member) => ({
        wallet: member.wallet,
        fleetId: member.fleetId,
        games: member.games,
        wins: member.wins,
        pointsEarned: member.pointsEarned,
        eligible: member.eligible,
      }))
      .sort((left, right) =>
        right.pointsEarned - left.pointsEarned ||
        right.wins - left.wins ||
        left.wallet.localeCompare(right.wallet),
      ),
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

function normalizeTxHash(value: unknown) {
  const hash = String(value ?? "").trim().toLowerCase();
  return TX_HASH_RE.test(hash) ? hash : null;
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

async function chooseFleet(
  admin: SupabaseClient,
  wallet: string,
  fleetId: FleetId,
  txHash: string | null,
): Promise<FleetAssignmentRow> {
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
  if (existingIsConfirmed && existing) {
    if (existing.fleet_id !== fleetId) {
      if (!txHash) throw new FleetPaymentError("Changing fleet costs 5 USDC");
      return changeFleetWithPayment(admin, wallet, seasonKey, existing, fleetId, txHash);
    }
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

async function changeFleetWithPayment(
  admin: SupabaseClient,
  wallet: string,
  seasonKey: string,
  existing: FleetAssignmentRow,
  fleetId: FleetId,
  txHash: string,
): Promise<FleetAssignmentRow> {
  await assertFleetChangePayment(wallet, txHash, existing.joined_at);
  const itemSlug = `fleet_change_${seasonKey.toLowerCase()}_${fleetId}`;
  const reservation = await reserveFleetChangePayment(admin, wallet, txHash, itemSlug);

  if (reservation === "granted") {
    const current = await loadMembership(admin, seasonKey, wallet);
    if (current?.fleet_id === fleetId) return current;
    throw new FleetPaymentError("This USDC payment was already used");
  }

  const { data: updated, error: updateError } = await admin
    .from("fleet_season_members")
    .update({ fleet_id: fleetId })
    .eq("season_key", seasonKey)
    .eq("wallet", wallet)
    .eq("fleet_id", existing.fleet_id)
    .eq("joined_at", existing.joined_at)
    .select("season_key,fleet_id,joined_at")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);

  const assignment = normalizeAssignment(updated) ?? await loadMembership(admin, seasonKey, wallet);
  if (!assignment || assignment.fleet_id !== fleetId) {
    throw new FleetPaymentError("Fleet changed while payment was processing. Please retry.");
  }

  const { error: markError } = await admin
    .from("shop_usdc_purchases")
    .update({ granted_at: new Date().toISOString() })
    .eq("tx_hash", txHash)
    .eq("wallet", wallet)
    .eq("item_slug", itemSlug)
    .is("granted_at", null);
  if (markError) throw new Error(markError.message);
  return assignment;
}

async function reserveFleetChangePayment(
  admin: SupabaseClient,
  wallet: string,
  txHash: string,
  itemSlug: string,
): Promise<"pending" | "granted"> {
  const existing = await loadFleetChangePurchase(admin, txHash);
  if (existing) return validateFleetChangePurchase(existing, wallet, itemSlug);

  const { error } = await admin.from("shop_usdc_purchases").insert({
    wallet,
    tx_hash: txHash,
    item_slug: itemSlug,
    amount_usdc_micro: FLEET_CHANGE_PRICE_USDC_MICRO,
    granted_at: null,
  });
  if (!error) return "pending";
  if (error.code !== "23505") throw new Error(error.message);

  const concurrent = await loadFleetChangePurchase(admin, txHash);
  if (!concurrent) throw new FleetPaymentError("Could not reserve USDC payment");
  return validateFleetChangePurchase(concurrent, wallet, itemSlug);
}

async function loadFleetChangePurchase(admin: SupabaseClient, txHash: string) {
  const { data, error } = await admin
    .from("shop_usdc_purchases")
    .select("wallet,item_slug,amount_usdc_micro,granted_at")
    .eq("tx_hash", txHash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    wallet: string;
    item_slug: string;
    amount_usdc_micro: number | string;
    granted_at: string | null;
  } | null;
}

function validateFleetChangePurchase(
  purchase: NonNullable<Awaited<ReturnType<typeof loadFleetChangePurchase>>>,
  wallet: string,
  itemSlug: string,
) {
  if (
    purchase.wallet.toLowerCase() !== wallet ||
    purchase.item_slug !== itemSlug ||
    Number(purchase.amount_usdc_micro) !== FLEET_CHANGE_PRICE_USDC_MICRO
  ) {
    throw new FleetPaymentError("This USDC payment was already used");
  }
  return purchase.granted_at ? "granted" as const : "pending" as const;
}

async function assertFleetChangePayment(wallet: string, txHash: string, joinedAt: string) {
  let receipt;
  try {
    receipt = await baseClient.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    throw new FleetPaymentError("Could not verify USDC payment");
  }
  if (receipt.status !== "success") throw new FleetPaymentError("USDC payment was not successful");

  try {
    const block = await baseClient.getBlock({ blockNumber: receipt.blockNumber });
    if (Number(block.timestamp) * 1000 + 2_000 < Date.parse(joinedAt)) {
      throw new FleetPaymentError("USDC payment is older than this fleet membership");
    }
  } catch (error) {
    if (error instanceof FleetPaymentError) throw error;
    throw new FleetPaymentError("Could not verify USDC payment time");
  }

  const from = wallet.toLowerCase();
  const to = SHOP_TREASURY_ADDRESS.toLowerCase();
  const usdc = USDC_ADDRESS.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdc) continue;
    try {
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as { from?: string; to?: string; value?: bigint };
      if (
        args.from?.toLowerCase() === from &&
        args.to?.toLowerCase() === to &&
        args.value === BigInt(FLEET_CHANGE_PRICE_USDC_MICRO)
      ) return;
    } catch {
      continue;
    }
  }
  throw new FleetPaymentError("USDC payment does not match this fleet change");
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
