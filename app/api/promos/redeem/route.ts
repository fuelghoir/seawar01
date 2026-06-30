import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, type AdminClient } from "../../../lib/adminSupabase";
import {
  PROMO_CAMPAIGN_WALLET,
  isSignedPromoCode,
  normalizePromoCode,
  normalizePromoPublicCode,
  promoCampaignFromRecord,
  promoCampaignMarker,
  promoItemLabel,
  verifyPromoCode,
  type PromoCodePayload,
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

  const rawCode = normalizePromoCode(body?.code ?? body?.promo);
  if (!rawCode) {
    return NextResponse.json({ error: "Promo code is required" }, { status: 400 });
  }

  const admin = adminSupabase();
  let promo: PromoCodePayload;
  try {
    promo = isSignedPromoCode(rawCode)
      ? verifyPromoCode(rawCode)
      : await loadStoredPromo(admin, rawCode);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid promo code" },
      { status: 400 },
    );
  }

  const { error: rpcError } = await admin.rpc("redeem_promo_code", {
    p_wallet: wallet,
    p_promo_id: promo.id,
    p_points: promo.points,
    p_item_slug: promo.itemSlug,
    p_quantity: promo.quantity,
    p_admin_note: promo.note || `Redeemed promo ${promo.id}`,
  });

  if (rpcError) {
    const status = rpcError.message.toLowerCase().includes("already redeemed") ? 409 : 500;
    return NextResponse.json({ error: rpcError.message }, { status });
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

async function loadStoredPromo(admin: AdminClient, value: string) {
  const code = normalizePromoPublicCode(value);
  const marker = promoCampaignMarker(code.toLowerCase());
  const { data, error } = await admin
    .from("creator_rewards")
    .select("points,item_slug,quantity,reward_label,admin_note,created_at,status")
    .eq("wallet", PROMO_CAMPAIGN_WALLET)
    .eq("created_by", marker)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Promo code not found");
  return promoCampaignFromRecord(data, code);
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
