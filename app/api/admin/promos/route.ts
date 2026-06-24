import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../../lib/adminAuth";
import { getPublicAppUrl } from "../../../lib/publicUrl";
import { createPromoCode, promoItemLabel } from "../../../lib/promoCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession();
    const body = await req.json().catch(() => null);
    const { payload, code } = createPromoCode({
      id: body?.id,
      title: body?.title,
      points: body?.points,
      itemSlug: body?.itemSlug ?? body?.item_slug,
      quantity: body?.quantity,
      note: body?.note,
      expiresDays: body?.expiresDays ?? body?.expires_days,
    });

    const link = new URL("/shop", getPublicAppUrl());
    link.searchParams.set("promo", code);

    return noStoreJson({
      promo: {
        ...payload,
        itemLabel: promoItemLabel(payload.itemSlug),
        code,
        link: link.toString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create promo" },
      { status: 400 },
    );
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
