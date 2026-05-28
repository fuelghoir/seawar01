import { NextResponse } from "next/server";
import { getAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getAdminSession();
  return NextResponse.json({
    authenticated: !!session,
    address: session?.address ?? null,
  });
}
