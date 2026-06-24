import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import {
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
  const { error: rpcError } = await admin.rpc("redeem_promo_code", {
    p_wallet: wallet,
    p_promo_id: promo.id,
    p_points: promo.points,
    p_item_slug: promo.itemSlug,
    p_quantity: promo.quantity,
    p_admin_note: promo.note || `Redeemed promo ${promo.id}`,
  });

  if (rpcError) {
    const status = rpcError.message.includes("already redeemed") ? 409 : 500;
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
