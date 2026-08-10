import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, type AdminClient } from "../../../lib/adminSupabase";
import {
  normalizeStarterPackItem,
  normalizeStarterPackWallet,
  STARTER_PACK_ITEM_SLUGS,
  STARTER_PACK_WEEK_KEY,
  type StarterPackClaims,
  type StarterPackItemSlug,
  type StarterPackQuantities,
  type StarterPackStatus,
} from "../../../lib/onboardingStarterPack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const wallet = normalizeStarterPackWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return jsonError("Invalid wallet", 400);

  try {
    const admin = adminSupabase();
    const [eligible, claims, quantities] = await Promise.all([
      hasCompletedCheckin(admin, wallet),
      readStarterClaims(admin, wallet),
      readStarterItemQuantities(admin, wallet),
    ]);
    return json(statusPayload(eligible, claims, quantities));
  } catch (error) {
    console.error("Starter loadout status failed:", error);
    return jsonError(error instanceof Error ? error.message : "Starter loadout is unavailable", 503);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeStarterPackWallet(body?.wallet);
  const itemSlug = normalizeStarterPackItem(body?.itemSlug);
  if (!wallet) return jsonError("Invalid wallet", 400);
  if (!itemSlug) return jsonError("Invalid starter item", 400);

  try {
    const admin = adminSupabase();
    const eligible = await hasCompletedCheckin(admin, wallet);
    if (!eligible) return jsonError("Complete the daily check-in first", 409);

    const currentClaims = await readStarterClaims(admin, wallet);
    if (itemSlug === "torpedo" && !currentClaims.radar_scan) {
      return jsonError("Claim Radar Scan first", 409);
    }

    if (currentClaims[itemSlug]) {
      const quantities = await readStarterItemQuantities(admin, wallet);
      return json(statusPayload(true, currentClaims, quantities, true));
    }

    const { error: claimError } = await admin.from("shop_weekly_point_purchases").insert({
      wallet,
      week_key: STARTER_PACK_WEEK_KEY,
      item_slug: itemSlug,
    });
    if (claimError?.code === "23505") {
      const [claims, quantities] = await Promise.all([
        readStarterClaims(admin, wallet),
        readStarterItemQuantities(admin, wallet),
      ]);
      return json(statusPayload(true, claims, quantities, true));
    }
    if (claimError) throw new Error(claimError.message);

    try {
      // A training claim sets a floor of one; it never adds to an item the
      // player already owns and an existing marker is never refilled.
      await ensureStarterItem(admin, wallet, itemSlug);
      const [claims, quantities] = await Promise.all([
        readStarterClaims(admin, wallet),
        readStarterItemQuantities(admin, wallet),
      ]);
      return json(statusPayload(true, claims, quantities, false));
    } catch (grantError) {
      await admin
        .from("shop_weekly_point_purchases")
        .delete()
        .eq("wallet", wallet)
        .eq("week_key", STARTER_PACK_WEEK_KEY)
        .eq("item_slug", itemSlug);
      throw grantError;
    }
  } catch (error) {
    console.error("Starter item claim failed:", error);
    return jsonError(error instanceof Error ? error.message : "Could not claim starter item", 503);
  }
}

async function hasCompletedCheckin(admin: AdminClient, wallet: string): Promise<boolean> {
  const { data, error } = await admin
    .from("player_stats")
    .select("last_checkin")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.last_checkin);
}

async function readStarterClaims(
  admin: AdminClient,
  wallet: string,
): Promise<StarterPackClaims> {
  const { data, error } = await admin
    .from("shop_weekly_point_purchases")
    .select("item_slug")
    .eq("wallet", wallet)
    .eq("week_key", STARTER_PACK_WEEK_KEY)
    .in("item_slug", [...STARTER_PACK_ITEM_SLUGS]);
  if (error) throw new Error(error.message);

  const claims: StarterPackClaims = { radar_scan: false, torpedo: false };
  for (const row of data ?? []) {
    const slug = normalizeStarterPackItem(row.item_slug);
    if (slug) claims[slug] = true;
  }
  return claims;
}

async function ensureStarterItem(
  admin: AdminClient,
  wallet: string,
  slug: StarterPackItemSlug,
): Promise<void> {
  const now = new Date().toISOString();
  const updated = await admin
    .from("player_items")
    .update({ quantity: 1, updated_at: now })
    .eq("wallet", wallet)
    .eq("item_slug", slug)
    .lt("quantity", 1)
    .select("quantity")
    .maybeSingle();
  if (updated.error) throw new Error(updated.error.message);
  if (updated.data) return;

  const inserted = await admin.from("player_items").insert({
    wallet,
    item_slug: slug,
    quantity: 1,
    updated_at: now,
  });
  if (inserted.error && inserted.error.code !== "23505") {
    throw new Error(inserted.error.message);
  }
}

async function readStarterItemQuantities(
  admin: AdminClient,
  wallet: string,
): Promise<StarterPackQuantities> {
  const { data, error } = await admin
    .from("player_items")
    .select("item_slug,quantity")
    .eq("wallet", wallet)
    .in("item_slug", [...STARTER_PACK_ITEM_SLUGS]);
  if (error) throw new Error(error.message);

  const quantities: StarterPackQuantities = { radar_scan: 0, torpedo: 0 };
  for (const row of data ?? []) {
    const slug = normalizeStarterPackItem(row.item_slug);
    if (slug) quantities[slug] = Math.max(0, Number(row.quantity ?? 0));
  }
  return quantities;
}

function statusPayload(
  eligible: boolean,
  claims: StarterPackClaims,
  quantities: StarterPackQuantities,
  alreadyClaimed = false,
): StarterPackStatus {
  const complete = claims.radar_scan && claims.torpedo;
  return {
    eligible,
    complete,
    nextItem: complete ? null : claims.radar_scan ? "torpedo" : "radar_scan",
    claims,
    quantities,
    alreadyClaimed,
  };
}

function json(payload: StarterPackStatus) {
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
}
