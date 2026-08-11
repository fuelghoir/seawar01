import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { normalizeReferralWallet } from "../../../lib/referralIdentity";
import { getPrimaryReferralCodeServer } from "../../../lib/referralServer";
import {
  buildBaseAppMiniAppUrl,
  buildPublicReferralUrl,
} from "../../../lib/publicUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const wallet = normalizeReferralWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) {
    return NextResponse.json(
      { error: "Invalid referral wallet" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const code = await getPrimaryReferralCodeServer(adminSupabase(), wallet);
    const ref = code ?? wallet;
    const link = buildPublicReferralUrl(ref);
    const baseTarget = new URL(link);
    baseTarget.searchParams.set("utm_source", "base_app");
    baseTarget.searchParams.set("utm_medium", "referral");
    baseTarget.searchParams.set("utm_campaign", "captain_invite");
    const baseLink = buildBaseAppMiniAppUrl(baseTarget.toString());
    return NextResponse.json(
      { wallet, code, ref, link, baseLink },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load referral link" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
