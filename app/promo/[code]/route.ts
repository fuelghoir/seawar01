import { NextRequest, NextResponse } from "next/server";
import { buildPublicPromoShopUrl } from "../../lib/publicUrl";
import { normalizePromoPublicCode } from "../../lib/promoCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizePromoPublicCode(rawCode);
  return NextResponse.redirect(buildPublicPromoShopUrl(code), 307);
}
