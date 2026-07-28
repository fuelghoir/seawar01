import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { normalizeReferralToken } from "../../../lib/referralIdentity";
import { resolveReferralRefServer } from "../../../lib/referralServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const ref = normalizeReferralToken(req.nextUrl.searchParams.get("ref"));
  if (!ref) return jsonError("Invalid referral reference", 400);

  try {
    const referrer = await resolveReferralRefServer(adminSupabase(), ref);
    if (!referrer) return jsonError("Unknown referral code", 404);
    return NextResponse.json({ referrer }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not resolve referral",
      500,
    );
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
}
