import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";
import {
  buildBaseAppMiniAppUrl,
  buildPublicPromoShopUrl,
  buildPublicPromoUrl,
} from "../../../lib/publicUrl";
import {
  PROMO_CAMPAIGN_WALLET,
  createPromoCampaign,
  promoCampaignMarker,
  promoItemLabel,
  serializePromoCampaignNote,
} from "../../../lib/promoCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession();
    const body = await req.json().catch(() => null);
    const { payload, code } = createPromoCampaign({
      code: body?.code ?? body?.id,
      id: body?.code ?? body?.id,
      title: body?.title,
      points: body?.points,
      itemSlug: body?.itemSlug ?? body?.item_slug,
      quantity: body?.quantity,
      note: body?.note,
      expiresDays: body?.expiresDays ?? body?.expires_days,
    });

    const admin = adminSupabase();
    const marker = promoCampaignMarker(payload.id);
    const campaignRow = {
      wallet: PROMO_CAMPAIGN_WALLET,
      source_submission_id: null,
      reward_kind: "note",
      points: payload.points,
      item_slug: payload.itemSlug,
      quantity: payload.quantity,
      reward_label: payload.title,
      status: "planned",
      admin_note: serializePromoCampaignNote(payload, code),
      created_by: marker,
      updated_at: new Date().toISOString(),
    };

    const existing = await admin
      .from("creator_rewards")
      .select("id")
      .eq("wallet", PROMO_CAMPAIGN_WALLET)
      .eq("created_by", marker)
      .limit(1);

    if (existing.error) {
      return NextResponse.json({ error: existing.error.message }, { status: 500 });
    }

    if ((existing.data ?? []).length > 0) {
      const updated = await admin
        .from("creator_rewards")
        .update(campaignRow)
        .eq("wallet", PROMO_CAMPAIGN_WALLET)
        .eq("created_by", marker);
      if (updated.error) {
        return NextResponse.json({ error: updated.error.message }, { status: 500 });
      }
    } else {
      const inserted = await admin.from("creator_rewards").insert({
        ...campaignRow,
        created_by: marker,
        admin_note: serializePromoCampaignNote(payload, code),
      });
      if (inserted.error) {
        return NextResponse.json({ error: inserted.error.message }, { status: 500 });
      }
    }

    const link = buildPublicPromoUrl(code);
    const shopLink = buildPublicPromoShopUrl(code);

    return noStoreJson({
      promo: {
        ...payload,
        code,
        itemLabel: promoItemLabel(payload.itemSlug),
        link,
        shopLink,
        baseAppLink: buildBaseAppMiniAppUrl(link),
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
