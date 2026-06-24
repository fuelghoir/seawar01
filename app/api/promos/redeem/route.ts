import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, type AdminClient } from "../../../lib/adminSupabase";
import {
  promoItemLabel,
  promoRedemptionMarker,
  verifyPromoCode,
  type PromoCodePayload,
  type PromoItemSlug,
} from "../../../lib/promoCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_RE = /^0x[a-f0-9]{40}$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  let promo: PromoCodePayload;
  try {
    promo = verifyPromoCode(body?.code ?? body?.promo);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid promo code" },
      { status: 400 },
    );
  }

  const admin = adminSupabase();
  const marker = promoRedemptionMarker(promo.id);
  const existing = await admin
    .from("creator_rewards")
    .select("id")
    .eq("wallet", wallet)
    .eq("created_by", marker)
    .limit(1);

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  if ((existing.data ?? []).length > 0) {
    return NextResponse.json({ error: "This wallet already used this promo" }, { status: 409 });
  }

  if (promo.points > 0) {
    const error = await grantPoints(admin, wallet, promo.points);
    if (error) return NextResponse.json({ error }, { status: 500 });
  }

  if (promo.itemSlug && promo.quantity > 0) {
    const error = await grantItem(admin, wallet, promo.itemSlug, promo.quantity);
    if (error) return NextResponse.json({ error }, { status: 500 });
  }

  const auditRows = buildAuditRows(wallet, promo, marker);
  const audit = await admin.from("creator_rewards").insert(auditRows);
  if (audit.error) {
    return NextResponse.json({ error: audit.error.message }, { status: 500 });
  }

  return noStoreJson({
    ok: true,
    message: promoMessage(promo),
    reward: {
      id: promo.id,
      title: promo.title,
      points: promo.points,
      itemSlug: promo.itemSlug,
      itemLabel: promoItemLabel(promo.itemSlug),
      quantity: promo.quantity,
    },
  });
}

async function grantPoints(admin: AdminClient, wallet: string, points: number) {
  const current = await admin
    .from("player_stats")
    .select("points")
    .eq("wallet", wallet)
    .maybeSingle();

  if (current.error) return current.error.message;

  if (current.data) {
    const updated = await admin
      .from("player_stats")
      .update({
        points: Number(current.data.points ?? 0) + points,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet", wallet);
    return updated.error?.message ?? null;
  }

  const inserted = await admin
    .from("player_stats")
    .insert({ wallet, points, updated_at: new Date().toISOString() });
  return inserted.error?.message ?? null;
}

async function grantItem(
  admin: AdminClient,
  wallet: string,
  itemSlug: PromoItemSlug,
  quantity: number,
) {
  const current = await admin
    .from("player_items")
    .select("quantity")
    .eq("wallet", wallet)
    .eq("item_slug", itemSlug)
    .maybeSingle();

  if (current.error) return current.error.message;

  const upserted = await admin
    .from("player_items")
    .upsert(
      {
        wallet,
        item_slug: itemSlug,
        quantity: Number(current.data?.quantity ?? 0) + quantity,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet,item_slug" },
    );

  return upserted.error?.message ?? null;
}

function buildAuditRows(wallet: string, promo: PromoCodePayload, marker: string) {
  const base = {
    wallet,
    source_submission_id: null,
    status: "granted",
    points: 0,
    item_slug: null,
    quantity: 0,
    admin_note: promo.note || `Redeemed promo ${promo.id}`,
    created_by: marker,
  };

  const rows = [];
  if (promo.points > 0) {
    rows.push({
      ...base,
      reward_kind: "points",
      points: promo.points,
      reward_label: `+${promo.points.toLocaleString()} pts`,
    });
  }
  if (promo.itemSlug && promo.quantity > 0) {
    rows.push({
      ...base,
      reward_kind: "item",
      item_slug: promo.itemSlug,
      quantity: promo.quantity,
      reward_label: `${promo.quantity}x ${promoItemLabel(promo.itemSlug)}`,
    });
  }
  return rows;
}

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

function promoMessage(promo: PromoCodePayload) {
  const parts = [];
  if (promo.points > 0) parts.push(`+${promo.points.toLocaleString()} pts`);
  if (promo.itemSlug && promo.quantity > 0) {
    parts.push(`${promo.quantity}x ${promoItemLabel(promo.itemSlug)}`);
  }
  return `Promo redeemed: ${parts.join(" + ")}`;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
