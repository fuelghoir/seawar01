import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "../../../lib/adminSupabase";
import { normalizeReferralWallet, recordReferralServer } from "../../../lib/referralServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const referrer = normalizeReferralWallet(body?.referrer);
  const referee = normalizeReferralWallet(body?.referee);
  if (!referrer || !referee) return badRequest("Invalid referral wallet");

  try {
    const recorded = await recordReferralServer(adminSupabase(), referrer, referee);
    return NextResponse.json({ recorded });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Could not record referral");
  }
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
